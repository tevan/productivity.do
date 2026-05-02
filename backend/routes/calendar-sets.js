import { Router } from 'express';
import { getDb } from '../db/init.js';
import { randomUUID } from 'crypto';
import { softDelete, purge } from '../lib/trash.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/calendar-sets — list sets with members
// ---------------------------------------------------------------------------
router.get('/api/calendar-sets', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const sets = db.prepare(
      'SELECT * FROM calendar_sets WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order, name'
    ).all(userId);
    const setIds = sets.map(s => s.id);
    const members = setIds.length
      ? db.prepare(`SELECT * FROM calendar_set_members WHERE set_id IN (${setIds.map(() => '?').join(',')})`).all(...setIds)
      : [];

    const membersBySet = {};
    for (const m of members) {
      if (!membersBySet[m.set_id]) membersBySet[m.set_id] = [];
      membersBySet[m.set_id].push(m.calendar_id);
    }

    res.json({
      ok: true,
      sets: sets.map(s => ({
        id: s.id,
        name: s.name,
        sortOrder: s.sort_order,
        calendarIds: membersBySet[s.id] || [],
        createdAt: s.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/calendar-sets error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/calendar-sets — create set
// ---------------------------------------------------------------------------
router.post('/api/calendar-sets', (req, res) => {
  try {
    const { name, calendarIds } = req.body;
    if (!name) {
      return res.status(400).json({ ok: false, error: 'name required' });
    }

    const db = getDb();
    const id = randomUUID();

    db.transaction(() => {
      db.prepare('INSERT INTO calendar_sets (id, name, user_id) VALUES (?, ?, ?)').run(id, name, req.user.id);
      if (calendarIds?.length) {
        const insert = db.prepare('INSERT INTO calendar_set_members (set_id, calendar_id) VALUES (?, ?)');
        for (const calId of calendarIds) {
          insert.run(id, calId);
        }
      }
    })();

    res.json({ ok: true, set: { id, name, calendarIds: calendarIds || [] } });
  } catch (err) {
    console.error('POST /api/calendar-sets error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/calendar-sets/:id — update set
// ---------------------------------------------------------------------------
router.put('/api/calendar-sets/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, calendarIds } = req.body;
    const db = getDb();
    const userId = req.user.id;

    // Ownership check
    const owner = db.prepare(
      'SELECT user_id, deleted_at FROM calendar_sets WHERE id = ?'
    ).get(id);
    if (!owner || owner.user_id !== userId || owner.deleted_at) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }

    db.transaction(() => {
      if (name !== undefined) {
        db.prepare('UPDATE calendar_sets SET name = ? WHERE id = ? AND user_id = ?').run(name, id, userId);
      }
      if (calendarIds !== undefined) {
        db.prepare('DELETE FROM calendar_set_members WHERE set_id = ?').run(id);
        const insert = db.prepare('INSERT INTO calendar_set_members (set_id, calendar_id) VALUES (?, ?)');
        for (const calId of calendarIds) {
          insert.run(id, calId);
        }
      }
    })();

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/calendar-sets/:id error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/calendar-sets/:id — delete set
// ---------------------------------------------------------------------------
router.delete('/api/calendar-sets/:id', (req, res) => {
  try {
    const { id } = req.params;
    const permanent = req.query.permanent === '1' || req.query.permanent === 'true';
    if (permanent) {
      // Hard-delete also removes the membership rows so the set's
      // `calendar_set_members` don't dangle. Soft-delete leaves them in
      // place so a restore returns the set with its calendars intact.
      const db = getDb();
      db.transaction(() => {
        db.prepare('DELETE FROM calendar_set_members WHERE set_id = ?').run(id);
        db.prepare('DELETE FROM calendar_sets WHERE id = ? AND user_id = ?').run(id, req.user.id);
      })();
      return res.json({ ok: true });
    }
    const ok = softDelete(getDb(), 'calendar_sets', id, req.user.id);
    if (!ok) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/calendar-sets/:id error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
