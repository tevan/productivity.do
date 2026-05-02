// Trash routes — list deleted items, restore a row, purge a row, empty
// the trash. Per-user via req.user.id. Each route is a thin wrapper
// around the helpers in lib/trash.js so business rules stay in one place.

import { Router } from 'express';
import { getDb } from '../db/init.js';
import { listTrashed, restore, purge, TRASH_TABLES } from '../lib/trash.js';

const router = Router();

router.get('/api/trash', (req, res) => {
  const items = listTrashed(getDb(), req.user.id);
  res.json({ ok: true, items });
});

// Restore a single row. Body shape: { resource: 'notes' | ..., id }.
router.post('/api/trash/restore', (req, res) => {
  const { resource, id } = req.body || {};
  if (!resource || id == null) return res.status(400).json({ ok: false, error: 'resource and id required' });
  if (!TRASH_TABLES[resource]) return res.status(400).json({ ok: false, error: 'unknown resource' });
  const ok = restore(getDb(), resource, id, req.user.id);
  if (!ok) return res.status(404).json({ ok: false, error: 'Not in trash' });
  res.json({ ok: true });
});

// Purge a single row immediately (skip the 30-day window). Same body shape.
router.post('/api/trash/purge', (req, res) => {
  const { resource, id } = req.body || {};
  if (!resource || id == null) return res.status(400).json({ ok: false, error: 'resource and id required' });
  if (!TRASH_TABLES[resource]) return res.status(400).json({ ok: false, error: 'unknown resource' });
  const ok = purge(getDb(), resource, id, req.user.id);
  if (!ok) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

// Empty everything currently in trash for this user. Used by the
// "Empty trash" button in Settings → Trash.
router.post('/api/trash/empty', (req, res) => {
  const db = getDb();
  let total = 0;
  for (const t of Object.values(TRASH_TABLES)) {
    const r = db.prepare(`
      DELETE FROM ${t}
       WHERE user_id = ? AND deleted_at IS NOT NULL
    `).run(req.user.id);
    total += r.changes;
  }
  res.json({ ok: true, purged: total });
});

export default router;
