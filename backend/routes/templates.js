import { Router } from 'express';
import { getDb } from '../db/init.js';

const router = Router();

router.get('/api/event-templates', (req, res) => {
  const rows = getDb().prepare(
    'SELECT * FROM event_templates WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);
  res.json({ ok: true, templates: rows.map(r => ({
    id: r.id,
    name: r.name,
    summary: r.summary,
    description: r.description,
    location: r.location,
    durationMinutes: r.duration_minutes,
    calendarId: r.calendar_id,
    addMeet: !!r.add_meet,
    attendees: r.attendees_json ? JSON.parse(r.attendees_json) : [],
  })) });
});

router.post('/api/event-templates', (req, res) => {
  const { name, summary, description, location, durationMinutes, calendarId, addMeet, attendees } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  const info = getDb().prepare(`
    INSERT INTO event_templates (user_id, name, summary, description, location, duration_minutes, calendar_id, add_meet, attendees_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id, name, summary || null, description || null, location || null,
    Number(durationMinutes) || 30, calendarId || null, addMeet ? 1 : 0,
    Array.isArray(attendees) && attendees.length ? JSON.stringify(attendees) : null,
  );
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/api/event-templates/:id', (req, res) => {
  const { name, summary, description, location, durationMinutes, calendarId, addMeet, attendees } = req.body || {};
  const r = getDb().prepare(`
    UPDATE event_templates SET
      name = COALESCE(?, name),
      summary = ?,
      description = ?,
      location = ?,
      duration_minutes = COALESCE(?, duration_minutes),
      calendar_id = ?,
      add_meet = COALESCE(?, add_meet),
      attendees_json = ?
    WHERE id = ? AND user_id = ?
  `).run(
    name ?? null, summary ?? null, description ?? null, location ?? null,
    durationMinutes ?? null, calendarId ?? null,
    typeof addMeet === 'boolean' ? (addMeet ? 1 : 0) : null,
    Array.isArray(attendees) ? JSON.stringify(attendees) : null,
    req.params.id, req.user.id,
  );
  if (!r.changes) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

router.delete('/api/event-templates/:id', (req, res) => {
  const r = getDb().prepare('DELETE FROM event_templates WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

export default router;
