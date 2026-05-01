/**
 * ICS calendar subscription feed.
 *
 * GET  /ics/u/:token  — public, token-scoped read-only ICS file (icsPublic).
 * POST /api/ics/regenerate — authenticated; rotates the token (icsAdmin).
 * GET  /api/ics/me   — authenticated; returns the current token + URL (icsAdmin).
 *
 * The token is the only credential. We compare with timing-safe equality
 * to discourage probing. We export two routers so server.js can mount the
 * public one before requireAuth and the admin one after.
 */

import { Router } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import { getDb } from '../db/init.js';
import * as google from '../lib/google.js';
import { buildIcsFeed } from '../lib/ics.js';

const icsPublic = Router();
const icsAdmin = Router();

function generateToken() {
  return randomBytes(16).toString('hex');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch { return false; }
}

icsPublic.get('/ics/u/:token', async (req, res) => {
  try {
    const provided = String(req.params.token || '');
    if (!/^[a-f0-9]{16,64}$/.test(provided)) {
      return res.status(404).type('text/plain').send('Not found');
    }
    const db = getDb();
    const user = db.prepare('SELECT id, email, ics_feed_token FROM users WHERE ics_feed_token = ?').get(provided);
    if (!user || !safeEqual(user.ics_feed_token || '', provided)) {
      return res.status(404).type('text/plain').send('Not found');
    }

    const now = Date.now();
    const fromIso = new Date(now - 30 * 86400_000).toISOString();
    const toIso   = new Date(now + 90 * 86400_000).toISOString();

    const cals = db.prepare(
      'SELECT id, summary FROM calendars WHERE user_id = ? AND visible = 1'
    ).all(user.id);

    const events = [];
    if (google.isConnected(user.id)) {
      for (const cal of cals) {
        try {
          const list = await google.listEvents(user.id, cal.id, fromIso, toIso);
          for (const ev of list) {
            if (ev.status === 'cancelled') continue;
            const startVal = ev.start?.dateTime || ev.start?.date;
            const endVal   = ev.end?.dateTime   || ev.end?.date;
            if (!startVal || !endVal) continue;
            events.push({
              uid: ev.id,
              summary: ev.summary || '(busy)',
              description: ev.description || '',
              location: ev.location || '',
              start: new Date(startVal),
              end: new Date(endVal),
            });
          }
        } catch (err) {
          console.warn(`ics feed: skipped calendar ${cal.id}: ${err.message}`);
        }
      }
    }

    const body = buildIcsFeed({
      name: `productivity.do — ${user.email}`,
      events,
    });
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=60');
    res.set('Content-Disposition', `inline; filename="productivity-${user.id}.ics"`);
    res.send(body);
  } catch (err) {
    console.error('ICS feed error:', err.message);
    res.status(500).type('text/plain').send('Internal error');
  }
});

icsAdmin.get('/api/ics/me', (req, res) => {
  try {
    const userId = req.user.id;
    const db = getDb();
    let row = db.prepare('SELECT ics_feed_token FROM users WHERE id = ?').get(userId);
    if (!row?.ics_feed_token) {
      const token = generateToken();
      db.prepare('UPDATE users SET ics_feed_token = ? WHERE id = ?').run(token, userId);
      row = { ics_feed_token: token };
    }
    const origin = process.env.PUBLIC_ORIGIN || 'https://productivity.do';
    const httpUrl = `${origin}/ics/u/${row.ics_feed_token}`;
    res.json({
      ok: true,
      token: row.ics_feed_token,
      httpUrl,
      webcalUrl: httpUrl.replace(/^https?:/, 'webcal:'),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

icsAdmin.post('/api/ics/regenerate', (req, res) => {
  try {
    const userId = req.user.id;
    const db = getDb();
    const token = generateToken();
    db.prepare('UPDATE users SET ics_feed_token = ? WHERE id = ?').run(token, userId);
    const origin = process.env.PUBLIC_ORIGIN || 'https://productivity.do';
    const httpUrl = `${origin}/ics/u/${token}`;
    res.json({
      ok: true,
      token,
      httpUrl,
      webcalUrl: httpUrl.replace(/^https?:/, 'webcal:'),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export { icsPublic, icsAdmin };
