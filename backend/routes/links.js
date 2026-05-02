// Cross-resource links — attach a task or note to an event (or task↔note).
// Storage-only: doesn't mutate Todoist/Google. Survives upstream renames.
import { Router } from 'express';
import { getDb } from '../db/init.js';

const router = Router();

const VALID_TYPES = new Set(['task', 'note', 'event']);

function validate(body) {
  const { fromType, fromId, toType, toId } = body || {};
  if (!VALID_TYPES.has(fromType) || !VALID_TYPES.has(toType)) return 'Invalid type';
  if (!fromId || !toId) return 'Missing id';
  if (fromType === toType && String(fromId) === String(toId)) return 'Cannot link to self';
  return null;
}

// Normalize so (task→event) and (event→task) refer to the same row.
// We always store the lower-precedence type as `from` for canonical form:
// event > note > task (alpha ordering for predictability).
function normalize({ fromType, fromId, toType, toId }) {
  const order = ['event', 'note', 'task'];
  if (order.indexOf(fromType) > order.indexOf(toType)) {
    return { fromType: toType, fromId: toId, toType: fromType, toId: fromId };
  }
  if (fromType === toType && String(fromId) > String(toId)) {
    return { fromType, fromId: toId, toType, toId: fromId };
  }
  return { fromType, fromId, toType, toId };
}

// POST /api/links — create a link between two resources
router.post('/api/links', (req, res) => {
  const userId = req.user?.id || req.session?.userId;
  if (!userId) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const err = validate(req.body);
  if (err) return res.status(400).json({ ok: false, error: err });
  const norm = normalize(req.body);
  const db = getDb();
  try {
    const result = db.prepare(`
      INSERT INTO links (user_id, from_type, from_id, to_type, to_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, from_type, from_id, to_type, to_id) DO NOTHING
    `).run(userId, norm.fromType, String(norm.fromId), norm.toType, String(norm.toId));
    const row = db.prepare('SELECT * FROM links WHERE user_id = ? AND from_type = ? AND from_id = ? AND to_type = ? AND to_id = ?')
      .get(userId, norm.fromType, String(norm.fromId), norm.toType, String(norm.toId));
    res.json({ ok: true, link: row });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/links — list every link for the current user, plus a small index
// keyed by `${type}:${id}` so the SPA can look up "what's linked to this event".
router.get('/api/links', (req, res) => {
  const userId = req.user?.id || req.session?.userId;
  if (!userId) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const db = getDb();
  const rows = db.prepare('SELECT * FROM links WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  // Build a directed-ish index: each row contributes to BOTH endpoints' lists.
  // Consumers usually ask "what links does THIS resource have?" so it's cheap
  // to precompute both directions here once.
  const byKey = {};
  for (const r of rows) {
    const a = `${r.from_type}:${r.from_id}`;
    const b = `${r.to_type}:${r.to_id}`;
    (byKey[a] ||= []).push({ id: r.id, type: r.to_type, refId: r.to_id });
    (byKey[b] ||= []).push({ id: r.id, type: r.from_type, refId: r.from_id });
  }
  res.json({ ok: true, links: rows, byKey });
});

// DELETE /api/links/:id
router.delete('/api/links/:id', (req, res) => {
  const userId = req.user?.id || req.session?.userId;
  if (!userId) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const db = getDb();
  const r = db.prepare('DELETE FROM links WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  if (r.changes === 0) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

export default router;
