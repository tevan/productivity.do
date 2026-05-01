// Slack app — slash command handler.
//
// Workspaces install the productivity.do Slack app via OAuth (`/api/slack/install`).
// Once installed, members in that workspace can invoke `/productivity new task: …`
// to create a task in their productivity.do account, provided they've
// linked their Slack user ID to a productivity.do account.
//
// Linking flow:
//   1. User runs `/productivity link` — replies with a URL containing a
//      one-shot token
//   2. User visits the URL while logged into productivity.do — backend
//      attaches their slack_user_id to their productivity.do user
//   3. Future `/productivity new task: …` calls are authenticated via that
//      mapping
//
// Slack request signing is verified per their docs (HMAC-SHA256 over the
// raw body + timestamp; reject if older than 5 min).

import express from 'express';
import crypto from 'node:crypto';
import { getDb, q } from '../db/init.js';

const router = express.Router();
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';
const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID || '';
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET || '';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || 'https://productivity.do';

// ---------------------------------------------------------------------------
// Slack request signature verification
// ---------------------------------------------------------------------------
// Slack signs every request as: 'v0=' + hmac_sha256(secret, `v0:${ts}:${body}`).
// We need the RAW body, which means this route mounts before express.json().
// We re-parse as urlencoded inside the handler.
function verifySlackRequest(req, rawBody) {
  if (!SLACK_SIGNING_SECRET) return false; // refuse if not configured
  const ts = req.headers['x-slack-request-timestamp'];
  const sig = req.headers['x-slack-signature'];
  if (!ts || !sig) return false;
  // 5-minute replay window
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const base = `v0:${ts}:${rawBody}`;
  const computed = 'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET).update(base).digest('hex');
  if (computed.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(sig));
}

// Capture raw body for the slash-command endpoint.
function rawBodyMiddleware(req, res, next) {
  let chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks).toString('utf8');
    // Parse application/x-www-form-urlencoded (Slack's command shape)
    const params = new URLSearchParams(req.rawBody);
    req.body = Object.fromEntries(params);
    next();
  });
  req.on('error', next);
}

