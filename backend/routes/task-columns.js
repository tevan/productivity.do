// Task board columns — per-user kanban configuration.
// See docs/internal/tasks-board.md for the full design.
//
// Defaults seeded on first read: To Do / In Progress / Done.
// Cap: MAX_COLUMNS (5). Done is required and cannot be removed.

import { Router } from 'express';
import { getDb } from '../db/init.js';

const router = Router();

const MAX_COLUMNS = 5;

const DEFAULT_COLUMNS = [
  { position: 0, name: 'To Do',       status_key: 'todo' },
  { position: 1, name: 'In Progress', status_key: 'in_progress' },
  { position: 2, name: 'Done',        status_key: 'done' },
];

// Status keys we own. 'done' is special — it's a virtual column that reads
// from Todoist's completion flag, not from tasks_cache.local_status.
const RESERVED_KEYS = new Set(['todo', 'in_progress', 'done']);
const CUSTOM_KEY_RE = /^custom_[A-Za-z0-9_-]{1,32}$/;

function isValidStatusKey(key) {
  return RESERVED_KEYS.has(key) || CUSTOM_KEY_RE.test(key);
}

function ensureSeeded(db, userId) {
  const existing = db.prepare(
    'SELECT COUNT(*) AS n FROM task_columns WHERE user_id = ?'
  ).get(userId).n;
  if (existing > 0) return;
  const insert = db.prepare(
    'INSERT INTO task_columns (user_id, position, name, status_key) VALUES (?, ?, ?, ?)'
  );
  const seed = db.transaction(() => {
    for (const col of DEFAULT_COLUMNS) {
      insert.run(userId, col.position, col.name, col.status_key);
    }
  });
  seed();
}

function listColumns(db, userId) {
  return db.prepare(
    'SELECT id, position, name, status_key, color FROM task_columns WHERE user_id = ? ORDER BY position ASC'
  ).all(userId);
}

function shape(col) {
  return {
    id: col.id,
    position: col.position,
    name: col.name,
    statusKey: col.status_key,
    color: col.color || null,
  };
}

// Allow null (clear) or a 7-char hex string. Reject anything else so
// arbitrary CSS doesn't end up in the DB → DOM.
function normalizeColor(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  return undefined; // sentinel — caller should 400
}

