// /api/account/* — profile, security, sessions, soft-delete.
//
// Mounted AFTER requireAuth, so every route here knows req.user.id.

import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import multer from 'multer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { getDb, q } from '../db/init.js';
import { resendSend } from '../lib/notify.js';

// Plain-text transactional helper. Best-effort; resolves regardless of outcome
// so route handlers can fire-and-forget.
async function sendEmail(to, subject, body) {
  if (!to) return;
  try { await resendSend({ to, subject, text: body }); } catch { /* swallow */ }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AVATAR_DIR = join(__dirname, '..', '..', 'avatars');
if (!existsSync(AVATAR_DIR)) mkdirSync(AVATAR_DIR, { recursive: true });

const router = express.Router();
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || 'https://productivity.do';

// Multer keeps the avatar in memory so we can write it ourselves with a
// hashed filename. 2MB cap, image MIME types only.
const upload = multer({
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimetype);
    cb(ok ? null : new Error('Unsupported image type'), ok);
  },
});

// ---------------------------------------------------------------------------
// GET /api/account — current user's profile + sessions list
// ---------------------------------------------------------------------------
router.get('/api/account', (req, res) => {
  const user = q(`
    SELECT id, email, display_name, avatar_path, plan, timezone,
           pending_email, deleted_at, permanently_purge_at,
           email_verified, created_at
    FROM users WHERE id = ?
  `).get(req.user.id);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });

  const sessions = q(`
    SELECT id, user_agent, ip, created_at, last_seen_at
    FROM user_sessions
    WHERE user_id = ? AND revoked_at IS NULL
    ORDER BY last_seen_at DESC
  `).all(req.user.id);

  // Mark which session is the current one (if the cookie carries a sessionId).
  const currentSessionId = req.session?.sessionId || null;

  res.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: avatarUrl(user),
      plan: user.plan,
      timezone: user.timezone,
      pendingEmail: user.pending_email,
      emailVerified: !!user.email_verified,
      createdAt: user.created_at,
      deletedAt: user.deleted_at,
      permanentlyPurgeAt: user.permanently_purge_at,
    },
    sessions: sessions.map(s => ({
      id: s.id,
      userAgent: s.user_agent,
      ip: s.ip,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      isCurrent: s.id === currentSessionId,
    })),
  });
});

// Resolve the avatar URL: server-uploaded if avatar_path set, otherwise
// Gravatar (md5 of lowercased email; default mp = mystery person).
function avatarUrl(user) {
  if (user.avatar_path) return user.avatar_path;
  const md5 = crypto.createHash('md5').update((user.email || '').trim().toLowerCase()).digest('hex');
  return `https://www.gravatar.com/avatar/${md5}?s=128&d=mp`;
}

