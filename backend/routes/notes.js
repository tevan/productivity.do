/**
 * Notes — local markdown jot-down storage. Per-user, full CRUD. Pinned notes
 * sort to the top; archived notes hidden unless `?archived=1`.
 */

import { Router } from 'express';
import { getDb } from '../db/init.js';
import { softDelete, purge } from '../lib/trash.js';
import { recordRevision } from '../lib/revisions.js';

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
  // Trashed notes are filtered out unconditionally — they live behind the
  // dedicated /api/trash surface. Archived notes still show with ?archived=1.
  const includeArchived = req.query.archived === '1';
  const sql = includeArchived
    ? 'SELECT * FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC'
    : 'SELECT * FROM notes WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY pinned DESC, updated_at DESC';
  const rows = getDb().prepare(sql).all(req.user.id);
  res.json({ ok: true, notes: rows.map(toNote) });
});

router.get('/api/notes/:id', (req, res) => {
  const row = getDb().prepare('SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
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
  const note = toNote(row);
  recordRevision({ userId: req.user.id, resource: 'notes', resourceId: note.id, op: 'create', before: null, after: note });
  res.json({ ok: true, note });
});

router.put('/api/notes/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
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
  const before = toNote(existing);
  db.prepare(`
    UPDATE notes
    SET title = ?, body = ?, pinned = ?, color = ?, archived_at = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(merged.title, merged.body, merged.pinned, merged.color, merged.archived_at, req.params.id, req.user.id);
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  const after = toNote(row);
  recordRevision({ userId: req.user.id, resource: 'notes', resourceId: req.params.id, op: 'update', before, after });
  res.json({ ok: true, note: after });
});

router.delete('/api/notes/:id', (req, res) => {
  // Soft-delete by default (30-day recovery window). Pass ?permanent=1 to
  // hard-delete immediately — used by Settings → Trash → "Delete forever".
  const db = getDb();
  const existing = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  const before = existing ? toNote(existing) : null;
  const permanent = req.query.permanent === '1' || req.query.permanent === 'true';
  const ok = permanent
    ? purge(db, 'notes', req.params.id, req.user.id)
    : softDelete(db, 'notes', req.params.id, req.user.id);
  if (!ok) return res.status(404).json({ ok: false, error: 'Not found' });
  recordRevision({
    userId: req.user.id, resource: 'notes', resourceId: req.params.id,
    op: permanent ? 'delete' : 'soft_delete',
    before, after: null,
  });
  res.json({ ok: true });
});

// ---- Revision history ----------------------------------------------------
import { listRevisions } from '../lib/revisions.js';

router.get('/api/notes/:id/revisions', (req, res) => {
  // Caller must own the note (or it must currently be in their trash —
  // restoring from a revision is a valid recovery flow even after the
  // note was soft-deleted, as long as the row still exists).
  const owner = getDb().prepare('SELECT user_id FROM notes WHERE id = ?').get(req.params.id);
  if (!owner || owner.user_id !== req.user.id) {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }
  const revisions = listRevisions({
    userId: req.user.id, resource: 'notes', resourceId: req.params.id,
  });
  res.json({ ok: true, revisions });
});

// Restore the note's body+title+color+pinned to the snapshot in
// revision :revId. Records a new 'restore' revision so the user can
// scroll forward again if they change their mind.
router.post('/api/notes/:id/revisions/:revId/restore', (req, res) => {
  const db = getDb();
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!note) return res.status(404).json({ ok: false, error: 'Not found' });
  const rev = db.prepare(`
    SELECT after_json FROM revisions WHERE id = ? AND user_id = ? AND resource = 'notes' AND resource_id = ?
  `).get(req.params.revId, req.user.id, req.params.id);
  if (!rev || !rev.after_json) return res.status(404).json({ ok: false, error: 'Revision not found' });
  let snap;
  try { snap = JSON.parse(rev.after_json); } catch { return res.status(500).json({ ok: false, error: 'Bad revision' }); }
  const before = toNote(note);
  db.prepare(`
    UPDATE notes SET title = ?, body = ?, pinned = ?, color = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?
  `).run(
    snap.title ?? note.title,
    snap.body ?? note.body,
    snap.pinned ? 1 : 0,
    sanitizeColor(snap.color),
    req.params.id, req.user.id,
  );
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  const after = toNote(row);
  recordRevision({
    userId: req.user.id, resource: 'notes', resourceId: req.params.id,
    op: 'restore', before, after,
  });
  res.json({ ok: true, note: after });
});

// ---------------------------------------------------------------------------
// Comments on notes — Scope A of the collaboration plan. Author-only for now;
// when sharing ships, recipients of a shared note can post too.
// ---------------------------------------------------------------------------

const MAX_COMMENT = 10_000;

function ownsNote(userId, noteId) {
  const row = getDb().prepare(
    "SELECT 1 FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
  ).get(noteId, userId);
  return !!row;
}

router.get('/api/notes/:id/comments', (req, res) => {
  const userId = req.session.userId;
  const noteId = Number(req.params.id);
  if (!ownsNote(userId, noteId)) {
    return res.status(404).json({ ok: false, error: 'Note not found' });
  }
  const rows = getDb().prepare(
    "SELECT id, user_id AS userId, body, created_at AS createdAt, updated_at AS updatedAt FROM note_comments WHERE note_id = ? AND deleted_at IS NULL ORDER BY created_at ASC"
  ).all(noteId);
  res.json({ ok: true, comments: rows });
});

router.post('/api/notes/:id/comments', (req, res) => {
  const userId = req.session.userId;
  const noteId = Number(req.params.id);
  if (!ownsNote(userId, noteId)) {
    return res.status(404).json({ ok: false, error: 'Note not found' });
  }
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ ok: false, error: 'body required' });
  if (body.length > MAX_COMMENT) {
    return res.status(400).json({ ok: false, error: `body must be <= ${MAX_COMMENT} chars` });
  }
  const r = getDb().prepare(
    "INSERT INTO note_comments (user_id, note_id, body) VALUES (?, ?, ?)"
  ).run(userId, noteId, body);
  const row = getDb().prepare(
    "SELECT id, user_id AS userId, body, created_at AS createdAt, updated_at AS updatedAt FROM note_comments WHERE id = ?"
  ).get(r.lastInsertRowid);
  res.json({ ok: true, comment: row });
});

router.put('/api/notes/:id/comments/:commentId', (req, res) => {
  const userId = req.session.userId;
  const noteId = Number(req.params.id);
  const commentId = Number(req.params.commentId);
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ ok: false, error: 'body required' });
  if (body.length > MAX_COMMENT) {
    return res.status(400).json({ ok: false, error: `body must be <= ${MAX_COMMENT} chars` });
  }
  // Author-only edit. UPDATE returns 0 rows if the user doesn't own it.
  const r = getDb().prepare(
    "UPDATE note_comments SET body = ?, updated_at = datetime('now') WHERE id = ? AND note_id = ? AND user_id = ? AND deleted_at IS NULL"
  ).run(body, commentId, noteId, userId);
  if (r.changes === 0) return res.status(404).json({ ok: false, error: 'Comment not found' });
  const row = getDb().prepare(
    "SELECT id, user_id AS userId, body, created_at AS createdAt, updated_at AS updatedAt FROM note_comments WHERE id = ?"
  ).get(commentId);
  res.json({ ok: true, comment: row });
});

router.delete('/api/notes/:id/comments/:commentId', (req, res) => {
  const userId = req.session.userId;
  const noteId = Number(req.params.id);
  const commentId = Number(req.params.commentId);
  // Soft-delete so revisions/audit can still see the post-edit history.
  const r = getDb().prepare(
    "UPDATE note_comments SET deleted_at = datetime('now') WHERE id = ? AND note_id = ? AND user_id = ? AND deleted_at IS NULL"
  ).run(commentId, noteId, userId);
  if (r.changes === 0) return res.status(404).json({ ok: false, error: 'Comment not found' });
  res.json({ ok: true });
});

export default router;