// ---------------------------------------------------------------------------
// GET /api/task-columns — list the user's columns (auto-seeds defaults)
// ---------------------------------------------------------------------------
router.get('/api/task-columns', (req, res) => {
  try {
    const db = getDb();
    ensureSeeded(db, req.user.id);
    res.json({ ok: true, columns: listColumns(db, req.user.id).map(shape) });
  } catch (err) {
    console.error('GET /api/task-columns error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/task-columns — add a custom column. Body: { name }.
// status_key is auto-generated as `custom_<n>`. Capped at MAX_COLUMNS.
// ---------------------------------------------------------------------------
router.post('/api/task-columns', (req, res) => {
  try {
    const db = getDb();
    ensureSeeded(db, req.user.id);
    const { name } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ ok: false, error: 'name required' });
    }

    const cols = listColumns(db, req.user.id);
    if (cols.length >= MAX_COLUMNS) {
      return res.status(400).json({ ok: false, error: `Max ${MAX_COLUMNS} columns` });
    }

    // Pick a fresh custom_<n> key.
    const used = new Set(cols.map(c => c.status_key));
    let n = cols.length;
    while (used.has(`custom_${n}`)) n += 1;
    const status_key = `custom_${n}`;

    // Insert before the Done column so Done stays rightmost.
    const doneCol = cols.find(c => c.status_key === 'done');
    const insertPos = doneCol ? doneCol.position : cols.length;

    const tx = db.transaction(() => {
      // Shift Done (and anything past it) right by 1.
      db.prepare(
        'UPDATE task_columns SET position = position + 1 WHERE user_id = ? AND position >= ?'
      ).run(req.user.id, insertPos);
      const info = db.prepare(
        'INSERT INTO task_columns (user_id, position, name, status_key) VALUES (?, ?, ?, ?)'
      ).run(req.user.id, insertPos, name.trim().slice(0, 40), status_key);
      return info.lastInsertRowid;
    });
    const id = tx();
    const row = db.prepare(
      'SELECT id, position, name, status_key, color FROM task_columns WHERE id = ?'
    ).get(id);
    res.json({ ok: true, column: shape(row) });
  } catch (err) {
    console.error('POST /api/task-columns error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/task-columns/:id — rename a column. Body: { name }.
// Position changes go through PUT /api/task-columns/order (separate endpoint).
// ---------------------------------------------------------------------------
router.put('/api/task-columns/:id', (req, res) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const { name, color } = req.body || {};
    // Build a partial update: name and/or color. At least one must be present.
    const sets = [];
    const args = [];
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ ok: false, error: 'name required' });
      }
      sets.push('name = ?');
      args.push(name.trim().slice(0, 40));
    }
    if (color !== undefined) {
      const c = normalizeColor(color);
      if (c === undefined) return res.status(400).json({ ok: false, error: 'color must be #RRGGBB or null' });
      sets.push('color = ?');
      args.push(c);
    }
    if (sets.length === 0) {
      return res.status(400).json({ ok: false, error: 'name or color required' });
    }
    args.push(id, req.user.id);
    const info = db.prepare(
      `UPDATE task_columns SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`
    ).run(...args);
    if (info.changes === 0) {
      return res.status(404).json({ ok: false, error: 'Column not found' });
    }
    const row = db.prepare(
      'SELECT id, position, name, status_key, color FROM task_columns WHERE id = ?'
    ).get(id);
    res.json({ ok: true, column: shape(row) });
  } catch (err) {
    console.error('PUT /api/task-columns/:id error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/task-columns/order — reorder columns. Body: { ids: [id, id, ...] }.
// The array's index becomes the new position. Done is forced to the right.
// ---------------------------------------------------------------------------
router.put('/api/task-columns/order', (req, res) => {
  try {
    const db = getDb();
    const { ids } = req.body || {};
    if (!Array.isArray(ids)) {
      return res.status(400).json({ ok: false, error: 'ids array required' });
    }
    const cols = listColumns(db, req.user.id);
    const owned = new Map(cols.map(c => [c.id, c]));
    // Keep Done rightmost regardless of where the user dragged it.
    const doneId = cols.find(c => c.status_key === 'done')?.id;
    const ordered = ids.filter(id => owned.has(id) && id !== doneId);
    if (doneId) ordered.push(doneId);

    const tx = db.transaction(() => {
      const upd = db.prepare(
        'UPDATE task_columns SET position = ? WHERE id = ? AND user_id = ?'
      );
      ordered.forEach((id, idx) => upd.run(idx, id, req.user.id));
    });
    tx();

    res.json({ ok: true, columns: listColumns(db, req.user.id).map(shape) });
  } catch (err) {
    console.error('PUT /api/task-columns/order error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/task-columns/:id — remove a custom column. Tasks with the
// matching local_status get reset to NULL so they don't disappear; they fall
// into the To Do column.
// 'todo' / 'in_progress' / 'done' cannot be deleted (system columns).
// ---------------------------------------------------------------------------
router.delete('/api/task-columns/:id', (req, res) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const col = db.prepare(
      'SELECT id, status_key FROM task_columns WHERE id = ? AND user_id = ?'
    ).get(id, req.user.id);
    if (!col) return res.status(404).json({ ok: false, error: 'Column not found' });
    if (RESERVED_KEYS.has(col.status_key)) {
      return res.status(400).json({ ok: false, error: 'Cannot delete a system column' });
    }

    const tx = db.transaction(() => {
      // Move tasks in this column back to To Do (null = default).
      db.prepare(
        "UPDATE tasks_cache SET local_status = NULL WHERE user_id = ? AND local_status = ?"
      ).run(req.user.id, col.status_key);
      db.prepare('DELETE FROM task_columns WHERE id = ? AND user_id = ?').run(id, req.user.id);
      // Re-pack positions so they stay 0..N-1.
      const remaining = db.prepare(
        'SELECT id FROM task_columns WHERE user_id = ? ORDER BY position ASC'
      ).all(req.user.id);
      const upd = db.prepare(
        'UPDATE task_columns SET position = ? WHERE id = ? AND user_id = ?'
      );
      remaining.forEach((r, idx) => upd.run(idx, r.id, req.user.id));
    });
    tx();

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/task-columns/:id error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
export { isValidStatusKey, MAX_COLUMNS };
