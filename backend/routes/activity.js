// Cross-resource activity feed.
//
// Surfaces in Settings → Account → Activity. Returns the most recent
// revisions across all tracked resources for the calling user. The
// per-resource history endpoints (e.g. /api/notes/:id/revisions) are
// the deeper drill-in.

import { Router } from 'express';
import { recentActivity } from '../lib/revisions.js';

const router = Router();

router.get('/api/activity', (req, res) => {
  const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 100));
  const items = recentActivity({ userId: req.user.id, limit });
  res.json({ ok: true, items });
});

// One revision's full payload (after-state). Used by the activity dropdown
// when "jump to event" needs the start time — the list endpoint returns just
// label + meta to keep the response small. Scoped by user so a stolen
// revision id can't leak someone else's payload.
import { getDb } from '../db/init.js';
router.get('/api/activity/:id/payload', (req, res) => {
  const row = getDb().prepare(
    'SELECT after_json FROM revisions WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
  let payload = null;
  try { payload = row.after_json ? JSON.parse(row.after_json) : null; }
  catch {}
  res.json({ ok: true, payload });
});

export default router;
