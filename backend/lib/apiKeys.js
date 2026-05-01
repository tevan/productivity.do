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
  const rows = userId
    ? db.prepare('SELECT id, prefix, name, scopes, last_used_at, revoked_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId)
    : db.prepare('SELECT id, prefix, name, scopes, last_used_at, revoked_at, created_at FROM api_keys ORDER BY created_at DESC').all();
  return rows.map(r => ({
    id: r.id,
    prefix: r.prefix,
    name: r.name,
    scopes: safeJson(r.scopes, []),
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
  }));
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
 */
export function verifyApiKey(token) {
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
  // Touch last_used_at (best-effort, non-blocking)
  try { db.prepare('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE id = ?').run(row.id); } catch {}
  return {
    id: row.id,
    prefix: row.prefix,
    name: row.name,
    scopes: safeJson(row.scopes, []),
    userId: row.user_id,
  };
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
    const key = verifyApiKey(m[1]);
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
