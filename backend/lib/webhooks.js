/**
 * Outbound event webhooks.
 *
 * Subscribers register a URL + secret + list of event names. When an event
 * fires, we POST a JSON body to each matching URL with an HMAC-SHA256
 * signature in the `X-Productivity-Signature` header. Failed deliveries
 * retry with exponential backoff (1m, 5m, 30m, 2h, 12h).
 */

import { createHmac, randomBytes, randomUUID } from 'crypto';
import { getDb } from '../db/init.js';
import { captureError } from './sentry.js';

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 12 * 3600_000];
const TIMEOUT_MS = 8_000;

function uuid() {
  return randomUUID();
}

function makeSecret() {
  return 'whsec_' + randomBytes(24).toString('hex');
}

export function listSubscriptions(userId) {
  const db = getDb();
  const rows = userId
    ? db.prepare('SELECT * FROM webhook_subscriptions WHERE user_id = ? ORDER BY created_at DESC').all(userId)
    : db.prepare('SELECT * FROM webhook_subscriptions ORDER BY created_at DESC').all();
  return rows.map(r => mapSub(r));
}

export function createSubscription({ url, events, secret, userId }) {
  if (!userId) throw new Error('createSubscription requires userId');
  const db = getDb();
  const id = uuid();
  db.prepare(`
    INSERT INTO webhook_subscriptions (id, url, secret, events, is_active, user_id)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(id, url, secret || makeSecret(), JSON.stringify(events || []), userId);
  const row = db.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?').get(id);
  return mapSub(row, /* includeSecret */ true);
}

export function updateSubscription(id, { url, events, isActive }, userId) {
  const db = getDb();
  const existing = userId
    ? db.prepare('SELECT * FROM webhook_subscriptions WHERE id = ? AND user_id = ?').get(id, userId)
    : db.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?').get(id);
  if (!existing) return null;
  if (userId) {
    db.prepare(`
      UPDATE webhook_subscriptions SET
        url = ?, events = ?, is_active = ?
      WHERE id = ? AND user_id = ?
    `).run(
      url ?? existing.url,
      events ? JSON.stringify(events) : existing.events,
      isActive === undefined ? existing.is_active : (isActive ? 1 : 0),
      id, userId
    );
  } else {
    db.prepare(`
      UPDATE webhook_subscriptions SET
        url = ?, events = ?, is_active = ?
      WHERE id = ?
    `).run(
      url ?? existing.url,
      events ? JSON.stringify(events) : existing.events,
      isActive === undefined ? existing.is_active : (isActive ? 1 : 0),
      id
    );
  }
  return mapSub(db.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?').get(id));
}

export function rotateSubscriptionSecret(id, userId) {
  const db = getDb();
  const newSecret = makeSecret();
  if (userId) {
    const r = db.prepare('UPDATE webhook_subscriptions SET secret = ? WHERE id = ? AND user_id = ?').run(newSecret, id, userId);
    if (r.changes === 0) return null;
  } else {
    db.prepare('UPDATE webhook_subscriptions SET secret = ? WHERE id = ?').run(newSecret, id);
  }
  return { secret: newSecret };
}

export function deleteSubscription(id, userId) {
  const db = getDb();
  if (userId) {
    db.prepare('DELETE FROM webhook_subscriptions WHERE id = ? AND user_id = ?').run(id, userId);
  } else {
    db.prepare('DELETE FROM webhook_subscriptions WHERE id = ?').run(id);
  }
}

function mapSub(row, includeSecret = false) {
  if (!row) return null;
  let events = []; try { events = JSON.parse(row.events || '[]'); } catch {}
  const out = {
    id: row.id,
    url: row.url,
    events,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    lastDeliveryAt: row.last_delivery_at,
    lastDeliveryStatus: row.last_delivery_status,
  };
  if (includeSecret) out.secret = row.secret;
  return out;
}

/**
 * Fire an event to all matching subscriptions. Best-effort; failures get
 * queued for retry via webhook_deliveries.
 */
export async function emitEvent(eventName, data, userId) {
  const db = getDb();
  // Best-effort: also write an in-app notification row so the user's bell
  // icon updates. Skipped when there's no userId (system-wide events).
  // Channels are gated by per-user prefs: notifyApp (default on), notifyEmail
  // (off by default), notifySms (off by default + needs TWILIO_* env).
  if (userId) {
    let prefs = {};
    try {
      const rows = db.prepare(
        "SELECT key, value FROM preferences WHERE user_id = ? AND key IN ('notifyApp','notifyEmail','notifySms','notifySmsPhone','notifyBookings','notifyEventReminders','notifyTaskReminders')"
      ).all(userId);
      for (const r of rows) {
        try { prefs[r.key] = JSON.parse(r.value); } catch { prefs[r.key] = r.value; }
      }
    } catch {}

    // Per-event-kind gate: bookings vs event reminders vs task reminders.
    if (!shouldFireForKind(eventName, prefs)) return;

    try {
      const { title, body } = renderNotification(eventName, data);
      if (title) {
        // App channel (default on): write to the notifications table.
        if (prefs.notifyApp !== false) {
          db.prepare(`
            INSERT INTO notifications (user_id, kind, title, body, data_json)
            VALUES (?, ?, ?, ?, ?)
          `).run(userId, eventName, title, body || null, JSON.stringify(data || {}));
        }

        // Email channel: opt-in. Best-effort — Resend may not be configured.
        if (prefs.notifyEmail) {
          import('./notify.js').then(m => m.sendUserEmail?.({ userId, subject: title, body: body || '' })).catch(() => {});
        }

        // SMS channel: opt-in + requires TWILIO_* env + a phone number.
        if (prefs.notifySms && prefs.notifySmsPhone && process.env.TWILIO_ACCOUNT_SID) {
          import('./notify.js').then(m => m.sendUserSms?.({
            userId, to: prefs.notifySmsPhone, message: `${title}${body ? `\n${body}` : ''}`,
          })).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('notification record failed:', err.message);
      captureError(err, { component: 'webhooks.notificationRecord', event: eventName });
    }
  }

  // Webhooks should only fire for the user that owns the resource. If no
  // userId is provided we deliver to all subscriptions (legacy behavior).
  const rows = userId
    ? db.prepare('SELECT * FROM webhook_subscriptions WHERE is_active = 1 AND user_id = ?').all(userId)
    : db.prepare('SELECT * FROM webhook_subscriptions WHERE is_active = 1').all();
  const subs = rows.filter(s => {
    let events = []; try { events = JSON.parse(s.events || '[]'); } catch {}
    return events.includes(eventName) || events.includes('*');
  });
  if (subs.length === 0) return;
  const payload = {
    event: eventName,
    deliveredAt: new Date().toISOString(),
    data,
  };
  await Promise.all(subs.map(s => deliverOnce(s, payload, 1)));
}

async function deliverOnce(sub, payload, attempt) {
  const db = getDb();
  const id = uuid();
  const body = JSON.stringify(payload);
  // Signature includes a timestamp to prevent replay attacks.
  // Format: t=<unix_ms>,v1=<hex>; signed payload is `${ts}.${body}`.
  // Receivers should reject deliveries where |now - ts| > 5 minutes.
  const ts = Date.now().toString();
  const sig = createHmac('sha256', sub.secret).update(`${ts}.${body}`).digest('hex');
  let statusCode = 0;
  let responseBody = null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'productivity.do/webhooks',
        'X-Productivity-Event': payload.event,
        'X-Productivity-Timestamp': ts,
        'X-Productivity-Signature': `t=${ts},v1=${sig}`,
        'X-Productivity-Delivery': id,
      },
      body,
      signal: controller.signal,
    });
    statusCode = res.status;
    try { responseBody = (await res.text()).slice(0, 2000); } catch {}
  } catch (err) {
    statusCode = 0;
    responseBody = err.message;
  } finally {
    clearTimeout(timer);
  }

  const delivered = statusCode >= 200 && statusCode < 300;
  const nextRetry = !delivered && attempt < RETRY_DELAYS_MS.length
    ? new Date(Date.now() + RETRY_DELAYS_MS[attempt - 1]).toISOString()
    : null;

  db.prepare(`
    INSERT INTO webhook_deliveries (id, subscription_id, event, payload_json, attempt, status_code, response_body, delivered_at, next_retry_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, sub.id, payload.event, body, attempt, statusCode, responseBody,
        delivered ? new Date().toISOString() : null, nextRetry);

  db.prepare(`
    UPDATE webhook_subscriptions SET last_delivery_at = datetime('now'), last_delivery_status = ? WHERE id = ?
  `).run(statusCode, sub.id);
}

/**
 * Periodic retry sweep. Call from a setInterval at startup.
 */
export async function processRetries() {
  const db = getDb();
  const now = new Date().toISOString();
  const ready = db.prepare(`
    SELECT d.*, s.url, s.secret
    FROM webhook_deliveries d
    JOIN webhook_subscriptions s ON s.id = d.subscription_id
    WHERE d.delivered_at IS NULL
      AND d.next_retry_at IS NOT NULL
      AND d.next_retry_at <= ?
      AND s.is_active = 1
    LIMIT 50
  `).all(now);

  for (const d of ready) {
    let payload; try { payload = JSON.parse(d.payload_json); } catch { continue; }
    // Mark this delivery as already retried so we don't keep replaying it
    db.prepare('UPDATE webhook_deliveries SET next_retry_at = NULL WHERE id = ?').run(d.id);
    await deliverOnce({ id: d.subscription_id, url: d.url, secret: d.secret }, payload, d.attempt + 1);
  }
}

// Start a retry loop (lazy — caller wires this once)
let retryTimer = null;
export function startRetryLoop(intervalMs = 60_000) {
  if (retryTimer) return;
  retryTimer = setInterval(() => {
    processRetries().catch(err => { console.warn('webhook retry sweep:', err.message); captureError(err, { component: 'webhooks.retrySweep' }); });
  }, intervalMs);
  retryTimer.unref?.();
}

/**
 * Map an emitted event to an in-app notification title/body.
 * Returning {} for an event silently skips persistence.
 */
// Per-event-kind gating. The user's "What to notify" toggles in Settings
// map to event-name prefixes: booking.* / event.reminder / task.*.
// Defaults: bookings + event reminders ON, task reminders OFF.
function shouldFireForKind(eventName, prefs) {
  if (eventName.startsWith('booking.')) return prefs.notifyBookings !== false;
  if (eventName.startsWith('event.reminder')) return prefs.notifyEventReminders !== false;
  if (eventName.startsWith('task.')) return !!prefs.notifyTaskReminders;
  // Other system events (e.g. webhook delivery failures) always fire.
  return true;
}

function renderNotification(eventName, data) {
  switch (eventName) {
    case 'booking.created': {
      const who = data?.booking?.email || 'Someone';
      const when = data?.booking?.startIso ? new Date(data.booking.startIso).toLocaleString() : '';
      return { title: `New booking from ${who}`, body: when };
    }
    case 'booking.canceled': {
      const who = data?.booking?.email || 'Someone';
      return { title: `Booking canceled (${who})`, body: data?.reason || '' };
    }
    case 'booking.rescheduled': {
      const when = data?.booking?.startIso ? new Date(data.booking.startIso).toLocaleString() : '';
      return { title: 'Booking rescheduled', body: when };
    }
    default:
      return {};
  }
}
