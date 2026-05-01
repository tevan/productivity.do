/**
 * Notes — local markdown jot-down storage. Per-user, full CRUD. Pinned notes
 * sort to the top; archived notes hidden unless `?archived=1`.
 */

import { Router } from 'express';
import { getDb } from '../db/init.js';

const router = Router();

const MAX_TITLE = 200;
const MAX_BODY = 200_000; // ~200KB per note

// Allow named scheme slots ('rose', 'sky', …) and 6/8-digit hex strings.
// Anything else is rejected so we don't store arbitrary garbage that could
// break CSS or be used as a script-injection vector via inline style.
const ALLOWED_COLOR_SLOTS = new Set([
  'sky', 'lavender', 'rose', 'peach', 'mint', 'sage',
  'butter', 'coral', 'lilac', 'cloud', 'powder', 'blush',
]);
function sanitizeColor(input) {
  if (input == null || input === '') return null;
  if (typeof input !== 'string') return null;
  const v = input.trim().toLowerCase();
  if (ALLOWED_COLOR_SLOTS.has(v)) return v;
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v)) return v;
  return null;
}

function toNote(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: !!row.pinned,
    color: row.color || null,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get('/api/notes', (req, res) => {
  const includeArchived = req.query.archived === '1';
  const sql = includeArchived
    ? 'SELECT * FROM notes WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC'
    : 'SELECT * FROM notes WHERE user_id = ? AND archived_at IS NULL ORDER BY pinned DESC, updated_at DESC';
  const rows = getDb().prepare(sql).all(req.user.id);
  res.json({ ok: true, notes: rows.map(toNote) });
});

router.get('/api/notes/:id', (req, res) => {
  const row = getDb().prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, note: toNote(row) });
});

router.post('/api/notes', (req, res) => {
  const { title = '', body = '', pinned = false, color = null } = req.body || {};
  if (typeof title !== 'string' || typeof body !== 'string') {
    return res.status(400).json({ ok: false, error: 'title and body must be strings' });
  }
  if (title.length > MAX_TITLE) return res.status(400).json({ ok: false, error: 'title too long' });
  if (body.length > MAX_BODY) return res.status(400).json({ ok: false, error: 'body too long' });
  const result = getDb().prepare(`
    INSERT INTO notes (user_id, title, body, pinned, color)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, title, body, pinned ? 1 : 0, sanitizeColor(color));
  const row = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ok: true, note: toNote(row) });
});

router.put('/api/notes/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });
  const { title, body, pinned, archived, color } = req.body || {};
  const merged = {
    title: title !== undefined ? String(title) : existing.title,
    body: body !== undefined ? String(body) : existing.body,
    pinned: pinned !== undefined ? (pinned ? 1 : 0) : existing.pinned,
    color: color !== undefined ? sanitizeColor(color) : existing.color,
    archived_at: archived === true ? (existing.archived_at || new Date().toISOString())
      : archived === false ? null
      : existing.archived_at,
  };
  if (merged.title.length > MAX_TITLE) return res.status(400).json({ ok: false, error: 'title too long' });
  if (merged.body.length > MAX_BODY) return res.status(400).json({ ok: false, error: 'body too long' });
  db.prepare(`
    UPDATE notes
    SET title = ?, body = ?, pinned = ?, color = ?, archived_at = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(merged.title, merged.body, merged.pinned, merged.color, merged.archived_at, req.params.id, req.user.id);
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  res.json({ ok: true, note: toNote(row) });
});

router.delete('/api/notes/:id', (req, res) => {
  const result = getDb().prepare('DELETE FROM notes WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

export default router;
