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

export default router;
