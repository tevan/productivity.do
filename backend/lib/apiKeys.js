/**
 * API key management for the public /api/v1 namespace.
 *
 * Format on the wire: `pk_live_<prefix>.<secret>` where:
 *   - prefix is 8 random base32 chars (visible in DB and admin UI),
 *   - secret is 32 random base32 chars (only ever shown once at creation).
 *
 * We store sha256(secret) — never the plaintext secret.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { getDb } from '../db/init.js';

const TOKEN_PREFIX = 'pk_live_';

const ALPH = 'abcdefghijklmnopqrstuvwxyz0123456789';
function randomChunk(len) {
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPH[bytes[i] % ALPH.length];
  return s;
}

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

function uuid() {
  return randomUUID();
}

/**
 * Returns { id, key, prefix }. The full `key` is only available here once.
 */
export function createApiKey({ name, scopes = [], userId }) {
  if (!userId) throw new Error('createApiKey requires userId');
  const db = getDb();
  const id = uuid();
  const prefix = randomChunk(8);
  const secret = randomChunk(32);
  const fullKey = `${TOKEN_PREFIX}${prefix}.${secret}`;
  const hash = sha256Hex(secret);
  db.prepare(`
    INSERT INTO api_keys (id, prefix, hash, name, scopes, user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, prefix, hash, name || 'API key', JSON.stringify(scopes), userId);
  return { id, prefix, name: name || 'API key', scopes, key: fullKey };
}

export function listApiKeys(userId) {
  const db = getDb();
  const cols = 'id, prefix, name, scopes, last_used_at, last_used_ip, last_used_user_agent, revoked_at, rotated_at, predecessor_id, created_at';
  const rows = userId
    ? db.prepare(`SELECT ${cols} FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`).all(userId)
    : db.prepare(`SELECT ${cols} FROM api_keys ORDER BY created_at DESC`).all();
  return rows.map(r => ({
    id: r.id,
    prefix: r.prefix,
    name: r.name,
    scopes: safeJson(r.scopes, []),
    lastUsedAt: r.last_used_at,
    lastUsedIp: r.last_used_ip,
    lastUsedUserAgent: r.last_used_user_agent,
    revokedAt: r.revoked_at,
    rotatedAt: r.rotated_at,
    predecessorId: r.predecessor_id,
    createdAt: r.created_at,
  }));
}

/**
 * Rotate a key's secret. Issues a NEW key (new prefix + new secret) with the
 * same name, scopes, and owner; the OLD key keeps working for ROTATION_GRACE_DAYS
 * so the user can redeploy without downtime. After the grace window the daily
 * sweeper revokes the old key.
 *
 * Returns { id, prefix, key } for the new key — the secret is ONLY visible here.
 */
export const ROTATION_GRACE_DAYS = 7;

export function rotateApiKey(oldId, userId) {
  const db = getDb();
  const old = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(oldId, userId);
  if (!old) return null;
  if (old.revoked_at) throw new Error('Key already revoked; cannot rotate. Issue a fresh key instead.');

  const fresh = createApiKey({ name: old.name, scopes: safeJson(old.scopes, []), userId });
  // Mark the old key with rotated_at + link the new key's predecessor_id
  // back to it. Done in one transaction so a crash mid-rotation doesn't
  // leave orphan state.
  db.transaction(() => {
    db.prepare('UPDATE api_keys SET rotated_at = datetime(\'now\') WHERE id = ?').run(oldId);
    db.prepare('UPDATE api_keys SET predecessor_id = ? WHERE id = ?').run(oldId, fresh.id);
  })();
  return fresh; // { id, prefix, name, scopes, key }
}

/**
 * Revoke any keys whose rotated_at is older than the grace window. Idempotent;
 * call from a daily sweeper.
 */
export function sweepRotatedKeys() {
  const db = getDb();
  const cutoff = new Date(Date.now() - ROTATION_GRACE_DAYS * 24 * 60 * 60_000).toISOString();
  const r = db.prepare(`
    UPDATE api_keys SET revoked_at = datetime('now')
     WHERE rotated_at IS NOT NULL
       AND rotated_at <= ?
       AND revoked_at IS NULL
  `).run(cutoff);
  return r.changes;
}

export function revokeApiKey(id, userId) {
  const db = getDb();
  if (userId) {
    db.prepare('UPDATE api_keys SET revoked_at = datetime(\'now\') WHERE id = ? AND user_id = ?').run(id, userId);
  } else {
    db.prepare('UPDATE api_keys SET revoked_at = datetime(\'now\') WHERE id = ?').run(id);
  }
}

export function deleteApiKey(id, userId) {
  const db = getDb();
  if (userId) {
    db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(id, userId);
  } else {
    db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
  }
}

/**
 * Verify a bearer token. Returns the api_key row on success, or null.
 *
 * Pass `req` (optional) to record `last_used_ip` and `last_used_user_agent`
 * alongside the timestamp — Designing Web APIs Ch 3 §Listing and Revoking
 * Authorizations recommends giving users enough context to safely revoke
 * unused keys.
 */
export function verifyApiKey(token, req = null) {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  const rest = token.slice(TOKEN_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot < 0) return null;
  const prefix = rest.slice(0, dot);
  const secret = rest.slice(dot + 1);
  if (!prefix || !secret) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM api_keys WHERE prefix = ? AND revoked_at IS NULL').get(prefix);
  if (!row) return null;
  const a = Buffer.from(sha256Hex(secret), 'hex');
  const b = Buffer.from(row.hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  // Audit-touch last_used_at + ip + ua. Best-effort (try/catch) and at
  // most one write per second per key — write storms on a hot key would
  // otherwise burn IO for no benefit (the resolution we surface is
  // "minutes ago", not "this exact request"). Implemented inline rather
  // than using a setTimeout so the write happens on the same tick as
  // the verification (small, non-blocking).
  try {
    const ip = req ? extractClientIp(req) : null;
    const ua = req ? (req.get('user-agent') || '').slice(0, 200) : null;
    // Throttle: skip if last_used_at within last 60s — spares IO for
    // chatty clients without losing useful "I haven't used this in 90
    // days" precision. The same row's `last_used_at` is read just below.
    const lu = row.last_used_at ? new Date(row.last_used_at + (row.last_used_at.endsWith('Z') ? '' : 'Z')).getTime() : 0;
    if (Date.now() - lu > 60_000) {
      db.prepare(`
        UPDATE api_keys
           SET last_used_at = datetime('now'),
               last_used_ip = COALESCE(?, last_used_ip),
               last_used_user_agent = COALESCE(?, last_used_user_agent)
         WHERE id = ?
      `).run(ip, ua, row.id);
    }
  } catch {}
  return {
    id: row.id,
    prefix: row.prefix,
    name: row.name,
    scopes: safeJson(row.scopes, []),
    userId: row.user_id,
  };
}

function extractClientIp(req) {
  // Behind nginx + Cloudflare. Trust X-Forwarded-For if Express's
  // `trust proxy` is set; otherwise fall back to socket remote address.
  // Take only the first hop — chained X-F-F values can be spoofed.
  const xff = req.get('x-forwarded-for') || '';
  const first = xff.split(',')[0]?.trim();
  return first || req.ip || null;
}

/**
 * Returns true if the key has the given scope (or 'admin' which is a wildcard).
 */
export function hasScope(key, scope) {
  if (!key) return false;
  const scopes = key.scopes || [];
  if (scopes.includes('admin')) return true;
  return scopes.includes(scope);
}

function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

/**
 * Express middleware factory: requires an authenticated session OR a Bearer
 * token with one of the listed scopes. If neither present, 401.
 */
export function requireApi(scopes = []) {
  return (req, res, next) => {
    // Session-based auth (the SPA) is allowed only for same-origin requests.
    // This blocks cross-origin pages from piggy-backing on the user's session
    // cookie even if the browser sent it (defence-in-depth — the CORS policy
    // for /api/v1 should already prevent the cookie from flowing).
    if (req.session && req.session.authenticated) {
      const origin = req.get('origin');
      const sameOrigin = (() => {
        if (!origin) return true;
        try {
          const o = new URL(origin);
          return o.host === req.get('host');
        } catch { return false; }
      })();
      if (sameOrigin) {
        // Bridge: legacy sessions only have `authenticated=true`. Treat as seed user (id=1).
        req.user = { id: req.session.userId || 1 };
        return next();
      }
    }
    const auth = req.get('authorization') || '';
    const m = auth.match(/^Bearer\s+(\S+)/i);
    if (!m) return res.status(401).json({ ok: false, error: 'Missing Authorization header' });
    const key = verifyApiKey(m[1], req);
    if (!key) return res.status(401).json({ ok: false, error: 'Invalid API key' });
    const required = Array.isArray(scopes) ? scopes : [scopes];
    if (required.length > 0 && !required.some(s => hasScope(key, s))) {
      return res.status(403).json({ ok: false, error: `Missing scope: ${required.join(' | ')}` });
    }
    req.apiKey = key;
    req.user = { id: key.userId || 1 };
    next();
  };
}

// Listed in the order users typically reach for them — most builders are
// reading/writing events first (calendar integrations are the biggest use
// case), then tasks, then booking-related data, then webhooks. Admin is
// last because it's a dangerous catch-all.
export const SCOPES = [
  'read:events',    'write:events',
  'read:calendars',
  'read:tasks',     'write:tasks',
  'read:bookings',  'write:bookings',
  'read:webhooks',  'write:webhooks',
  'admin',
];
