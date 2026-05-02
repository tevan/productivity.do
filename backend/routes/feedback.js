/**
 * In-app feedback — captures private feedback from authenticated users
 * via a small modal in the SPA. Goes to the founder via Resend.
 *
 * Why in-app instead of "email us" link: lower friction, captures the
 * user's session context (URL, viewport, app version) automatically,
 * and lets us reply via the email tied to their account without them
 * having to type it.
 *
 * Why not a public forum / Discord / GitHub Discussions yet: see
 * docs/internal/community-and-integrations-strategy.md.
 *
 * Storage: every submission is logged to the `feedback_submissions`
 * table so we have a record even if the email send fails.
 */

import { Router } from 'express';
import { getDb } from '../db/init.js';
import { resendSend } from '../lib/notify.js';
import { captureError } from '../lib/sentry.js';

const router = Router();

const MAX_BODY = 5000;
const RATE_LIMIT_PER_HOUR = 5;

router.post('/api/feedback', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ ok: false, error: 'Sign in first' });

  const body = String(req.body?.body || '').trim();
  const kind = String(req.body?.kind || 'general').slice(0, 20);
  const url = String(req.body?.url || '').slice(0, 500);
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);

  if (!body) return res.status(400).json({ ok: false, error: 'Tell us something' });
  if (body.length > MAX_BODY) {
    return res.status(400).json({ ok: false, error: `Keep it under ${MAX_BODY} characters` });
  }

  const db = getDb();

  // Rate-limit per user. Stops a single rage-clicker from pumping 50 in
  // a minute. Five per hour is generous for legitimate use.
  const recent = db.prepare(
    "SELECT COUNT(*) AS n FROM feedback_submissions WHERE user_id = ? AND created_at >= datetime('now', '-1 hour')"
  ).get(userId);
  if (recent.n >= RATE_LIMIT_PER_HOUR) {
    return res.status(429).json({
      ok: false,
      error: `That's enough for one hour. Try again later — we got the earlier ones.`,
    });
  }

  // Look up the user's email so the founder can reply directly.
  const user = db.prepare('SELECT email, display_name FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(401).json({ ok: false, error: 'Account not found' });

  // Persist BEFORE the email send. The DB record is the source of truth;
  // email is the convenience.
  const insert = db.prepare(`
    INSERT INTO feedback_submissions
      (user_id, email, display_name, kind, body, url, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const r = insert.run(
    userId, user.email, user.display_name || null, kind, body, url, userAgent
  );

  // Best-effort email. If Resend isn't configured, the row stays in the
  // DB and the admin can read it later via /admin/feedback (TODO).
  const supportEmail = process.env.SUPPORT_EMAIL || 'support@productivity.do';
  try {
    await resendSend({
      to: supportEmail,
      replyTo: user.email,
      subject: `[productivity.do feedback] ${kind} from ${user.email}`,
      text: [
        `Kind: ${kind}`,
        `From: ${user.display_name ? user.display_name + ' <' + user.email + '>' : user.email}`,
        `User ID: ${userId}`,
        `URL: ${url || '(not provided)'}`,
        `User-Agent: ${userAgent || '(not provided)'}`,
        `Submitted: ${new Date().toISOString()}`,
        '',
        '---',
        '',
        body,
      ].join('\n'),
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 580px; line-height: 1.5;">
          <p style="font-size: 12px; color: #666;">
            <strong>${escapeHtml(kind)}</strong> from
            <a href="mailto:${escapeAttr(user.email)}">${escapeHtml(user.display_name || user.email)}</a>
            (user ${userId})
          </p>
          <p style="font-size: 12px; color: #999;">
            ${escapeHtml(url || '(no URL)')} ·
            ${escapeHtml(userAgent || '(no UA)')}
          </p>
          <hr />
          <p style="white-space: pre-wrap;">${escapeHtml(body)}</p>
        </div>
      `,
    });
  } catch (err) {
    // Don't fail the request — the user successfully submitted; the
    // email is our problem, not theirs.
    captureError(err, { component: 'feedback.email', userId, submissionId: r.lastInsertRowid });
    console.warn('[feedback] email send failed:', err.message);
  }

  res.json({ ok: true, id: r.lastInsertRowid });
});

// Admin-only — list recent submissions. Lets the founder see everything
// in one place (e.g. when working through a backlog) without digging
// through email.
router.get('/api/admin/feedback', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
  const limit = Math.min(500, Math.max(10, Number(req.query.limit) || 100));
  const rows = getDb().prepare(`
    SELECT id, user_id AS userId, email, display_name AS displayName,
           kind, body, url, user_agent AS userAgent, created_at AS createdAt
    FROM feedback_submissions
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
  res.json({ ok: true, items: rows });
});

function isAdmin(req) {
  if (!req.session?.userId) return false;
  if (req.session.userId === 1) return true;
  try {
    const row = getDb().prepare('SELECT is_team_admin FROM users WHERE id = ?').get(req.session.userId);
    return !!row?.is_team_admin;
  } catch { return false; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/["&]/g, (c) => ({ '"': '&quot;', '&': '&amp;' }[c]));
}

export default router;
