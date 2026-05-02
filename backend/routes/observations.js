import { Router } from 'express';
import { q } from '../db/init.js';
import { OBSERVERS } from '../lib/observations/index.js';
import { pickObservation } from '../lib/observations/_framework.js';

const router = Router();

/**
 * GET /api/observations/current
 * Returns the highest-confidence not-suppressed observation for this user, or null.
 *
 * Cached for 24h per user via the dismissal table — observations are quiet by
 * design; we don't want to spam re-evaluation.
 *
 * Response: { ok: true, observation: Observation | null }
 */
router.get('/api/observations/current', async (req, res) => {
  try {
    const userId = req.user.id;

    // Suppression set
    const dismissalRows = q(
      'SELECT key, dismiss_count, dismissed_at FROM observation_dismissals WHERE user_id = ?'
    ).all(userId);

    const suppressed = new Set();
    for (const row of dismissalRows) {
      // Specific id suppressions decay after 60 days. Kind suppressions are
      // permanent (the whole point: if a user dismissed a kind 3 times, they
      // never want to see it).
      if (row.key.startsWith('kind:')) {
        suppressed.add(row.key.slice(5));
      } else if (row.key.startsWith('id:')) {
        const ageMs = Date.now() - new Date(row.dismissed_at).getTime();
        if (ageMs < 60 * 86_400_000) suppressed.add(row.key.slice(3));
      }
    }

    // Timezone resolution (same shape as today.js)
    const prefRow = q(
      "SELECT value FROM preferences WHERE user_id = ? AND key = 'primaryTimezone'"
    ).get(userId);
    const userTz = prefRow?.value ? safeJson(prefRow.value) : null;
    const isValidTz = (tz) => {
      if (!tz || typeof tz !== 'string') return false;
      try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
      catch { return false; }
    };
    let timezone = isValidTz(userTz) ? userTz : null;
    if (!timezone) {
      try {
        const serverTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        timezone = isValidTz(serverTz) ? serverTz : 'UTC';
      } catch { timezone = 'UTC'; }
    }

    const ctx = { userId, timezone, now: new Date(), q };
    const observation = await pickObservation(ctx, OBSERVERS, suppressed);

    res.json({ ok: true, observation });
  } catch (err) {
    console.error('GET /api/observations/current error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/observations/dismiss
 * Body: { id, kind }
 *
 * Records a dismissal for this observation id. If the user has now dismissed
 * the same kind 3 times, the kind is permanently suppressed for them — that's
 * the trust contract: a banner that won't shut up loses the user.
 */
router.post('/api/observations/dismiss', (req, res) => {
  try {
    const userId = req.user.id;
    const { id, kind } = req.body || {};
    if (typeof id !== 'string' || typeof kind !== 'string') {
      return res.status(400).json({ ok: false, error: 'id and kind required' });
    }
    if (id.length > 200 || kind.length > 64) {
      return res.status(400).json({ ok: false, error: 'id or kind too long' });
    }

    // Insert/bump the specific-id dismissal. The id encodes the kind via
    // its `kind:rest` shape, so we can count kind-scoped dismissals without
    // a separate column.
    q(`
      INSERT INTO observation_dismissals (user_id, key, dismiss_count, dismissed_at)
      VALUES (?, ?, 1, datetime('now'))
      ON CONFLICT(user_id, key) DO UPDATE SET
        dismiss_count = dismiss_count + 1,
        dismissed_at = datetime('now')
    `).run(userId, `id:${id}`);

    // Count how many distinct ids of THIS kind have been dismissed in the
    // last 90 days. Observation ids are conventionally `<kind>:<rest>`, so
    // a key prefix of `id:<kind>:` matches the family.
    const kindDismissals = q(`
      SELECT COUNT(*) AS c FROM observation_dismissals
       WHERE user_id = ?
         AND key LIKE ?
         AND dismissed_at >= datetime('now', '-90 days')
    `).get(userId, `id:${kind}:%`);

    if (kindDismissals.c >= 3) {
      q(`
        INSERT INTO observation_dismissals (user_id, key, dismiss_count, dismissed_at)
        VALUES (?, ?, 1, datetime('now'))
        ON CONFLICT(user_id, key) DO UPDATE SET
          dismiss_count = dismiss_count + 1,
          dismissed_at = datetime('now')
      `).run(userId, `kind:${kind}`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/observations/dismiss error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function safeJson(s) {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
}

export default router;
