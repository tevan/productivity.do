/**
 * Email-to-task SKELETON.
 *
 * Eventual flow:
 *   user@somewhere.com forwards to u<userId>+<token>@<TBD-domain>
 *   inbound mail provider POSTs the parsed message to /api/email-inbox/inbound
 *   we resolve userId+token, create a Todoist task with the subject as title.
 *
 * Provider-agnostic: the inbound handler accepts a generic { to, from, subject,
 * text, html } shape. SES/Postmark/Mailgun/CF Email Routing all map cleanly.
 *
 * Public endpoint: POST /api/email-inbox/inbound (no session auth — secured
 * by knowing the recipient's token in the To: address). Add an HMAC header
 * verification step when the actual provider is wired in.
 */

import { Router } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import { getDb } from '../db/init.js';
import * as todoist from '../lib/todoist.js';

const inboxPublic = Router();
const inboxAdmin = Router();

const INBOX_DOMAIN = process.env.INBOX_DOMAIN || 'inbox.productivity.do';
const ADDRESS_RE = /^u(\d+)\+([a-f0-9]{16,64})@/i;

function generateToken() {
  return randomBytes(12).toString('hex');
}

/**
 * Verify HTTP Basic Auth on the inbound webhook.
 * Returns true if no creds are configured (skip-check mode for dev),
 * or if the provided creds match. Uses timing-safe compare on the password.
 */
function verifyBasicAuth(req) {
  const expectedUser = process.env.INBOX_WEBHOOK_USER || '';
  const expectedPass = process.env.INBOX_WEBHOOK_PASS || '';
  if (!expectedUser && !expectedPass) return true; // no auth configured

  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch { return false; }
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  // Length check first (timingSafeEqual requires equal lengths).
  if (user !== expectedUser) return false;
  if (pass.length !== expectedPass.length) return false;
  try {
    return timingSafeEqual(Buffer.from(pass), Buffer.from(expectedPass));
  } catch { return false; }
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch { return false; }
}

// PUBLIC: inbound mail webhook. Provider-agnostic body shape.
// Body: { to: string|string[], from?: string, subject?: string, text?: string,
//         html?: string }
inboxPublic.post('/api/email-inbox/inbound', async (req, res) => {
  try {
    // Defense-in-depth: require HTTP Basic Auth from the provider when
    // INBOX_WEBHOOK_USER/PASS are configured. Postmark sends Basic creds
    // when you set "HTTP Basic Auth" on the inbound webhook in their UI.
    // The address-with-token is already an effective gate against random
    // POSTs, but this prevents anyone with the URL from spamming task
    // creation by guessing user IDs.
    if (!verifyBasicAuth(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const body = normalizeProviderPayload(req.body || {});
    const recipients = Array.isArray(body.to) ? body.to : [body.to].filter(Boolean);
    if (!recipients.length) return res.status(400).json({ ok: false, error: 'to required' });

    const db = getDb();
    let matched = null;
    for (const addr of recipients) {
      const m = ADDRESS_RE.exec(String(addr).trim());
      if (!m) continue;
      const userId = Number(m[1]);
      const tokenFromAddress = m[2].toLowerCase();
      const row = db.prepare('SELECT id, inbox_token FROM users WHERE id = ?').get(userId);
      if (!row?.inbox_token) continue;
      if (!safeEqual(row.inbox_token, tokenFromAddress)) continue;
      matched = { userId };
      break;
    }
    if (!matched) {
      return res.status(404).json({ ok: false, error: 'Unknown recipient' });
    }

    const subject = (body.subject || '').trim().slice(0, 500) || '(no subject)';
    const description = (body.text || stripHtml(body.html || '')).trim().slice(0, 16_000) || null;

    try {
      await todoist.createTask({
        content: subject,
        description,
      }, matched.userId);
    } catch (err) {
      console.warn('email-inbox: createTask failed:', err.message);
      return res.status(502).json({ ok: false, error: 'Could not create task' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('email-inbox/inbound:', err.message);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

// AUTHENTICATED: get/regenerate the per-user inbox address.
inboxAdmin.get('/api/email-inbox/me', (req, res) => {
  const userId = req.user.id;
  const db = getDb();
  let row = db.prepare('SELECT inbox_token FROM users WHERE id = ?').get(userId);
  if (!row?.inbox_token) {
    const token = generateToken();
    db.prepare('UPDATE users SET inbox_token = ? WHERE id = ?').run(token, userId);
    row = { inbox_token: token };
  }
  res.json({
    ok: true,
    address: `u${userId}+${row.inbox_token}@${INBOX_DOMAIN}`,
    domain: INBOX_DOMAIN,
    receiverConfigured: !!process.env.INBOX_DOMAIN,
  });
});

inboxAdmin.post('/api/email-inbox/regenerate', (req, res) => {
  const userId = req.user.id;
  const token = generateToken();
  getDb().prepare('UPDATE users SET inbox_token = ? WHERE id = ?').run(token, userId);
  res.json({
    ok: true,
    address: `u${userId}+${token}@${INBOX_DOMAIN}`,
  });
});

/**
 * Map provider-specific payload shapes to our internal {to, from, subject,
 * text, html} shape. Postmark uses capitalized keys and embeds recipients
 * as a structured array; SES/Mailgun/CF use lowercase. We normalize so the
 * rest of the handler doesn't care which provider fired.
 */
function normalizeProviderPayload(b) {
  // Already in our shape (our own format, or CF-style lowercase)
  if (typeof b.to === 'string' || Array.isArray(b.to)) return b;

  // Postmark: {To, FromFull, Subject, TextBody, HtmlBody, ToFull: [{Email, Name}]}
  if (typeof b.To === 'string' || Array.isArray(b.ToFull)) {
    const toList = Array.isArray(b.ToFull) && b.ToFull.length
      ? b.ToFull.map(x => x.Email).filter(Boolean)
      : (typeof b.To === 'string' ? b.To.split(',').map(s => s.trim()) : []);
    return {
      to: toList,
      from: b.FromFull?.Email || b.From || '',
      subject: b.Subject || '',
      text: b.TextBody || '',
      html: b.HtmlBody || '',
    };
  }

  return b; // unknown shape — pass through
}

function stripHtml(s) {
  if (!s) return '';
  return String(s).replace(/<style[\s\S]*?<\/style>/gi, '')
                  .replace(/<script[\s\S]*?<\/script>/gi, '')
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/\s+/g, ' ');
}

export { inboxPublic, inboxAdmin };
