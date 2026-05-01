// Stripe-style Idempotency-Key support for /api/v1 write endpoints.
//
// On a write request with an `Idempotency-Key` header:
//   1. If we've seen (user_id, key) before, replay the cached status + body.
//   2. Otherwise, wrap res.json/res.send so the FIRST successful response
//      (2xx) gets persisted under that key. Subsequent retries — even after
//      partial failures or client timeouts — return the same response and
//      never re-execute the side effect.
//
// Why this matters: clients on flaky networks retry POSTs. Without this,
// a POST that succeeded on the server but timed out on the wire creates a
// duplicate task / event / booking when the client retries.
//
// We intentionally do NOT cache 4xx/5xx — a validation error today might be
// fixed in a follow-up retry with a different body. Stripe's behavior here
// is more elaborate (they cache the request fingerprint and 409 on body
// mismatch); we keep it simple: only successes get cached.
//
// Keys are scoped per-user — one user's idempotency key never collides with
// another's. TTL: 24h, swept periodically.

import { getDb } from '../db/init.js';
import { verifyApiKey } from '../lib/apiKeys.js';

const TTL_HOURS = 24;

export function idempotency(req, res, next) {
  // Only apply to mutating verbs.
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  const key = req.get('idempotency-key');
  if (!key) return next();

  // Sanity bounds. Don't let clients store megabytes of garbage.
  if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
    return res.status(400).json({ ok: false, error: 'Idempotency-Key must be 8-128 chars' });
  }

  // We need a user identity to scope the key. requireApi runs per-route so
  // req.user isn't set yet — resolve identity here the same way requireApi
  // does, but without enforcing scopes (the route's own requireApi will).
  let userId = null;
  if (req.session?.authenticated) {
    userId = req.session.userId || 1;
  } else {
    const auth = req.get('authorization') || '';
    const m = auth.match(/^Bearer\s+(\S+)/i);
    if (m) {
      const key = verifyApiKey(m[1]);
      if (key) userId = key.userId || 1;
    }
  }
  // Unauth requests skip caching — the route's auth check will reject them.
  if (!userId) return next();

  const db = getDb();
  const existing = db.prepare(`
    SELECT status_code, response_body
      FROM api_v1_idempotency_keys
     WHERE user_id = ? AND key = ?
  `).get(userId, key);

  if (existing) {
    res.set('Idempotent-Replayed', 'true');
    res.status(existing.status_code);
    try {
      return res.json(JSON.parse(existing.response_body));
    } catch {
      return res.send(existing.response_body);
    }
  }

  // First-time: wrap res.json so we capture the body on success.
  const origJson = res.json.bind(res);
  res.json = (body) => {
    try {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        db.prepare(`
          INSERT OR IGNORE INTO api_v1_idempotency_keys
            (user_id, key, method, path, status_code, response_body)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, key, req.method, req.path, res.statusCode, JSON.stringify(body));
      }
    } catch (err) {
      console.warn('idempotency cache insert failed:', err.message);
    }
    return origJson(body);
  };

  next();
}

// Periodically prune entries older than TTL.
let sweeper = null;
export function startIdempotencySweeper({ intervalMs = 60 * 60_000 } = {}) {
  if (sweeper) return;
  const sweep = () => {
    try {
      getDb().prepare(`
        DELETE FROM api_v1_idempotency_keys
         WHERE created_at < datetime('now', ?)
      `).run(`-${TTL_HOURS} hours`);
    } catch (err) {
      console.warn('idempotency sweep:', err.message);
    }
  };
  sweep();
  sweeper = setInterval(sweep, intervalMs);
  sweeper.unref?.();
}