// ---------------------------------------------------------------------------
// /api/slack/command — the slash command handler
// ---------------------------------------------------------------------------
router.post('/api/slack/command', rawBodyMiddleware, async (req, res) => {
  if (!verifySlackRequest(req, req.rawBody)) {
    return res.status(401).send('Slack signature mismatch');
  }
  const { team_id, user_id, command, text, response_url } = req.body;
  const trimmed = (text || '').trim();

  // Special: `link` — start the user-linking flow
  if (trimmed === 'link' || trimmed === 'connect') {
    const token = crypto.randomBytes(16).toString('hex');
    q(`
      INSERT OR REPLACE INTO slack_link_tokens (token, slack_team_id, slack_user_id, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(token, team_id, user_id);
    const url = `${PUBLIC_ORIGIN}/slack/link?token=${token}`;
    return res.json({
      response_type: 'ephemeral',
      text: `Click to link your productivity.do account: ${url}`,
    });
  }

  if (trimmed === 'help' || !trimmed) {
    return res.json({
      response_type: 'ephemeral',
      text: '*productivity.do for Slack*\n\n' +
            '• `/productivity new task: <title>` — create a task\n' +
            '• `/productivity link` — link your productivity.do account\n' +
            '• `/productivity help` — this message',
    });
  }

  // `new task: <title>` (the prefix is friendly but optional)
  let title = trimmed.replace(/^new\s+task\s*:?\s*/i, '');
  if (!title) {
    return res.json({ response_type: 'ephemeral', text: 'Usage: `/productivity new task: Buy milk`' });
  }

  // Resolve the slack user → productivity user
  const link = q(
    'SELECT user_id FROM slack_user_links WHERE slack_team_id = ? AND slack_user_id = ?'
  ).get(team_id, user_id);
  if (!link) {
    return res.json({
      response_type: 'ephemeral',
      text: 'No linked productivity.do account. Run `/productivity link` to connect.',
    });
  }

  // Quick due-date parse: `today`, `tomorrow`, `next week`, `Mon`, `2026-05-15`
  const dueParse = parseQuickDue(title);
  if (dueParse.match) title = title.slice(0, dueParse.match.index).trim();

  const id = crypto.randomUUID();
  q(`
    INSERT INTO tasks_native (id, user_id, content, due_date, priority, created_at, updated_at)
    VALUES (?, ?, ?, ?, 4, datetime('now'), datetime('now'))
  `).run(id, link.user_id, title, dueParse.date || null);

  res.json({
    response_type: 'ephemeral',
    text: `Created: *${title}*${dueParse.date ? ` (due ${dueParse.date})` : ''}`,
  });
});

// Very small NL date helper. Returns { match: RegExpMatch?, date: 'YYYY-MM-DD' }.
// Doesn't try to be Todoist's parser — covers the common cases and bails.
function parseQuickDue(text) {
  const today = new Date(); today.setHours(0,0,0,0);
  const fmt = (d) => d.toISOString().slice(0, 10);

  let m = text.match(/\b(today)\b$/i);
  if (m) return { match: m, date: fmt(today) };

  m = text.match(/\b(tomorrow|tmr)\b$/i);
  if (m) {
    const d = new Date(today); d.setDate(d.getDate() + 1);
    return { match: m, date: fmt(d) };
  }

  m = text.match(/\b(\d{4}-\d{2}-\d{2})$/);
  if (m) return { match: m, date: m[1] };

  return { match: null, date: null };
}

// ---------------------------------------------------------------------------
// /slack/link — finalize Slack ↔ productivity.do user linking
// ---------------------------------------------------------------------------
// User clicks the link from the Slack ephemeral; we attach their session
// userId to the slack_user_id in the token row.
router.get('/slack/link', (req, res) => {
  if (!req.session?.userId) {
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  const token = String(req.query.token || '');
  const row = q(
    'SELECT slack_team_id, slack_user_id, created_at FROM slack_link_tokens WHERE token = ?'
  ).get(token);
  if (!row) return res.status(400).type('html').send('<h1>Invalid or expired link</h1>');
  // 10-minute expiry
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  if (ageMs > 10 * 60 * 1000) {
    return res.status(400).type('html').send('<h1>Link expired</h1><p>Run <code>/productivity link</code> again.</p>');
  }
  q(`
    INSERT OR REPLACE INTO slack_user_links (user_id, slack_team_id, slack_user_id, linked_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(req.session.userId, row.slack_team_id, row.slack_user_id);
  q('DELETE FROM slack_link_tokens WHERE token = ?').run(token);
  res.type('html').send(`
    <!DOCTYPE html><html><head><title>Linked</title>
    <style>body{font-family:system-ui;max-width:520px;margin:80px auto;padding:0 20px;}h1{font-size:24px;}</style>
    </head><body>
    <h1>✓ Slack account linked</h1>
    <p>You can now run <code>/productivity new task: …</code> in any Slack channel.</p>
    <a href="/">← Back to productivity.do</a>
    </body></html>
  `);
});

// ---------------------------------------------------------------------------
// /api/slack/install — start the Slack OAuth install flow
// ---------------------------------------------------------------------------
router.get('/api/slack/install', (req, res) => {
  if (!SLACK_CLIENT_ID) return res.status(503).send('Slack app not configured');
  const scope = 'commands';
  const redirect = `${PUBLIC_ORIGIN}/api/slack/oauth/callback`;
  const url = `https://slack.com/oauth/v2/authorize?client_id=${SLACK_CLIENT_ID}&scope=${scope}&redirect_uri=${encodeURIComponent(redirect)}`;
  res.redirect(url);
});

router.get('/api/slack/oauth/callback', async (req, res) => {
  const code = String(req.query.code || '');
  if (!code) return res.status(400).send('Missing code');
  try {
    const r = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: SLACK_CLIENT_ID,
        client_secret: SLACK_CLIENT_SECRET,
        code,
        redirect_uri: `${PUBLIC_ORIGIN}/api/slack/oauth/callback`,
      }),
    });
    const j = await r.json();
    if (!j.ok) return res.status(400).send(`Slack OAuth failed: ${j.error}`);
    q(`
      INSERT OR REPLACE INTO slack_workspaces (team_id, team_name, access_token, installed_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(j.team?.id || j.team_id, j.team?.name || '', j.access_token || j.bot?.bot_access_token || '');
    res.type('html').send(`
      <!DOCTYPE html><html><head><title>Installed</title>
      <style>body{font-family:system-ui;max-width:520px;margin:80px auto;padding:0 20px;}h1{font-size:24px;}</style>
      </head><body>
      <h1>✓ productivity.do installed in Slack</h1>
      <p>Try <code>/productivity link</code> in any channel to connect your account.</p>
      </body></html>
    `);
  } catch (e) {
    res.status(500).send('Slack install failed: ' + (e.message || e));
  }
});

export default router;
