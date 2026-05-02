import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getOAuth2Client, storeTokens, clearTokens, isConnected } from '../lib/google.js';
import { getDb } from '../db/init.js';
import { createUser, verifyEmail } from '../lib/users.js';
import { sendVerificationEmail } from '../lib/notify.js';

const router = Router();

// POST /api/signup — create a new user, auto-login, send verification email
router.post('/api/signup', async (req, res) => {
  try {
    const { email, password, plan } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email and password required' });
    }
    const user = await createUser({
      email,
      password,
      plan: ['free', 'pro', 'team'].includes(plan) ? plan : 'free',
    });
    req.session.userId = user.id;
    req.session.authenticated = true;
    sendVerificationEmail({ to: user.email, token: user.emailVerifyToken }).catch(() => {});
    res.json({ ok: true, user: { id: user.id, email: user.email, plan: user.plan } });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// GET /api/verify/:token — confirm email
router.get('/api/verify/:token', (req, res) => {
  const userId = verifyEmail(req.params.token);
  if (!userId) return res.status(400).type('html').send('Invalid or expired link.');
  res.type('html').send(`
    <!DOCTYPE html><html><head>
      <meta charset="UTF-8" /><title>Email verified</title>
      <link rel="stylesheet" href="/marketing/assets/marketing.css" />
    </head><body>
      <div style="max-width: 480px; margin: 80px auto; text-align: center; padding: 40px 24px;">
        <h1 style="font-size: 28px; margin-bottom: 16px;">Email verified ✓</h1>
        <p style="color: #6b7280;">Your account is ready to use.</p>
        <p style="margin-top: 24px;"><a href="/" class="btn btn-primary">Go to app</a></p>
      </div>
    </body></html>
  `);
});

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

// POST /api/auth — verify password
router.post('/api/auth', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!password) return res.status(400).json({ ok: false, error: 'Password required' });

    const db = getDb();
    // If no email provided, fall back to the seed user so the legacy single-user
    // login keeps working.
    const lookupEmail = email || (process.env.SEED_USER_EMAIL || 'owner@productivity.do');
    // Active users match `email`; soft-deleted users had `email` suffixed and
    // their original stashed in `original_email`. Login matches either so the
    // 30-day recovery window keeps working with the address the user remembers.
    const row = db.prepare(
      `SELECT id, password_hash, deleted_at, permanently_purge_at, original_email
       FROM users
       WHERE email = ? OR (deleted_at IS NOT NULL AND original_email = ?)`
    ).get(lookupEmail, lookupEmail);
    if (!row) return res.status(401).json({ ok: false, error: 'Wrong password' });

    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) return res.status(401).json({ ok: false, error: 'Wrong password' });

    // Soft-deleted account: signing in recovers it (within the 30-day window).
    // Restore the original email + clear the deletion flags.
    let recovered = false;
    if (row.deleted_at) {
      const purgeAt = row.permanently_purge_at ? new Date(row.permanently_purge_at).getTime() : 0;
      if (purgeAt && purgeAt < Date.now()) {
        return res.status(403).json({ ok: false, error: 'Account deletion window has ended' });
      }
      // If someone else has signed up with this email in the meantime, recovery
      // is no longer possible — fail closed. Filter by deleted_at IS NULL so
      // we don't compare against this row's own suffixed email.
      const taken = db.prepare(
        'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL AND id != ?'
      ).get(row.original_email || lookupEmail, row.id);
      if (taken) {
        return res.status(409).json({ ok: false, error: 'That email is already in use by another account' });
      }
      db.prepare(`UPDATE users SET deleted_at = NULL, permanently_purge_at = NULL,
                                   email = COALESCE(original_email, email),
                                   original_email = NULL
                  WHERE id = ?`).run(row.id);
      recovered = true;
    }

    // Create a session row so this device shows up in the account's
    // active-sessions list. The cookie carries the row id.
    const sessionId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO user_sessions (id, user_id, user_agent, ip)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, row.id, String(req.headers['user-agent'] || '').slice(0, 200), req.ip || null);

    req.session.userId = row.id;
    req.session.authenticated = true; // keep legacy flag for the bridge
    req.session.sessionId = sessionId;
    db.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?').run(row.id);
    res.json({ ok: true, recovered });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/auth/logout
router.post('/api/auth/logout', (req, res) => {
  if (req.session?.sessionId) {
    try {
      getDb().prepare('UPDATE user_sessions SET revoked_at = datetime(\'now\') WHERE id = ?')
        .run(req.session.sessionId);
    } catch { /* best-effort */ }
  }
  req.session = null;
  res.json({ ok: true });
});

// GET /api/auth/status
router.get('/api/auth/status', (req, res) => {
  res.json({ ok: true, authenticated: !!(req.session && req.session.authenticated) });
});

// ---------------------------------------------------------------------------
// Google OAuth
// ---------------------------------------------------------------------------

// GET /api/auth/google — redirect to Google OAuth consent screen
router.get('/api/auth/google', (req, res) => {
  try {
    const client = getOAuth2Client();
    const url = client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });
    res.redirect(url);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/auth/google/callback — exchange code for tokens
router.get('/api/auth/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing authorization code');

    if (!req.session || !req.session.userId) {
      return res.status(401).send('You must be logged in before connecting Google.');
    }

    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);
    storeTokens(req.session.userId, tokens);

    res.redirect('/');
  } catch (err) {
    console.error('Google OAuth callback error:', err.message);
    res.status(500).send('OAuth failed: ' + err.message);
  }
});

// GET /api/auth/google/status — return whether Google is connected
router.get('/api/auth/google/status', (req, res) => {
  const userId = (req.session && req.session.userId) || 1;
  res.json({ ok: true, connected: isConnected(userId) });
});

// POST /api/auth/google/disconnect — clear tokens from DB
router.post('/api/auth/google/disconnect', (req, res) => {
  try {
    const userId = (req.session && req.session.userId) || 1;
    clearTokens(userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
