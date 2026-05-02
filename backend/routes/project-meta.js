// Per-project metadata productivity.do owns (Todoist doesn't store these).
// Source of truth for: due_date, intent_line, rhythm_json, pinned_at.
//
// Project IDs are strings so this table covers BOTH Todoist projects (their
// string ID) and native projects (encoded as `native:<int>`). The CRUD
// surface is intentionally tiny: list-all + upsert.

import { Router } from 'express';
import { q, getDb } from '../db/init.js';

const router = Router();

const MAX_PINNED = 3;

// GET /api/project-meta — every row for the user. Cheap (≤ a few hundred
// rows in the worst case). Used by the ranker, the sidebar's pin
// indicators, and the project page.
router.get('/api/project-meta', (req, res) => {
  const rows = q(`
    SELECT project_id, due_date, intent_line, rhythm_json, pinned_at,
           created_at, updated_at
      FROM project_meta
     WHERE user_id = ?
  `).all(req.user.id);
  res.json({
    ok: true,
    items: rows.map(r => ({
      projectId: r.project_id,
      dueDate: r.due_date,
      intentLine: r.intent_line,
      rhythm: parseJson(r.rhythm_json),
      pinnedAt: r.pinned_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
});

// PUT /api/project-meta/:projectId — upsert. Body fields are individually
// optional; passing `null` for any field clears it. Body shape:
//
//   { dueDate?: 'YYYY-MM-DD' | null,
//     intentLine?: string | null,
//     rhythm?: {mon:[{start,end}], ...} | null,
//     pinned?: boolean }
//
// `pinned: true` writes pinned_at = now(); `pinned: false` writes null.
// Cap of 3 pinned rows enforced server-side; over the cap returns 409.
router.put('/api/project-meta/:projectId', (req, res) => {
  const userId = req.user.id;
  const projectId = String(req.params.projectId);
  if (!projectId || projectId.length > 64) {
    return res.status(400).json({ ok: false, error: 'invalid projectId' });
  }

  const db = getDb();
  const existing = db.prepare(
    'SELECT * FROM project_meta WHERE user_id = ? AND project_id = ?'
  ).get(userId, projectId);

  // Pin enforcement: if requesting pin=true and 3 are already pinned (and
  // this isn't already pinned), refuse with a clear error.
  if (req.body?.pinned === true && (!existing || !existing.pinned_at)) {
    const count = db.prepare(
      'SELECT COUNT(*) AS n FROM project_meta WHERE user_id = ? AND pinned_at IS NOT NULL'
    ).get(userId).n;
    if (count >= MAX_PINNED) {
      return res.status(409).json({
        ok: false,
        code: 'pin_limit',
        error: `You can pin up to ${MAX_PINNED} projects. Unpin one first.`,
      });
    }
  }

  // Build the patched row by overlaying body fields onto existing.
  const next = {
    due_date: existing?.due_date ?? null,
    intent_line: existing?.intent_line ?? null,
    rhythm_json: existing?.rhythm_json ?? null,
    pinned_at: existing?.pinned_at ?? null,
  };

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'dueDate')) {
    const v = req.body.dueDate;
    if (v === null || v === '') next.due_date = null;
    else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) next.due_date = v;
    else return res.status(400).json({ ok: false, error: 'dueDate must be YYYY-MM-DD or null' });
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'intentLine')) {
    const v = req.body.intentLine;
    if (v === null || v === '') next.intent_line = null;
    else if (typeof v === 'string' && v.length <= 280) next.intent_line = v.trim();
    else return res.status(400).json({ ok: false, error: 'intentLine must be ≤280 chars or null' });
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'rhythm')) {
    const v = req.body.rhythm;
    if (v === null) next.rhythm_json = null;
    else if (typeof v === 'object') next.rhythm_json = JSON.stringify(v);
    else return res.status(400).json({ ok: false, error: 'rhythm must be object or null' });
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'pinned')) {
    next.pinned_at = req.body.pinned ? (existing?.pinned_at || new Date().toISOString()) : null;
  }

  // Drop the row entirely if everything is empty — keeps the table clean.
  const allEmpty = next.due_date === null && next.intent_line === null
    && next.rhythm_json === null && next.pinned_at === null;
  if (allEmpty) {
    db.prepare('DELETE FROM project_meta WHERE user_id = ? AND project_id = ?')
      .run(userId, projectId);
    return res.json({ ok: true, item: null });
  }

  db.prepare(`
    INSERT INTO project_meta (user_id, project_id, due_date, intent_line, rhythm_json, pinned_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, project_id) DO UPDATE SET
      due_date    = excluded.due_date,
      intent_line = excluded.intent_line,
      rhythm_json = excluded.rhythm_json,
      pinned_at   = excluded.pinned_at,
      updated_at  = datetime('now')
  `).run(userId, projectId, next.due_date, next.intent_line, next.rhythm_json, next.pinned_at);

  const row = db.prepare(
    'SELECT * FROM project_meta WHERE user_id = ? AND project_id = ?'
  ).get(userId, projectId);

  res.json({
    ok: true,
    item: {
      projectId: row.project_id,
      dueDate: row.due_date,
      intentLine: row.intent_line,
      rhythm: parseJson(row.rhythm_json),
      pinnedAt: row.pinned_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
});

function parseJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

export default router;