// ---------------------------------------------------------------------------
// PUT /api/account/profile — update display name, timezone
// ---------------------------------------------------------------------------
router.put('/api/account/profile', (req, res) => {
  const { displayName, timezone } = req.body || {};
  const fields = [];
  const params = [];
  if (typeof displayName === 'string') {
    fields.push('display_name = ?');
    params.push(displayName.trim().slice(0, 100) || null);
  }
  if (typeof timezone === 'string') {
    fields.push('timezone = ?');
    params.push(timezone.trim().slice(0, 100) || null);
  }
  if (!fields.length) return res.json({ ok: true });
  fields.push('updated_at = datetime(\'now\')');
  q(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params, req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/account/avatar — upload avatar
// ---------------------------------------------------------------------------
router.post('/api/account/avatar', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
  // Hashed filename keeps things deterministic + cache-friendly. Old file
  // is left in place — overwriting on collision and the next upload
  // produces a new hash anyway. Avatars are tiny.
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' })[req.file.mimetype] || 'png';
  const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex').slice(0, 16);
  const filename = `${req.user.id}-${hash}.${ext}`;
  const filepath = join(AVATAR_DIR, filename);
  writeFileSync(filepath, req.file.buffer);
  const publicPath = `/avatars/${filename}`;
  q('UPDATE users SET avatar_path = ?, updated_at = datetime(\'now\') WHERE id = ?').run(publicPath, req.user.id);
  res.json({ ok: true, avatarUrl: publicPath });
});

// DELETE /api/account/avatar — drop back to Gravatar fallback
router.delete('/api/account/avatar', (req, res) => {
  const row = q('SELECT avatar_path FROM users WHERE id = ?').get(req.user.id);
  if (row?.avatar_path) {
    try {
      const filename = row.avatar_path.replace(/^\/avatars\//, '');
      // Sanity-check the path stays inside our avatars dir.
      if (filename && !filename.includes('..') && !filename.includes('/')) {
        const filepath = join(AVATAR_DIR, filename);
        if (existsSync(filepath)) unlinkSync(filepath);
      }
    } catch { /* best-effort cleanup */ }
  }
  q('UPDATE users SET avatar_path = NULL, updated_at = datetime(\'now\') WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/account/change-password — requires current password
// ---------------------------------------------------------------------------
router.post('/api/account/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ ok: false, error: 'Both fields required' });
  if (newPassword.length < 12) return res.status(400).json({ ok: false, error: 'New password must be at least 12 characters' });

  const user = q('SELECT id, password_hash, email FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) return res.status(401).json({ ok: false, error: 'Current password is incorrect' });

  const newHash = await bcrypt.hash(newPassword, 10);
  q('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newHash, user.id);

  // Best-effort security email
  if (user.email) {
    sendEmail(user.email, 'Your productivity.do password changed',
      `Your password was just changed. If this wasn't you, reply immediately so we can lock your account.`).catch(() => {});
  }

  // Revoke every other session so a thief gets kicked out.
  q(`UPDATE user_sessions SET revoked_at = datetime('now')
     WHERE user_id = ? AND revoked_at IS NULL AND id != ?`).run(user.id, req.session?.sessionId || '');

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/account/change-email — sends confirmation to NEW email
// ---------------------------------------------------------------------------
router.post('/api/account/change-email', async (req, res) => {
  const { newEmail, currentPassword } = req.body || {};
  if (!newEmail || !currentPassword) return res.status(400).json({ ok: false, error: 'Both fields required' });
  const normalized = String(newEmail).trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) return res.status(400).json({ ok: false, error: 'Invalid email' });

  const user = q('SELECT id, password_hash, email FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) return res.status(401).json({ ok: false, error: 'Current password is incorrect' });

  // Reject if the new email already belongs to another active user.
  const taken = q('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL AND id != ?').get(normalized, user.id);
  if (taken) return res.status(409).json({ ok: false, error: 'That email is already in use' });

  const token = crypto.randomBytes(24).toString('hex');
  q(`UPDATE users SET pending_email = ?, pending_email_token = ?, pending_email_sent_at = datetime('now')
     WHERE id = ?`).run(normalized, token, user.id);

  const confirmUrl = `${PUBLIC_ORIGIN}/api/account/confirm-email?token=${token}`;
  sendEmail(normalized, 'Confirm your new productivity.do email',
    `Click to confirm your new email: ${confirmUrl}\n\nIgnore this if you didn't request the change. The link expires in 24 hours.`
  ).catch(() => {});
  // Notify the OLD email too, so a hijacker can't change emails silently.
  sendEmail(user.email, 'Email change requested on your productivity.do account',
    `A request was made to change your email to ${normalized}. If this wasn't you, sign in and change your password immediately.`
  ).catch(() => {});

  res.json({ ok: true, sentTo: normalized });
});

// GET /api/account/confirm-email — completes the change
router.get('/api/account/confirm-email', (req, res) => {
  const token = String(req.query.token || '');
  if (!token) return res.status(400).type('html').send('<h1>Invalid link</h1>');
  const row = q(`
    SELECT id, email, pending_email, pending_email_sent_at
    FROM users WHERE pending_email_token = ?
  `).get(token);
  if (!row?.pending_email) return res.status(400).type('html').send('<h1>Invalid or expired link</h1>');
  // 24-hour expiry
  const ageMs = Date.now() - new Date(row.pending_email_sent_at).getTime();
  if (ageMs > 24 * 60 * 60 * 1000) {
    q('UPDATE users SET pending_email = NULL, pending_email_token = NULL WHERE id = ?').run(row.id);
    return res.status(400).type('html').send('<h1>Link expired</h1><p>Request a new email change in Settings.</p>');
  }

  // Final taken-check (race protection).
  const taken = q('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL AND id != ?').get(row.pending_email, row.id);
  if (taken) {
    q('UPDATE users SET pending_email = NULL, pending_email_token = NULL WHERE id = ?').run(row.id);
    return res.status(409).type('html').send('<h1>That email is already in use</h1>');
  }

  q(`UPDATE users SET email = ?, pending_email = NULL, pending_email_token = NULL,
        pending_email_sent_at = NULL, email_verified = 1, updated_at = datetime('now')
     WHERE id = ?`).run(row.pending_email, row.id);
  res.type('html').send(`
    <!DOCTYPE html><html><head><title>Email confirmed</title>
    <style>body{font-family:system-ui;max-width:520px;margin:80px auto;padding:0 20px;}h1{font-size:24px;}</style>
    </head><body>
    <h1>✓ Email updated</h1>
    <p>Your productivity.do account email is now <strong>${row.pending_email}</strong>.</p>
    <a href="/">← Back to productivity.do</a>
    </body></html>
  `);
});

// ---------------------------------------------------------------------------
// Sessions — view/revoke
// ---------------------------------------------------------------------------
router.delete('/api/account/sessions/:id', (req, res) => {
  const id = String(req.params.id);
  const r = q(`UPDATE user_sessions SET revoked_at = datetime('now')
               WHERE id = ? AND user_id = ? AND revoked_at IS NULL`).run(id, req.user.id);
  res.json({ ok: r.changes > 0 });
});

// Sign out everywhere except current.
router.post('/api/account/sessions/revoke-others', (req, res) => {
  const currentId = req.session?.sessionId || '';
  const r = q(`UPDATE user_sessions SET revoked_at = datetime('now')
               WHERE user_id = ? AND revoked_at IS NULL AND id != ?`).run(req.user.id, currentId);
  res.json({ ok: true, revoked: r.changes });
});

// ---------------------------------------------------------------------------
// Account deletion (soft + immediate-purge override)
// ---------------------------------------------------------------------------
router.post('/api/account/delete', async (req, res) => {
  const { password, mode } = req.body || {};
  if (!password) return res.status(400).json({ ok: false, error: 'Password required' });

  const user = q('SELECT id, password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ ok: false, error: 'Password is incorrect' });

  if (mode === 'immediate') {
    // Hard-delete: cascade via FKs handles most child rows; CASCADE is set
    // on user_id columns for the major tables. Do this in a transaction.
    const db = getDb();
    db.transaction(() => {
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    })();
    // Wipe the cookie session
    if (req.session) req.session = null;
    return res.json({ ok: true, mode: 'immediate' });
  }

  // Soft-delete: set deleted_at + 30-day purge timestamp. Rename email to a
  // suffixed variant so the column-level UNIQUE doesn't block someone re-
  // signing up with the same address; stash original in `original_email` so
  // recovery on login can restore it.
  const purgeAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const orig = q('SELECT email FROM users WHERE id = ?').get(user.id);
  const suffixed = `${orig.email}+deleted-${user.id}-${Date.now()}`;
  q(`UPDATE users SET deleted_at = datetime('now'), permanently_purge_at = ?,
        original_email = ?, email = ?,
        updated_at = datetime('now')
     WHERE id = ?`).run(purgeAt, orig.email, suffixed, user.id);
  // Revoke every session
  q(`UPDATE user_sessions SET revoked_at = datetime('now')
     WHERE user_id = ?`).run(user.id);
  if (req.session) req.session = null;
  res.json({ ok: true, mode: 'soft', recoverableUntil: purgeAt });
});

// POST /api/account/recover — un-delete a soft-deleted account on next sign-in
// (handled in the login flow, not here — see auth.js for that integration).

// ---------------------------------------------------------------------------
// GET /api/account/export — JSON dump of the user's data
//
// GDPR/portability promise: every user-owned row in the schema. Excludes
// security-sensitive credentials (password_hash, OAuth tokens, integration
// access_tokens, API key secrets, webhook signing secrets) and ephemeral
// caches (events_cache, weather_cache, sync_state, rate buckets, idempotency
// keys, webhook delivery logs). Includes everything the user themselves
// produced.
// ---------------------------------------------------------------------------
router.get('/api/account/export', (req, res) => {
  const userId = req.user.id;
  const all = (sql) => q(sql).all(userId);
  const dump = {
    // Profile (credentials redacted)
    user: q(`SELECT id, email, display_name, plan, timezone, created_at,
                    avatar_path, email_verified, last_login_at
             FROM users WHERE id = ?`).get(userId),

    // Native primary stores
    events_native: all('SELECT * FROM events_native WHERE user_id = ?'),
    tasks_native: all('SELECT * FROM tasks_native WHERE user_id = ?'),
    projects_native: all('SELECT * FROM projects_native WHERE user_id = ?'),

    // Notes + history + comments
    notes: all('SELECT * FROM notes WHERE user_id = ?'),
    note_comments: all('SELECT * FROM note_comments WHERE user_id = ?'),

    // Tasks supplementary (kanban + custom columns + focus blocks)
    task_columns: all('SELECT * FROM task_columns WHERE user_id = ?'),
    focus_blocks: all('SELECT * FROM focus_blocks WHERE user_id = ?'),
    hidden_events: all('SELECT * FROM hidden_events WHERE user_id = ?'),

    // Booking pages + child resources
    booking_pages: all('SELECT * FROM booking_pages WHERE user_id = ?'),
    bookings: q(`SELECT b.* FROM bookings b
                 JOIN booking_pages p ON p.id = b.page_id
                 WHERE p.user_id = ?`).all(userId),
    event_types: q(`SELECT et.* FROM event_types et
                    JOIN booking_pages p ON p.id = et.page_id
                    WHERE p.user_id = ?`).all(userId),
    custom_questions: q(`SELECT cq.* FROM custom_questions cq
                         JOIN booking_pages p ON p.id = cq.page_id
                         WHERE p.user_id = ?`).all(userId),
    booking_workflows: q(`SELECT w.* FROM booking_workflows w
                          JOIN booking_pages p ON p.id = w.page_id
                          WHERE p.user_id = ?`).all(userId),
    booking_invites: q(`SELECT i.* FROM booking_invites i
                        JOIN booking_pages p ON p.id = i.page_id
                        WHERE p.user_id = ?`).all(userId),
    booking_page_views: q(`SELECT v.* FROM booking_page_views v
                           JOIN booking_pages p ON p.id = v.page_id
                           WHERE p.user_id = ?`).all(userId),
    time_polls: q(`SELECT tp.* FROM time_polls tp
                   JOIN booking_pages p ON p.id = tp.page_id
                   WHERE p.user_id = ?`).all(userId),
    routing_forms: all('SELECT * FROM routing_forms WHERE user_id = ?'),
    quick_slots: all('SELECT * FROM quick_slots WHERE user_id = ?'),

    // Calendar metadata (no GCal access tokens)
    calendar_sets: all('SELECT * FROM calendar_sets WHERE user_id = ?'),
    calendar_set_members: q(`SELECT m.* FROM calendar_set_members m
                             JOIN calendar_sets cs ON cs.id = m.set_id
                             WHERE cs.user_id = ?`).all(userId),
    event_templates: all('SELECT * FROM event_templates WHERE user_id = ?'),
    subscribed_calendars: all('SELECT * FROM subscribed_calendars WHERE user_id = ?'),
    subscribed_events: q(`SELECT se.* FROM subscribed_events se
                          JOIN subscribed_calendars sc ON sc.id = se.calendar_id
                          WHERE sc.user_id = ?`).all(userId),

    // Preferences + links
    preferences: all('SELECT * FROM preferences WHERE user_id = ?'),
    links: all('SELECT * FROM links WHERE user_id = ?'),

    // Integrations metadata (tokens redacted)
    integrations: q(`SELECT id, user_id, provider, status, account_email,
                            metadata_json, last_synced_at, last_error,
                            created_at, updated_at
                     FROM integrations WHERE user_id = ?`).all(userId),

    // In-app feedback + AI support transcripts (user's own data)
    feedback_submissions: all('SELECT * FROM feedback_submissions WHERE user_id = ?'),
    support_chat_messages: all('SELECT * FROM support_chat_messages WHERE user_id = ?'),
    support_chat_usage: all('SELECT * FROM support_chat_usage WHERE user_id = ?'),

    // Notifications + activity history
    notifications: all('SELECT * FROM notifications WHERE user_id = ?'),
    revisions: all('SELECT * FROM revisions WHERE user_id = ?'),
    operations: all('SELECT * FROM operations WHERE user_id = ?'),

    // Files: metadata only — bytes are fetchable via /api/files/:id while
    // the export window is still open. storage_path is server-internal.
    files: q(`SELECT id, user_id, hash, mime, size, original_name, created_at
              FROM files WHERE user_id = ?`).all(userId),
    file_links: all('SELECT * FROM file_links WHERE user_id = ?'),

    // Task pins (the ranker disagreement loop).
    task_pins: all('SELECT * FROM task_pins WHERE user_id = ?'),

    // Sessions (revoked + active; tokens redacted)
    user_sessions: q(`SELECT id, user_id, user_agent, ip, created_at,
                             last_seen_at, revoked_at
                      FROM user_sessions WHERE user_id = ?`).all(userId),

    // Developer surface (api keys + webhook subs; secrets redacted)
    api_keys: q(`SELECT id, user_id, name, prefix, scopes, last_used_at,
                        created_at, revoked_at
                 FROM api_keys WHERE user_id = ?`).all(userId),
    webhook_subscriptions: q(`SELECT id, user_id, url, events, active,
                                     created_at
                              FROM webhook_subscriptions WHERE user_id = ?`).all(userId),

    exported_at: new Date().toISOString(),
  };
  res.set('Content-Disposition', `attachment; filename="productivity-do-${userId}-${Date.now()}.json"`);
  res.type('application/json').send(JSON.stringify(dump, null, 2));
});

export default router;
