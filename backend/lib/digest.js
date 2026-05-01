/**
 * Weekly digest. Sends each user a summary email Monday at 8am local.
 * For now we run a single check every hour and fire to users whose local
 * Monday-8am has just passed since the last run. Stored in users.last_digest_at.
 */
import { getDb } from '../db/init.js';

const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.DIGEST_FROM || 'Productivity <digest@productivity.do>';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || 'https://productivity.do';

async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    return res.ok;
  } catch { return false; }
}

function buildHtml(user, events, tasks) {
  const upcoming = events.slice(0, 10).map(e => `
    <li style="margin:6px 0;">
      <strong>${escapeHtml(e.summary || '(no title)')}</strong>
      <span style="color:#888;">— ${new Date(e.start_time).toLocaleString()}</span>
    </li>`).join('');
  const open = tasks.slice(0, 10).map(t => `
    <li style="margin:6px 0;">${escapeHtml(t.content)}${t.due_date ? ` <span style="color:#888;">(due ${t.due_date})</span>` : ''}</li>
  `).join('');
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a;">
      <h2 style="margin:0 0 4px 0;">Your week ahead</h2>
      <p style="color:#888;margin:0 0 24px 0;">Monday digest from Productivity</p>
      <h3 style="margin:24px 0 8px 0;">${events.length} event${events.length === 1 ? '' : 's'} this week</h3>
      <ul style="padding-left:18px;">${upcoming || '<li style="color:#888">No events scheduled.</li>'}</ul>
      <h3 style="margin:24px 0 8px 0;">${tasks.length} open task${tasks.length === 1 ? '' : 's'}</h3>
      <ul style="padding-left:18px;">${open || '<li style="color:#888">All caught up.</li>'}</ul>
      <p style="margin-top:32px;color:#888;font-size:12px;">
        <a href="${PUBLIC_ORIGIN}" style="color:#3b82f6;">Open Productivity</a>
      </p>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function startWeeklyDigest() {
  // Run once at startup after a 60s warmup, then hourly.
  setTimeout(tick, 60 * 1000);
  setInterval(tick, 60 * 60 * 1000);
}

async function tick() {
  if (!RESEND_KEY) return;
  const db = getDb();
  // Users with a verified email + a last_digest_at older than 6 days (or null).
  const users = db.prepare(`
    SELECT id, email FROM users
    WHERE email_verified = 1
      AND (last_digest_at IS NULL OR datetime(last_digest_at) < datetime('now', '-6 days'))
  `).all();
  const now = new Date();
  // Only send Monday between 8:00-9:00 server-local. Adequate for v1; per-tz
  // scheduling can come later.
  if (now.getDay() !== 1 || now.getHours() !== 8) return;
  for (const u of users) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    const events = db.prepare(`
      SELECT summary, start_time FROM events_cache
      WHERE user_id = ? AND start_time BETWEEN ? AND ?
      ORDER BY start_time ASC LIMIT 50
    `).all(u.id, start.toISOString(), end.toISOString());
    const tasks = db.prepare(`
      SELECT content, due_date FROM tasks_cache
      WHERE user_id = ? AND completed_at IS NULL
      ORDER BY due_date ASC LIMIT 50
    `).all(u.id);
    const html = buildHtml(u, events, tasks);
    const sent = await sendEmail(u.email, 'Your week ahead', html);
    if (sent) {
      db.prepare('UPDATE users SET last_digest_at = datetime(\'now\') WHERE id = ?').run(u.id);
    }
  }
}
