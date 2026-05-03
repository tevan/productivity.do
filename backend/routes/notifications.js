/**
 * In-app notifications.
 *
 *   GET    /api/notifications              — recent items, unread count
 *   POST   /api/notifications/read         — mark all as read
 *   POST   /api/notifications/:id/read     — mark single item as read
 *   DELETE /api/notifications/:id          — dismiss/delete
 */

import { Router } from 'express';
import { getDb } from '../db/init.js';

const router = Router();

router.get('/api/notifications', (req, res) => {
  // Wrapped in try/catch so a transient DB hiccup doesn't 500 the
  // bell poller — better to show "no notifications" briefly than
  // permanently break the bell with an unhandled error.
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(req.user.id);
    const unread = db.prepare(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL'
    ).get(req.user.id).n;
    res.json({
      ok: true,
      unread,
      notifications: rows.map(r => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        url: r.url,
        data: safeJson(r.data_json),
        read: !!r.read_at,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/notifications error:', err.message);
    res.status(500).json({ ok: false, error: err.message, unread: 0, notifications: [] });
  }
});

router.post('/api/notifications/read', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL")
    .run(req.user.id);
  res.json({ ok: true });
});

router.post('/api/notifications/:id/read', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.delete('/api/notifications/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export default router;
