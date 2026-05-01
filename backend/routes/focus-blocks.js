/**
 * Focus blocks — recurring weekly windows the user wants protected from
 * auto-scheduling. Rendered as a soft band on the calendar and treated as
 * "busy" inside `findNextFreeSlot()`.
 */

import { Router } from 'express';
import { getDb } from '../db/init.js';

const router = Router();

router.get('/api/focus-blocks', (req, res) => {
  const rows = getDb().prepare(
    'SELECT * FROM focus_blocks WHERE user_id = ? ORDER BY weekday, start_time'
  ).all(req.user.id);
  res.json({ ok: true, blocks: rows.map(toBlock) });
});

router.post('/api/focus-blocks', (req, res) => {
  const { label, weekday, startTime, endTime, color } = req.body || {};
  const err = validate({ weekday, startTime, endTime });
  if (err) return res.status(400).json({ ok: false, error: err });
  const result = getDb().prepare(`
    INSERT INTO focus_blocks (user_id, label, weekday, start_time, end_time, color)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.user.id, label || 'Focus', Number(weekday), startTime, endTime, color || null);
  const row = getDb().prepare('SELECT * FROM focus_blocks WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ok: true, block: toBlock(row) });
});

router.put('/api/focus-blocks/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM focus_blocks WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });
  const { label, weekday, startTime, endTime, color } = req.body || {};
  const merged = {
    label: label ?? existing.label,
    weekday: weekday !== undefined ? Number(weekday) : existing.weekday,
    start_time: startTime ?? existing.start_time,
    end_time: endTime ?? existing.end_time,
    color: color ?? existing.color,
  };
  const err = validate({ weekday: merged.weekday, startTime: merged.start_time, endTime: merged.end_time });
  if (err) return res.status(400).json({ ok: false, error: err });
  db.prepare(`
    UPDATE focus_blocks SET label = ?, weekday = ?, start_time = ?, end_time = ?, color = ?
    WHERE id = ? AND user_id = ?
  `).run(merged.label, merged.weekday, merged.start_time, merged.end_time, merged.color, req.params.id, req.user.id);
  const row = db.prepare('SELECT * FROM focus_blocks WHERE id = ?').get(req.params.id);
  res.json({ ok: true, block: toBlock(row) });
});

router.delete('/api/focus-blocks/:id', (req, res) => {
  getDb().prepare('DELETE FROM focus_blocks WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});

function toBlock(r) {
  return {
    id: r.id,
    label: r.label,
    weekday: r.weekday,
    startTime: r.start_time,
    endTime: r.end_time,
    color: r.color,
  };
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
function validate({ weekday, startTime, endTime }) {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return 'weekday must be 0..6';
  if (!HM.test(startTime || '')) return 'startTime must be HH:MM';
  if (!HM.test(endTime || ''))   return 'endTime must be HH:MM';
  if (startTime >= endTime) return 'startTime must be before endTime';
  return null;
}

export default router;
