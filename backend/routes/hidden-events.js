import { Router } from 'express';
import { getDb } from '../db/init.js';

const router = Router();

router.get('/api/hidden-events', (req, res) => {
  const rows = getDb().prepare(
    'SELECT calendar_id, event_id FROM hidden_events WHERE user_id = ?'
  ).all(req.user.id);
  res.json({ ok: true, hidden: rows.map(r => ({ calendarId: r.calendar_id, eventId: r.event_id })) });
});

router.post('/api/hidden-events', (req, res) => {
  const { calendarId, eventId } = req.body || {};
  if (!calendarId || !eventId) return res.status(400).json({ ok: false, error: 'calendarId+eventId required' });
  getDb().prepare(
    'INSERT OR IGNORE INTO hidden_events (user_id, calendar_id, event_id) VALUES (?, ?, ?)'
  ).run(req.user.id, calendarId, eventId);
  res.json({ ok: true });
});

router.delete('/api/hidden-events/:calId/:eventId', (req, res) => {
  getDb().prepare(
    'DELETE FROM hidden_events WHERE user_id = ? AND calendar_id = ? AND event_id = ?'
  ).run(req.user.id, req.params.calId, req.params.eventId);
  res.json({ ok: true });
});

export default router;
