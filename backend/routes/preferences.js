import { Router } from 'express';
import { getDb, q } from '../db/init.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/preferences — return all preferences as key-value object
// ---------------------------------------------------------------------------
router.get('/api/preferences', (req, res) => {
  try {
    const rows = q('SELECT key, value FROM preferences WHERE user_id = ?').all(req.user.id);
    const prefs = {};
    for (const row of rows) {
      try {
        prefs[row.key] = JSON.parse(row.value);
      } catch {
        prefs[row.key] = row.value;
      }
    }
    res.json({ ok: true, preferences: prefs });
  } catch (err) {
    console.error('GET /api/preferences error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/preferences — bulk update (body: {key: value, ...})
// ---------------------------------------------------------------------------
router.put('/api/preferences', (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;
    const upsert = db.prepare(`
      INSERT INTO preferences (user_id, key, value) VALUES (?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
    `);

    const upsertMany = db.transaction((entries) => {
      for (const [key, value] of entries) {
        const stored = typeof value === 'string' ? value : JSON.stringify(value);
        upsert.run(userId, key, stored);
      }
    });

    upsertMany(Object.entries(req.body));
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/preferences error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/preferences/:key — single preference
// ---------------------------------------------------------------------------
router.get('/api/preferences/:key', (req, res) => {
  try {
    const row = q('SELECT value FROM preferences WHERE user_id = ? AND key = ?').get(req.user.id, req.params.key);
    if (!row) {
      return res.json({ ok: true, value: null });
    }
    let value;
    try {
      value = JSON.parse(row.value);
    } catch {
      value = row.value;
    }
    res.json({ ok: true, value });
  } catch (err) {
    console.error('GET /api/preferences/:key error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/preferences/:key — single preference update
// ---------------------------------------------------------------------------
router.put('/api/preferences/:key', (req, res) => {
  try {
    const { value } = req.body;
    const stored = typeof value === 'string' ? value : JSON.stringify(value);
    q(`
      INSERT INTO preferences (user_id, key, value) VALUES (?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
    `).run(req.user.id, req.params.key, stored);
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/preferences/:key error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
