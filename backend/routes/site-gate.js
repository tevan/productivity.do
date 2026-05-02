/**
 * Site-gate auth — pre-public-launch password screen.
 *
 * Single shared password (env: SITE_PASSWORD) protects the SPA + /api during
 * the private-beta phase. Replaces the nginx IP allowlist so charter users
 * can sign in from any device. Cookie-based, signed with HMAC-SHA256 over
 * `${version}.${expiry}` so we can rotate the secret without invalidating
 * the password.
 *
 * Flow (mirrors resourcingtools.com pattern):
 *   1. nginx auth_request → GET /site-gate/verify
 *   2. On 401, nginx error_page redirects to /site-gate/login.html
 *   3. Login form posts to POST /site-gate/check
 *   4. On success, sets `productivity_site_auth` cookie; redirect back
 *
 * Lockout: 3 failed attempts within 15 minutes from the same IP → that IP
 * is blocked for 1 hour. The owner's home IP (env: SITE_GATE_BYPASS_IPS,
 * comma-separated) bypasses both password AND lockout.
 *
 * Environment:
 *   SITE_PASSWORD             required — the gate password
 *   SITE_AUTH_SECRET          required — random 32+ chars; rotates the cookie
 *   SITE_GATE_BYPASS_IPS      optional — comma-separated allowlist
 *
 * To DELETE the gate at public launch: remove the route mounts in server.js,
 * the auth_request lines in nginx, and this file.
 */

import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

// Read env values lazily — server.js parses .env AFTER imports, so reading
// process.env at module load time captures empty strings.
function getPassword() { return process.env.SITE_PASSWORD || ''; }
function getSecret() { return process.env.SITE_AUTH_SECRET || ''; }
function getBypassIps() {
  return new Set(
    (process.env.SITE_GATE_BYPASS_IPS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

const SITE_AUTH_COOKIE = 'productivity_site_auth';
const SITE_AUTH_TTL_DAYS = 30;

// In-memory IP rate-limit. Survives the lifetime of one process (PM2 restart
// resets it — that's intentional, a server hiccup shouldn't lock anyone out
// permanently). For multi-process this would need shared state, but we run
// a single PM2 process today.
const MAX_ATTEMPTS = 3;
const ATTEMPT_WINDOW_MS = 15 * 60_000; // 15 minutes
const BLOCK_DURATION_MS = 60 * 60_000; // 1 hour
const attempts = new Map(); // ip -> { count, firstAt, blockedUntil? }

// Use the X-Forwarded-For header if present (Cloudflare → nginx → here),
// fall back to req.ip. Take the leftmost (real client) hop.
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.ip || '';
}

function isBypassed(ip) {
  return getBypassIps().has(ip);
}

function isBlocked(ip) {
  const a = attempts.get(ip);
  if (!a?.blockedUntil) return false;
  if (Date.now() < a.blockedUntil) return true;
  // Block expired — clear the slot.
  attempts.delete(ip);
  return false;
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const a = attempts.get(ip) || { count: 0, firstAt: now };
  // Reset window if the first attempt is older than ATTEMPT_WINDOW_MS.
  if (now - a.firstAt > ATTEMPT_WINDOW_MS) {
    a.count = 0;
    a.firstAt = now;
  }
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) {
    a.blockedUntil = now + BLOCK_DURATION_MS;
  }
  attempts.set(ip, a);
  return a;
}

function clearAttempts(ip) {
  attempts.delete(ip);
}

function makeCookieValue() {
  const exp = Math.floor(Date.now() / 1000) + SITE_AUTH_TTL_DAYS * 86400;
  const payload = `v1.${exp}`;
  const sig = createHmac('sha256', getSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyCookieValue(value) {
  if (!value || !getSecret()) return false;
  const parts = String(value).split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const [, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac('sha256', getSecret()).update(`v1.${expStr}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? m[1] : null;
}

// ---------- routes ----------

// nginx auth_request hook. Returns 200 if authenticated, 401 otherwise.
router.get('/site-gate/verify', (req, res) => {
  if (!getPassword() || !getSecret()) {
    // Misconfigured — fail open so the site isn't bricked.
    return res.status(200).end();
  }
  const ip = clientIp(req);
  if (isBypassed(ip)) return res.status(200).end();
  const cookie = readCookie(req, SITE_AUTH_COOKIE);
  if (verifyCookieValue(cookie)) return res.status(200).end();
  return res.status(401).end();
});

// Login form submission.
router.post('/site-gate/check', (req, res) => {
  if (!getPassword() || !getSecret()) {
    return res.status(503).json({ ok: false, error: 'Auth not configured' });
  }
  const ip = clientIp(req);
  if (isBypassed(ip)) {
    res.setHeader('Set-Cookie', cookieHeader());
    return res.json({ ok: true, bypass: true });
  }
  if (isBlocked(ip)) {
    return res.status(429).json({
      ok: false,
      error: 'Too many attempts. Try again in an hour.',
    });
  }
  const password = String(req.body?.password || '').trim();
  const ok =
    password.length === getPassword().length &&
    timingSafeEqual(Buffer.from(password), Buffer.from(getPassword()));
  if (!ok) {
    const a = recordFailedAttempt(ip);
    const remaining = Math.max(0, MAX_ATTEMPTS - a.count);
    if (a.blockedUntil) {
      return res.status(429).json({
        ok: false,
        error: 'Too many attempts. Try again in an hour.',
      });
    }
    return res.status(401).json({
      ok: false,
      error: 'Wrong password',
      attemptsRemaining: remaining,
    });
  }
  clearAttempts(ip);
  res.setHeader('Set-Cookie', cookieHeader());
  res.json({ ok: true });
});

router.post('/site-gate/logout', (req, res) => {
  res.setHeader(
    'Set-Cookie',
    `${SITE_AUTH_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`
  );
  res.json({ ok: true });
});

function cookieHeader() {
  return `${SITE_AUTH_COOKIE}=${makeCookieValue()}; Path=/; Max-Age=${SITE_AUTH_TTL_DAYS * 86400}; Secure; HttpOnly; SameSite=Lax`;
}

// Static login page. Self-contained HTML — no Vite, no SPA dependency.
const loginHtmlPath = join(__dirname, '..', 'views', 'site-gate-login.html');
let loginHtml = '';
try { loginHtml = readFileSync(loginHtmlPath, 'utf8'); } catch {}

router.get('/site-gate/login.html', (req, res) => {
  res.type('html').send(loginHtml);
});

export default router;
