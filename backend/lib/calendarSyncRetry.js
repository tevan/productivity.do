// Retry sweep for bookings whose Google Calendar event create failed.
//
// Mirrors the webhook_deliveries retry pattern (see lib/webhooks.js). Booking
// itself is committed atomically by the time we get here — this loop only
// catches the best-effort GCal create that happened *after* commit. The host
// is notified via the `notifications` table on final failure, so they can
// manually add the event or fix the integration.
//
// Backoff schedule (matches webhook_deliveries):
//   attempt 1 (initial sync at booking-time) → 1 min
//   attempt 2  → 5 min
//   attempt 3  → 30 min
//   attempt 4  → 2 h
//   attempt 5  → 12 h
//   attempt 6+ → mark failed
//
// Why a custom sweep instead of generalizing webhook_deliveries: bookings
// already have all the context we need (host, calendar id, attendee), so the
// retry doesn't need to serialize a payload. Keeping it focused makes the
// table churn small (most bookings sync on the first attempt).

import { getDb } from '../db/init.js';
import * as google from './google.js';

const BACKOFF_MS = [
  60_000,        // 1 min
  5 * 60_000,    // 5 min
  30 * 60_000,   // 30 min
  2 * 60 * 60_000,   // 2 h
  12 * 60 * 60_000,  // 12 h
];
const MAX_ATTEMPTS = BACKOFF_MS.length;

let timer = null;

export function startCalendarSyncRetry({ intervalMs = 60_000 } = {}) {
  if (timer) return;
  // Run once at startup, then on the configured interval.
  processOnce().catch(err => console.warn('calendar sync sweep:', err.message));
  timer = setInterval(() => {
    processOnce().catch(err => console.warn('calendar sync sweep:', err.message));
  }, intervalMs);
  timer.unref?.();
}

export async function processOnce() {
  const db = getDb();
  const now = new Date().toISOString();
  // Pick up to 25 bookings ready for retry. The cap keeps a single sweep
  // bounded if many bookings fail simultaneously (e.g. GCal outage).
  const due = db.prepare(`
    SELECT b.*, p.user_id AS page_user_id, p.calendar_id AS page_calendar_id,
           p.title AS page_title, p.slug AS page_slug,
           t.title AS type_title
      FROM bookings b
      JOIN booking_pages p ON p.id = b.page_id
      LEFT JOIN event_types t ON t.id = b.type_id
     WHERE b.calendar_sync_status = 'pending'
       AND b.calendar_sync_next_at IS NOT NULL
       AND b.calendar_sync_next_at <= ?
       AND b.status = 'confirmed'
       AND b.google_event_id IS NULL
     ORDER BY b.calendar_sync_next_at ASC
     LIMIT 25
  `).all(now);

  for (const b of due) {
    await retryOne(b);
  }
}

async function retryOne(b) {
  const db = getDb();
  // Round-robin assigns the GCal event to assigned_user_id; otherwise the page
  // owner. Mirrors the create-time logic in routes/booking-public.js.
  const hostUserId = b.assigned_user_id || b.page_user_id;
  const calendarId = (b.assigned_user_id && b.assigned_user_id !== b.page_user_id)
    ? 'primary' : (b.page_calendar_id || null);
  if (!calendarId || !google.isConnected(hostUserId)) {
    // Host disconnected GCal between booking and now. Mark failed; don't
    // retry forever for an integration that's gone.
    markFailed(b, 'Google Calendar not connected');
    return;
  }
  try {
    const startIso = new Date(b.start_at).toISOString();
    const endIso   = new Date(b.end_at).toISOString();
    const ev = await google.createEvent(hostUserId, calendarId, {
      summary: `${b.type_title || b.page_title} — ${b.invitee_name}`,
      description: b.invitee_message || '',
      start: { dateTime: startIso, timeZone: b.host_tz || 'UTC' },
      end:   { dateTime: endIso,   timeZone: b.host_tz || 'UTC' },
      attendees: [{ email: b.invitee_email, displayName: b.invitee_name }],
    });
    db.prepare(`
      UPDATE bookings
         SET google_event_id = ?,
             calendar_sync_status = 'synced',
             calendar_sync_next_at = NULL,
             calendar_sync_error = NULL
       WHERE id = ?
    `).run(ev.id, b.id);
  } catch (err) {
    const nextAttempt = b.calendar_sync_attempts + 1;
    if (nextAttempt > MAX_ATTEMPTS) {
      markFailed(b, String(err.message || err).slice(0, 500));
      return;
    }
    const nextAt = new Date(Date.now() + BACKOFF_MS[nextAttempt - 1]).toISOString();
    db.prepare(`
      UPDATE bookings
         SET calendar_sync_attempts = ?,
             calendar_sync_next_at = ?,
             calendar_sync_error = ?
       WHERE id = ?
    `).run(nextAttempt, nextAt, String(err.message || err).slice(0, 500), b.id);
  }
}

function markFailed(b, reason) {
  const db = getDb();
  db.prepare(`
    UPDATE bookings
       SET calendar_sync_status = 'failed',
           calendar_sync_next_at = NULL,
           calendar_sync_error = ?
     WHERE id = ?
  `).run(reason, b.id);
  // Notify the host. Best-effort — if notifications insert fails we still
  // want the failed status to stick.
  try {
    db.prepare(`
      INSERT INTO notifications (user_id, kind, title, body, data_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      b.page_user_id,
      'booking.calendar_sync_failed',
      'Calendar sync failed',
      `Booking from ${b.invitee_name || b.invitee_email} was confirmed, but we couldn't add it to Google Calendar after several retries. ${reason}`.slice(0, 1000),
      JSON.stringify({ bookingId: b.id, pageSlug: b.page_slug, reason })
    );
  } catch (err) {
    console.warn('notification insert failed:', err.message);
  }
}
