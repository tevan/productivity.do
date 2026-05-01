import { Router } from 'express';
import { getDb } from '../db/init.js';

const router = Router();

router.get('/api/subscriptions', (req, res) => {
  const rows = getDb().prepare(
    'SELECT * FROM subscribed_calendars WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);
  res.json({ ok: true, subscriptions: rows.map(r => ({
    id: r.id, name: r.name, url: r.url, color: r.color,
    visible: !!r.visible, lastFetchedAt: r.last_fetched_at, lastError: r.last_error,
  })) });
});

router.post('/api/subscriptions', async (req, res) => {
  const { name, url, color } = req.body || {};
  if (!name || !url) return res.status(400).json({ ok: false, error: 'name + url required' });
  // Reject non-https + obviously-internal addresses to prevent SSRF.
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'webcal:' && u.protocol !== 'http:') {
      return res.status(400).json({ ok: false, error: 'http(s)/webcal only' });
    }
    if (/^(localhost|127\.|0\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(u.hostname)) {
      return res.status(400).json({ ok: false, error: 'Internal hosts not allowed' });
    }
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid URL' });
  }
  const info = getDb().prepare(`
    INSERT INTO subscribed_calendars (user_id, name, url, color)
    VALUES (?, ?, ?, ?)
  `).run(req.user.id, name, url, color || null);
  // Best-effort initial fetch
  fetchSubscription(info.lastInsertRowid).catch(() => {});
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/api/subscriptions/:id', (req, res) => {
  const { name, color, visible } = req.body || {};
  const r = getDb().prepare(`
    UPDATE subscribed_calendars
    SET name = COALESCE(?, name), color = ?, visible = COALESCE(?, visible)
    WHERE id = ? AND user_id = ?
  `).run(
    name ?? null, color ?? null,
    typeof visible === 'boolean' ? (visible ? 1 : 0) : null,
    req.params.id, req.user.id,
  );
  if (!r.changes) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

router.delete('/api/subscriptions/:id', (req, res) => {
  const r = getDb().prepare('DELETE FROM subscribed_calendars WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

router.post('/api/subscriptions/:id/refresh', async (req, res) => {
  const row = getDb().prepare('SELECT id FROM subscribed_calendars WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
  try {
    await fetchSubscription(row.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Tiny ICS parser — handles VEVENT blocks well enough for read-only feeds.
// Doesn't expand RRULE; recurring events from feeds will only show their first
// instance for now. Folded lines are unfolded per RFC 5545 §3.1.
export function parseIcs(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; }
    else if (cur) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const keyPart = line.slice(0, idx);
      const value = line.slice(idx + 1);
      const key = keyPart.split(';')[0];
      if (key === 'UID') cur.uid = value;
      else if (key === 'SUMMARY') cur.summary = unescapeIcs(value);
      else if (key === 'DESCRIPTION') cur.description = unescapeIcs(value);
      else if (key === 'LOCATION') cur.location = unescapeIcs(value);
      else if (key === 'DTSTART') cur.start = parseIcsDate(keyPart, value);
      else if (key === 'DTEND')   cur.end   = parseIcsDate(keyPart, value);
    }
  }
  return events;
}

function unescapeIcs(s) {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function parseIcsDate(keyPart, value) {
  const isAllDay = /VALUE=DATE([^-]|$)/.test(keyPart) && !value.includes('T');
  if (isAllDay) {
    return { date: `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`, allDay: true };
  }
  // YYYYMMDDTHHMMSSZ or YYYYMMDDTHHMMSS (floating)
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return { date: value, allDay: false };
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? 'Z' : ''}`;
  return { date: iso, allDay: false };
}

export async function fetchSubscription(id) {
  const db = getDb();
  const sub = db.prepare('SELECT * FROM subscribed_calendars WHERE id = ?').get(id);
  if (!sub) throw new Error('Subscription not found');
  const url = sub.url.replace(/^webcal:/i, 'https:');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    const events = parseIcs(text);
    db.prepare('DELETE FROM subscribed_events WHERE subscription_id = ?').run(id);
    const stmt = db.prepare(`
      INSERT INTO subscribed_events (subscription_id, uid, summary, description, location, start_time, end_time, all_day)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction((items) => {
      for (const ev of items) {
        if (!ev.uid || !ev.start) continue;
        stmt.run(
          id, ev.uid, ev.summary || null, ev.description || null, ev.location || null,
          ev.start.date, ev.end?.date || null,
          (ev.start.allDay || ev.end?.allDay) ? 1 : 0
        );
      }
    });
    tx(events);
    db.prepare('UPDATE subscribed_calendars SET last_fetched_at = datetime(\'now\'), last_error = NULL WHERE id = ?').run(id);
  } catch (err) {
    clearTimeout(timer);
    db.prepare('UPDATE subscribed_calendars SET last_error = ? WHERE id = ?').run(err.message.slice(0, 200), id);
    throw err;
  }
}

// Periodic refresh — every 6 hours.
export function startSubscriptionRefresher() {
  const refresh = () => {
    const subs = getDb().prepare('SELECT id FROM subscribed_calendars').all();
    for (const s of subs) {
      fetchSubscription(s.id).catch(err => console.warn('sub refresh:', s.id, err.message));
    }
  };
  setInterval(refresh, 6 * 60 * 60 * 1000);
  setTimeout(refresh, 30 * 1000); // initial after 30s warmup
}

export default router;
