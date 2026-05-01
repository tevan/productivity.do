// Native events + tasks + projects — the user can use the app with no
// third-party integrations. These routes write directly to the
// events_native, tasks_native, and projects_native tables.
//
// The existing /api/events and /api/tasks routes UNION across providers
// in their list handlers (see calendar.js + tasks.js for that merge).
// These routes are the *write* path for the native source.

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { q } from '../db/init.js';

const router = Router();

// ----- Native events -----

router.get('/api/native/events', (req, res) => {
  const { from, to } = req.query;
  // Accept ISO timestamps or YYYY-MM-DD; SQLite string compare works for both.
  const rows = q(`
    SELECT * FROM events_native
    WHERE user_id = ?
      AND (? IS NULL OR end_at >= ?)
      AND (? IS NULL OR start_at <= ?)
    ORDER BY start_at
  `).all(req.user.id, from || null, from || null, to || null, to || null);
  res.json({ ok: true, events: rows.map(toEvent) });
});

router.post('/api/native/events', (req, res) => {
  const { summary = '', description = null, location = null,
          start, end, allDay = false, color = null, recurrence = null } = req.body || {};
  if (!start || !end) return res.status(400).json({ ok: false, error: 'start and end are required' });
  const id = randomUUID();
  q(`
    INSERT INTO events_native
      (id, user_id, summary, description, location, start_at, end_at, all_day, color, recurrence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user.id, String(summary), description, location,
    start, end, allDay ? 1 : 0, color,
    recurrence ? JSON.stringify(recurrence) : null
  );
  const row = q('SELECT * FROM events_native WHERE id = ?').get(id);
  res.json({ ok: true, event: toEvent(row) });
});

router.put('/api/native/events/:id', (req, res) => {
  const existing = q('SELECT * FROM events_native WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });
  const m = {
    summary: req.body.summary !== undefined ? String(req.body.summary) : existing.summary,
    description: req.body.description !== undefined ? req.body.description : existing.description,
    location: req.body.location !== undefined ? req.body.location : existing.location,
    start_at: req.body.start !== undefined ? req.body.start : existing.start_at,
    end_at: req.body.end !== undefined ? req.body.end : existing.end_at,
    all_day: req.body.allDay !== undefined ? (req.body.allDay ? 1 : 0) : existing.all_day,
    color: req.body.color !== undefined ? req.body.color : existing.color,
    recurrence_json: req.body.recurrence !== undefined
      ? (req.body.recurrence ? JSON.stringify(req.body.recurrence) : null)
      : existing.recurrence_json,
  };
  q(`
    UPDATE events_native
    SET summary = ?, description = ?, location = ?, start_at = ?, end_at = ?,
        all_day = ?, color = ?, recurrence_json = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(m.summary, m.description, m.location, m.start_at, m.end_at,
         m.all_day, m.color, m.recurrence_json, req.params.id, req.user.id);
  const row = q('SELECT * FROM events_native WHERE id = ?').get(req.params.id);
  res.json({ ok: true, event: toEvent(row) });
});

router.delete('/api/native/events/:id', (req, res) => {
  const r = q('DELETE FROM events_native WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (r.changes === 0) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

function toEvent(row) {
  return {
    id: row.id,
    calendarId: 'native',
    provider: 'native',
    summary: row.summary,
    description: row.description,
    location: row.location,
    start: row.start_at,
    end: row.end_at,
    allDay: !!row.all_day,
    color: row.color,
    recurrence: row.recurrence_json ? safeParse(row.recurrence_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ----- Native tasks -----

router.get('/api/native/tasks', (req, res) => {
  const rows = q(`
    SELECT * FROM tasks_native WHERE user_id = ?
    ORDER BY is_completed, COALESCE(due_date, '9999'), priority DESC
  `).all(req.user.id);
  res.json({ ok: true, tasks: rows.map(toTask) });
});

router.post('/api/native/tasks', (req, res) => {
  const id = randomUUID();
  const t = req.body || {};
  q(`
    INSERT INTO tasks_native
      (id, user_id, content, description, project_id, priority,
       due_date, due_datetime, labels_json, estimated_minutes,
       local_status, parent_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user.id,
    String(t.content || ''),
    t.description || null,
    t.projectId || null,
    Number(t.priority) || 1,
    t.dueDate || null,
    t.dueDatetime || null,
    Array.isArray(t.labels) ? JSON.stringify(t.labels) : null,
    t.estimatedMinutes || null,
    t.localStatus || null,
    t.parentId || null
  );
  const row = q('SELECT * FROM tasks_native WHERE id = ?').get(id);
  res.json({ ok: true, task: toTask(row) });
});

router.put('/api/native/tasks/:id', (req, res) => {
  const existing = q('SELECT * FROM tasks_native WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });
  const t = req.body || {};
  const m = {
    content: t.content !== undefined ? String(t.content) : existing.content,
    description: t.description !== undefined ? t.description : existing.description,
    project_id: t.projectId !== undefined ? t.projectId : existing.project_id,
    priority: t.priority !== undefined ? Number(t.priority) : existing.priority,
    due_date: t.dueDate !== undefined ? t.dueDate : existing.due_date,
    due_datetime: t.dueDatetime !== undefined ? t.dueDatetime : existing.due_datetime,
    labels_json: t.labels !== undefined
      ? (Array.isArray(t.labels) ? JSON.stringify(t.labels) : null)
      : existing.labels_json,
    estimated_minutes: t.estimatedMinutes !== undefined ? t.estimatedMinutes : existing.estimated_minutes,
    local_status: t.localStatus !== undefined ? t.localStatus : existing.local_status,
    local_position: t.localPosition !== undefined ? t.localPosition : existing.local_position,
    parent_id: t.parentId !== undefined ? t.parentId : existing.parent_id,
  };
  q(`
    UPDATE tasks_native SET
      content = ?, description = ?, project_id = ?, priority = ?,
      due_date = ?, due_datetime = ?, labels_json = ?, estimated_minutes = ?,
      local_status = ?, local_position = ?, parent_id = ?,
      updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(m.content, m.description, m.project_id, m.priority,
         m.due_date, m.due_datetime, m.labels_json, m.estimated_minutes,
         m.local_status, m.local_position, m.parent_id,
         req.params.id, req.user.id);
  const row = q('SELECT * FROM tasks_native WHERE id = ?').get(req.params.id);
  res.json({ ok: true, task: toTask(row) });
});

router.post('/api/native/tasks/:id/complete', (req, res) => {
  q(`UPDATE tasks_native SET is_completed = 1, completed_at = datetime('now'),
       updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});
router.post('/api/native/tasks/:id/reopen', (req, res) => {
  q(`UPDATE tasks_native SET is_completed = 0, completed_at = NULL,
       updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.delete('/api/native/tasks/:id', (req, res) => {
  const r = q('DELETE FROM tasks_native WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (r.changes === 0) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

function toTask(row) {
  return {
    id: row.id,
    provider: 'native',
    content: row.content,
    description: row.description,
    projectId: row.project_id,
    priority: row.priority,
    dueDate: row.due_date,
    dueDatetime: row.due_datetime,
    labels: row.labels_json ? safeParse(row.labels_json) || [] : [],
    estimatedMinutes: row.estimated_minutes,
    localStatus: row.local_status,
    localPosition: row.local_position,
    parentId: row.parent_id,
    isCompleted: !!row.is_completed,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ----- Native projects -----

router.get('/api/native/projects', (req, res) => {
  const rows = q(`
    SELECT * FROM projects_native WHERE user_id = ? ORDER BY position, name
  `).all(req.user.id);
  res.json({ ok: true, projects: rows.map(toProject) });
});

router.post('/api/native/projects', (req, res) => {
  const id = randomUUID();
  const { name, color = null, isFavorite = false } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  const max = q('SELECT COALESCE(MAX(position), 0) AS m FROM projects_native WHERE user_id = ?').get(req.user.id);
  q(`
    INSERT INTO projects_native (id, user_id, name, color, is_favorite, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, String(name), color, isFavorite ? 1 : 0, (max?.m || 0) + 1);
  const row = q('SELECT * FROM projects_native WHERE id = ?').get(id);
  res.json({ ok: true, project: toProject(row) });
});

router.put('/api/native/projects/:id', (req, res) => {
  const existing = q('SELECT * FROM projects_native WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });
  const m = {
    name: req.body.name !== undefined ? String(req.body.name) : existing.name,
    color: req.body.color !== undefined ? req.body.color : existing.color,
    is_favorite: req.body.isFavorite !== undefined ? (req.body.isFavorite ? 1 : 0) : existing.is_favorite,
    position: req.body.position !== undefined ? Number(req.body.position) : existing.position,
  };
  q(`UPDATE projects_native SET name = ?, color = ?, is_favorite = ?, position = ?
     WHERE id = ? AND user_id = ?`)
    .run(m.name, m.color, m.is_favorite, m.position, req.params.id, req.user.id);
  const row = q('SELECT * FROM projects_native WHERE id = ?').get(req.params.id);
  res.json({ ok: true, project: toProject(row) });
});

router.delete('/api/native/projects/:id', (req, res) => {
  // Tasks in this project are kept but their project_id becomes null.
  q('UPDATE tasks_native SET project_id = NULL WHERE user_id = ? AND project_id = ?')
    .run(req.user.id, req.params.id);
  const r = q('DELETE FROM projects_native WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (r.changes === 0) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

function toProject(row) {
  return {
    id: row.id,
    provider: 'native',
    name: row.name,
    color: row.color,
    isFavorite: !!row.is_favorite,
    position: row.position,
  };
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

export default router;
