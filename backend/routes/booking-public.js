import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { getDb } from '../db/init.js';
import * as google from '../lib/google.js';
import {
  computeSlots,
  fetchBusyIntervals,
  fetchTeamBusyIntervals,
  resolveHostUserIds,
  pickRoundRobinHost,
  randomToken,
} from '../lib/booking.js';
import {
  rowToPage,
  rowToEventType,
  rowToQuestion,
  rowToWorkflow,
  publicPage,
} from '../lib/bookingMappers.js';
import {
  buildIcs,
  googleCalendarUrl,
  outlookUrl,
} from '../lib/ics.js';
import {
  sendBookingConfirmation,
  sendBookingCancellation,
  fireWorkflows,
} from '../lib/notify.js';
import { emitEvent } from '../lib/webhooks.js';
import { createBookingCheckout, isStripeConfigured } from '../lib/stripe.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

// ---------------------------------------------------------------------------
// Rate limiting (SQLite-persisted, per IP) — survives PM2 restarts so a
// client can't catch us during a redeploy and burst past the limit. Shares
// the api_v1_rate_buckets table with /api/v1, namespaced with a "book:"
// prefix on the key. Same prune interval keeps the table from growing.
// ---------------------------------------------------------------------------
const RL_BOOK_MAX = 10;
const RL_BOOK_WINDOW_MS = 60_000;
function rateLimit(ip, max = RL_BOOK_MAX) {
  const key = `book:${ip}`;
  const db = getDb();
  const now = Date.now();
  return db.transaction(() => {
    const row = db.prepare('SELECT window_start, count FROM api_v1_rate_buckets WHERE ratekey = ?').get(key);
    if (!row || now - row.window_start > RL_BOOK_WINDOW_MS) {
      db.prepare(`
        INSERT INTO api_v1_rate_buckets (ratekey, window_start, count)
        VALUES (?, ?, 1)
        ON CONFLICT(ratekey) DO UPDATE SET window_start = excluded.window_start, count = 1
      `).run(key, now);
      return true;
    }
    if (row.count >= max) return false;
    db.prepare('UPDATE api_v1_rate_buckets SET count = count + 1 WHERE ratekey = ?').run(key);
    return true;
  })();
}
// Note: the api-v1 module already runs the prune interval against this same
// table, so we don't need a second cleanup loop here.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function uuid() {
  return randomUUID();
}

function loadPageWithExtras(db, slug) {
  const row = db.prepare('SELECT * FROM booking_pages WHERE slug = ?').get(slug);
  if (!row) return null;
  const eventTypes = db.prepare('SELECT * FROM event_types WHERE page_id = ? AND is_active = 1 ORDER BY sort_order').all(row.id);
  const questions = db.prepare('SELECT * FROM custom_questions WHERE page_id = ? ORDER BY sort_order').all(row.id);
  const workflows = db.prepare('SELECT * FROM booking_workflows WHERE page_id = ? AND is_active = 1').all(row.id);
  return { row, eventTypes, questions, workflows };
}

function findEventType(db, page, typeSlug) {
  if (!typeSlug) return null;
  return db.prepare('SELECT * FROM event_types WHERE page_id = ? AND slug = ? AND is_active = 1').get(page.id, typeSlug);
}

function pickPolicy(page, eventType) {
  return {
    durationMin: eventType?.duration_min ?? page.duration_min,
    bufferBeforeMin: eventType?.buffer_before_min ?? page.buffer_before_min,
    bufferAfterMin: eventType?.buffer_after_min ?? page.buffer_after_min,
    capacity: eventType?.capacity ?? 1,
  };
}

function publicOrigin(req) {
  return process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
}

function dateInTz(ms, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

// ---------------------------------------------------------------------------
// Public JSON: page metadata
// Optional second segment: type slug. /api/public/booking/:slug returns the page
// plus its event types + questions.
// ---------------------------------------------------------------------------
router.get('/api/public/booking/:slug', (req, res) => {
  try {
    const db = getDb();
    const ctx = loadPageWithExtras(db, req.params.slug);
    if (!ctx || !ctx.row.is_active) return res.status(404).json({ ok: false, error: 'Not found' });
    // Track a pageview against UTC date. Best-effort — never block the response.
    try {
      const day = new Date().toISOString().slice(0, 10);
      db.prepare(`
        INSERT INTO booking_page_views (page_id, day, views) VALUES (?, ?, 1)
        ON CONFLICT(page_id, day) DO UPDATE SET views = views + 1
      `).run(ctx.row.id, day);
    } catch {}
    res.json({ ok: true, page: publicPage(ctx.row, ctx.eventTypes, ctx.questions) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Public JSON: available slots for a host-local date "YYYY-MM-DD"
// Optional ?type=<slug> picks an event type
// ---------------------------------------------------------------------------
router.get('/api/public/booking/:slug/slots', async (req, res) => {
  try {
    const db = getDb();
    const ctx = loadPageWithExtras(db, req.params.slug);
    if (!ctx || !ctx.row.is_active) return res.status(404).json({ ok: false, error: 'Not found' });
    const date = req.query.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ ok: false, error: 'Invalid date' });
    }
    const eventType = req.query.type ? findEventType(db, ctx.row, req.query.type) : null;
    if (req.query.type && !eventType) return res.status(404).json({ ok: false, error: 'Event type not found' });

    const policy = pickPolicy(ctx.row, eventType);
    const page = rowToPage(ctx.row);
    page.durationMin = policy.durationMin;
    page.bufferBeforeMin = policy.bufferBeforeMin;
    page.bufferAfterMin = policy.bufferAfterMin;

    // Map back to snake_case for computeSlots which expects raw row keys mostly
    const computeRow = {
      ...ctx.row,
      duration_min: policy.durationMin,
      buffer_before_min: policy.bufferBeforeMin,
      buffer_after_min: policy.bufferAfterMin,
    };

    const tz = ctx.row.timezone || 'UTC';
    const fromIso = `${date}T00:00:00.000Z`;
    const toIso = new Date(Date.parse(fromIso) + 36 * 3600 * 1000).toISOString();

    let busy = [];
    let checkIds = [];
    try { checkIds = JSON.parse(ctx.row.check_calendar_ids || '[]'); } catch {}
    const strategy = ctx.row.assignment_strategy || 'single';
    const hostIds = resolveHostUserIds(ctx.row);
    if (checkIds.length && hostIds.length) {
      try {
        if (strategy === 'collective' || strategy === 'single') {
          // Block on any host being busy. (Single strategy = single host, same code path.)
          const t = await fetchTeamBusyIntervals(hostIds, checkIds, fromIso, toIso);
          busy = t.union;
        } else if (strategy === 'round_robin') {
          // Slot is OK if AT LEAST ONE host is free → busy = intersection of all hosts' busy sets.
          const t = await fetchTeamBusyIntervals(hostIds, checkIds, fromIso, toIso);
          busy = intersectIntervals([...t.perHost.values()]);
        }
      } catch (err) {
        console.warn('team busy fetch failed:', err.message);
      }
    }

    const dayStart = new Date(`${date}T00:00:00`).toISOString();
    const dayEnd = new Date(Date.parse(dayStart) + 36 * 3600 * 1000).toISOString();
    const existingBookings = db.prepare(`
      SELECT * FROM bookings
      WHERE page_id = ? AND status = 'confirmed'
        AND start_iso < ? AND end_iso > ?
    `).all(ctx.row.id, dayEnd, dayStart);

    // Group events: a slot can hold up to capacity bookings; compute remaining capacity
    let slots = computeSlotsWithCapacity(computeRow, date, busy, existingBookings, eventType?.capacity || 1);

    // Smart pacing: min_gap_min globally
    const minGap = ctx.row.min_gap_min || 0;
    if (minGap > 0) {
      const allBookings = db.prepare('SELECT start_iso, end_iso FROM bookings WHERE page_id = ? AND status = \'confirmed\'').all(ctx.row.id);
      slots = slots.filter(s => {
        const sMs = Date.parse(s.startIso);
        const eMs = Date.parse(s.endIso);
        return !allBookings.some(b => {
          const bs = Date.parse(b.start_iso);
          const be = Date.parse(b.end_iso);
          // Distance from slot to nearest existing booking
          const gap = Math.min(Math.abs(sMs - be), Math.abs(bs - eMs));
          return gap < minGap * 60000;
        });
      });
    }

    // Weekly cap
    if (ctx.row.weekly_max) {
      const weekStart = new Date(`${date}T00:00:00`);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
      const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
      const weekBookings = db.prepare(`
        SELECT COUNT(*) as n FROM bookings
        WHERE page_id = ? AND status = 'confirmed' AND start_iso >= ? AND start_iso < ?
      `).get(ctx.row.id, weekStart.toISOString(), weekEnd.toISOString());
      if (weekBookings.n >= ctx.row.weekly_max) slots = [];
    }

    res.json({ ok: true, slots, timezone: tz });
  } catch (err) {
    console.error('slots error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Public: first available slot in the next 14 days. Cheap walk forward day
// by day until we find one. Used by the widget to render a "Next available"
// hint without making the user pick a date.
// ---------------------------------------------------------------------------
router.get('/api/public/booking/:slug/next-slot', async (req, res) => {
  try {
    const db = getDb();
    const ctx = loadPageWithExtras(db, req.params.slug);
    if (!ctx || !ctx.row.is_active) return res.status(404).json({ ok: false, error: 'Not found' });
    const eventType = req.query.type ? findEventType(db, ctx.row, req.query.type) : null;
    const policy = pickPolicy(ctx.row, eventType);
    const tz = ctx.row.timezone || 'UTC';

    const computeRow = {
      ...ctx.row,
      duration_min: policy.durationMin,
      buffer_before_min: policy.bufferBeforeMin,
      buffer_after_min: policy.bufferAfterMin,
    };

    let checkIds = [];
    try { checkIds = JSON.parse(ctx.row.check_calendar_ids || '[]'); } catch {}
    const strategy = ctx.row.assignment_strategy || 'single';
    const hostIds = resolveHostUserIds(ctx.row);

    // Walk forward up to 14 host-local days. We fetch busy windows lazily
    // per-day to keep this fast.
    for (let i = 0; i < 14; i++) {
      const probe = new Date(Date.now() + i * 86_400_000);
      const date = dateInTz(probe.getTime(), tz);
      const fromIso = `${date}T00:00:00.000Z`;
      const toIso = new Date(Date.parse(fromIso) + 36 * 3600 * 1000).toISOString();
      let busy = [];
      if (checkIds.length && hostIds.length) {
        try {
          if (strategy === 'round_robin') {
            const t = await fetchTeamBusyIntervals(hostIds, checkIds, fromIso, toIso);
            busy = intersectIntervals([...t.perHost.values()]);
          } else {
            const t = await fetchTeamBusyIntervals(hostIds, checkIds, fromIso, toIso);
            busy = t.union;
          }
        } catch {}
      }
      const dayStart = new Date(`${date}T00:00:00`).toISOString();
      const dayEnd = new Date(Date.parse(dayStart) + 36 * 3600 * 1000).toISOString();
      const existing = db.prepare(`
        SELECT * FROM bookings
        WHERE page_id = ? AND status = 'confirmed'
          AND start_iso < ? AND end_iso > ?
      `).all(ctx.row.id, dayEnd, dayStart);
      const slots = computeSlotsWithCapacity(computeRow, date, busy, existing, eventType?.capacity || 1);
      if (slots.length > 0) {
        return res.json({ ok: true, slot: slots[0], timezone: tz });
      }
    }
    res.json({ ok: true, slot: null, timezone: tz });
  } catch (err) {
    console.error('next-slot error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Intersect N lists of busy intervals. The result represents the time windows
 * during which EVERY input list is busy (i.e. no host is free). Used for
 * round-robin: the slot is bookable if at least one host is free, so we treat
 * a slot as blocked only when all hosts are simultaneously busy.
 */
function intersectIntervals(lists) {
  if (!lists.length) return [];
  if (lists.length === 1) return lists[0];
  // Sweep-line: build events and find regions covered by all N lists.
  const events = [];
  for (let i = 0; i < lists.length; i++) {
    for (const iv of lists[i]) {
      events.push({ t: iv.start.getTime(), delta: 1 });
      events.push({ t: iv.end.getTime(),   delta: -1 });
    }
  }
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);
  const N = lists.length;
  let depth = 0;
  let regionStart = null;
  const out = [];
  for (const e of events) {
    const before = depth;
    depth += e.delta;
    if (before < N && depth >= N) {
      regionStart = e.t;
    } else if (before >= N && depth < N) {
      if (regionStart != null) {
        out.push({ start: new Date(regionStart), end: new Date(e.t) });
        regionStart = null;
      }
    }
  }
  return out;
}

function computeSlotsWithCapacity(row, date, busy, existingBookings, capacity) {
  // For capacity 1, computeSlots already filters out occupied slots.
  // For capacity > 1, we instead want slots where the count of overlapping
  // bookings is less than capacity.
  if (capacity <= 1) {
    return computeSlots(row, date, busy, existingBookings, new Date());
  }
  // Compute open slots ignoring existing same-page bookings, then post-filter
  const baseSlots = computeSlots(row, date, busy, [], new Date());
  return baseSlots.filter(s => {
    const ss = Date.parse(s.startIso);
    const ee = Date.parse(s.endIso);
    const overlapping = existingBookings.filter(b => {
      const bs = Date.parse(b.start_iso);
      const be = Date.parse(b.end_iso);
      return ss < be && bs < ee;
    });
    return overlapping.length < capacity;
  });
}

// ---------------------------------------------------------------------------
// Public POST: create a booking
// ---------------------------------------------------------------------------
router.post('/api/public/booking/:slug', async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!rateLimit(ip)) return res.status(429).json({ ok: false, error: 'Too many requests' });

    const db = getDb();
    const ctx = loadPageWithExtras(db, req.params.slug);
    if (!ctx || !ctx.row.is_active) return res.status(404).json({ ok: false, error: 'Not found' });

    const body = req.body || {};
    const errors = [];
    if (!body.name) errors.push('name required');
    if (!body.email || !/^[^@]+@[^@]+\.[^@]+$/.test(body.email)) errors.push('valid email required');
    if (!body.startIso || !body.endIso) errors.push('start/end required');
    if (ctx.row.require_phone && !body.phone) errors.push('phone required');

    let eventType = null;
    if (body.typeSlug) {
      eventType = findEventType(db, ctx.row, body.typeSlug);
      if (!eventType) errors.push('event type not found');
    } else if (ctx.row.has_event_types) {
      errors.push('event type required for this page');
    }

    // Validate single-use invite if provided
    let inviteRow = null;
    if (body.inviteToken) {
      inviteRow = db.prepare('SELECT * FROM booking_invites WHERE token = ? AND page_id = ?').get(body.inviteToken, ctx.row.id);
      if (!inviteRow) errors.push('invalid invite link');
      else if (inviteRow.used_by_booking_id) errors.push('invite link already used');
      else if (inviteRow.expires_at && new Date(inviteRow.expires_at) < new Date()) errors.push('invite link expired');
    }

    // Validate custom question answers
    const answers = body.answers || {};
    for (const q of ctx.questions) {
      if (q.type_id && q.type_id !== eventType?.id) continue;
      const v = answers[q.id];
      if (q.required && !v) errors.push(`${q.label} required`);
    }

    if (errors.length) return res.status(400).json({ ok: false, error: errors.join('; ') });

    const startMs = Date.parse(body.startIso);
    const endMs = Date.parse(body.endIso);
    const policy = pickPolicy(ctx.row, eventType);
    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
      return res.status(400).json({ ok: false, error: 'invalid time range' });
    }
    if (endMs - startMs !== policy.durationMin * 60000) {
      return res.status(400).json({ ok: false, error: 'duration mismatch' });
    }

    // Re-validate slot availability
    const tz = ctx.row.timezone || 'UTC';
    const startDate = dateInTz(startMs, tz);
    const fromIso = `${startDate}T00:00:00.000Z`;
    const toIso = new Date(Date.parse(fromIso) + 36 * 3600 * 1000).toISOString();
    let busy = [];
    let checkIds = [];
    try { checkIds = JSON.parse(ctx.row.check_calendar_ids || '[]'); } catch {}
    const strategy = ctx.row.assignment_strategy || 'single';
    const hostIds = resolveHostUserIds(ctx.row);
    let teamPerHost = null; // for round-robin host selection later
    if (checkIds.length && hostIds.length) {
      try {
        if (strategy === 'collective' || strategy === 'single') {
          const t = await fetchTeamBusyIntervals(hostIds, checkIds, fromIso, toIso);
          busy = t.union;
          teamPerHost = t.perHost;
        } else if (strategy === 'round_robin') {
          const t = await fetchTeamBusyIntervals(hostIds, checkIds, fromIso, toIso);
          busy = intersectIntervals([...t.perHost.values()]);
          teamPerHost = t.perHost;
        }
      } catch {}
    }
    const dayStart = new Date(`${startDate}T00:00:00`).toISOString();
    const dayEnd = new Date(Date.parse(dayStart) + 36 * 3600 * 1000).toISOString();

    const id = uuid();
    const cancelToken = randomToken();
    const rescheduleToken = randomToken();
    const isPaid = !!eventType?.price_cents;

    // Decide which host to assign for this booking.
    //   single      → owner
    //   collective  → owner (all hosts attend; "primary" is the page owner)
    //   round_robin → load-balanced pick among hosts that are free at this slot
    let assignedUserId = ctx.row.user_id;
    if (strategy === 'round_robin' && hostIds.length > 1) {
      const slotStart = startMs;
      const slotEnd = endMs;
      const freeHosts = hostIds.filter(uid => {
        const intervals = teamPerHost?.get(uid) || [];
        return !intervals.some(iv => iv.start.getTime() < slotEnd && slotStart < iv.end.getTime());
      });
      if (freeHosts.length) {
        assignedUserId = pickRoundRobinHost(db, ctx.row.id, freeHosts);
      } else {
        // No host is actually free — slot recheck will reject below, but pick
        // owner as fallback so the FK is valid if somehow we proceed.
        assignedUserId = ctx.row.user_id;
      }
    }

    const computeRow = {
      ...ctx.row,
      duration_min: policy.durationMin,
      buffer_before_min: policy.bufferBeforeMin,
      buffer_after_min: policy.bufferAfterMin,
    };

    // Atomic slot-recheck + invite-spend + insert. If the slot is no longer free
    // OR the invite was already redeemed by a concurrent request, we throw inside
    // the transaction so SQLite rolls back and nothing partial persists.
    const reserveSlot = db.transaction(() => {
      const fresh = db.prepare(`
        SELECT * FROM bookings
        WHERE page_id = ? AND status = 'confirmed' AND start_iso < ? AND end_iso > ?
      `).all(ctx.row.id, dayEnd, dayStart);
      const slots = computeSlotsWithCapacity(computeRow, startDate, busy, fresh, policy.capacity);
      const stillFree = slots.some(s => s.startIso === new Date(startMs).toISOString());
      if (!stillFree) {
        const e = new Error('That time is no longer available.');
        e.http = 409; throw e;
      }
      if (inviteRow) {
        const upd = db.prepare(`
          UPDATE booking_invites SET used_by_booking_id = ?
          WHERE token = ? AND page_id = ? AND used_by_booking_id IS NULL
        `).run(id, inviteRow.token, ctx.row.id);
        if (upd.changes === 0) {
          const e = new Error('Invite link already used.');
          e.http = 409; throw e;
        }
      }
      db.prepare(`
        INSERT INTO bookings (
          id, page_id, type_id, invitee_name, invitee_email, invitee_phone, message, custom_answer,
          start_iso, end_iso, timezone,
          google_event_id, google_calendar_id, status,
          cancel_token, reschedule_token,
          invite_token, payment_status, answers_json,
          assigned_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, ctx.row.id, eventType?.id || null,
        body.name, body.email, body.phone || null, body.message || null,
        body.customAnswer || null,
        new Date(startMs).toISOString(), new Date(endMs).toISOString(),
        body.timezone || null,
        null, ctx.row.calendar_id || null,
        isPaid ? 'pending_payment' : 'confirmed',
        cancelToken, rescheduleToken,
        body.inviteToken || null,
        isPaid ? 'pending' : 'none',
        Object.keys(answers).length ? JSON.stringify(answers) : null,
        assignedUserId,
      );
    });

    try {
      reserveSlot();
    } catch (err) {
      const code = err.http || 500;
      return res.status(code).json({ ok: false, error: err.message });
    }

    // Best-effort: create Google Calendar event AFTER the booking is reserved.
    // If this fails, we keep the booking — the host loses the GCal entry but
    // the slot is already protected against double-booking.
    let googleEventId = null;
    // For round-robin, the calendar event lives on the assigned host's calendar.
    // Other strategies write to the page owner's calendar as before.
    const googleHostUserId = (strategy === 'round_robin') ? assignedUserId : ctx.row.user_id;
    const googleCalendarId = (strategy === 'round_robin' && assignedUserId !== ctx.row.user_id)
      ? 'primary'  // we don't know the assigned user's calendar list — use primary
      : (ctx.row.calendar_id || null);
    if (googleCalendarId && google.isConnected(googleHostUserId)) {
      try {
        const ev = await google.createEvent(googleHostUserId, googleCalendarId, {
          summary: `${eventType?.title || ctx.row.title} — ${body.name}`,
          description: buildEventDescription(ctx.row, eventType, body, ctx.questions),
          start: { dateTime: new Date(startMs).toISOString(), timeZone: tz },
          end: { dateTime: new Date(endMs).toISOString(), timeZone: tz },
          attendees: [{ email: body.email, displayName: body.name }],
          location: ctx.row.location_type === 'inperson' ? ctx.row.location_value : undefined,
          conferenceData: ctx.row.location_type === 'video' && !ctx.row.location_value
            ? { createRequest: { requestId: id, conferenceSolutionKey: { type: 'hangoutsMeet' } } }
            : undefined,
        });
        googleEventId = ev.id;
        db.prepare(
          `UPDATE bookings SET google_event_id = ?, calendar_sync_status = 'synced' WHERE id = ?`
        ).run(googleEventId, id);
      } catch (err) {
        // Mark for retry. The sweep in lib/calendarSyncRetry.js picks these
        // up and retries with exponential backoff. The booking itself is
        // already committed; the host gets a notification on final failure.
        const nextAt = new Date(Date.now() + 60_000).toISOString(); // first retry in 1 min
        db.prepare(
          `UPDATE bookings
             SET calendar_sync_status = 'pending',
                 calendar_sync_attempts = 1,
                 calendar_sync_next_at = ?,
                 calendar_sync_error = ?
           WHERE id = ?`
        ).run(nextAt, String(err.message || err).slice(0, 500), id);
        console.warn('Google event create failed (queued for retry):', err.message);
      }
    }

    const bookingRow = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);

    // Best-effort confirmation email
    sendBookingConfirmation({
      page: rowToPage(ctx.row),
      booking: bookingRow,
      eventType,
      hostName: ctx.row.host_name,
      hostEmail: ctx.row.host_email,
    }).catch(() => {});

    // Workflow webhooks + system webhook subscriptions fire ONLY for confirmed
    // (non-paid) bookings here. Paid bookings fire after payment success via
    // finalizePaidBookings sweep — otherwise the host would get notified about
    // a booking that may never actually pay.
    const eventPayload = {
      page: { slug: ctx.row.slug, title: ctx.row.title },
      eventType: eventType ? { slug: eventType.slug, title: eventType.title } : null,
      booking: {
        id, name: body.name, email: body.email, phone: body.phone || null,
        startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString(),
        timezone: body.timezone || null,
      },
    };
    if (!isPaid) {
      fireWorkflows(ctx.workflows, 'on_booked', eventPayload).catch(() => {});
      emitEvent('booking.created', eventPayload, ctx.row.user_id).catch(() => {});
    }

    // For paid bookings, create a Stripe Checkout session and surface the URL
    // so the widget can redirect the invitee. Booking is already saved as
    // status='pending_payment'; the webhook flips it to 'confirmed'.
    let checkoutUrl = null;
    if (isPaid && isStripeConfigured()) {
      try {
        const session = await createBookingCheckout({
          booking: bookingRow,
          eventType,
          page: ctx.row,
          hostUserId: ctx.row.user_id,
        });
        checkoutUrl = session.url;
      } catch (err) {
        console.warn('booking checkout session failed:', err.message);
      }
    }

    res.json({
      ok: true,
      booking: {
        id,
        startIso: new Date(startMs).toISOString(),
        endIso: new Date(endMs).toISOString(),
        cancelUrl: `/book/cancel/${cancelToken}`,
        rescheduleUrl: `/book/reschedule/${rescheduleToken}`,
        icsUrl: ctx.row.enable_ics ? `/api/public/booking/by-cancel-token/${cancelToken}/ics` : null,
        addToCalendar: {
          google: googleCalendarUrl({
            summary: eventType?.title || ctx.row.title,
            description: ctx.row.description || '',
            start: new Date(startMs),
            end: new Date(endMs),
            location: ctx.row.location_value || '',
          }),
          outlook: outlookUrl({
            summary: eventType?.title || ctx.row.title,
            description: ctx.row.description || '',
            start: new Date(startMs),
            end: new Date(endMs),
            location: ctx.row.location_value || '',
          }),
        },
        requiresPayment: isPaid,
        checkoutUrl,
      },
      redirect: ctx.row.redirect_url || null,
    });
  } catch (err) {
    console.error('POST booking error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function buildEventDescription(page, eventType, body, questions) {
  const lines = [];
  lines.push(`Booked via ${eventType?.title || page.title}`);
  if (body.message) lines.push('', 'Message:', body.message);
  for (const q of questions || []) {
    if (q.type_id && q.type_id !== eventType?.id) continue;
    const v = body.answers?.[q.id];
    if (v != null && v !== '') {
      lines.push('', `${q.label}:`, Array.isArray(v) ? v.join(', ') : String(v));
    }
  }
  if (body.phone) lines.push('', `Phone: ${body.phone}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public cancel / reschedule (POST cancel)
// ---------------------------------------------------------------------------
router.post('/api/public/booking/cancel/:token', async (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM bookings WHERE cancel_token = ?').get(req.params.token);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    if (row.status !== 'confirmed') return res.json({ ok: true, alreadyCancelled: true });

    db.prepare(`
      UPDATE bookings SET status = 'cancelled', cancellation_reason = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run((req.body && req.body.reason) || null, row.id);

    const pageRow = db.prepare('SELECT * FROM booking_pages WHERE id = ?').get(row.page_id);
    if (row.google_event_id && row.google_calendar_id && pageRow && google.isConnected(pageRow.user_id)) {
      try { await google.deleteEvent(pageRow.user_id, row.google_calendar_id, row.google_event_id); } catch {}
    }

    if (pageRow) {
      sendBookingCancellation({
        page: rowToPage(pageRow),
        booking: row,
        reason: (req.body && req.body.reason) || null,
      }).catch(() => {});

      const workflows = db.prepare('SELECT * FROM booking_workflows WHERE page_id = ? AND is_active = 1').all(row.page_id);
      const cancelPayload = {
        page: { slug: pageRow.slug, title: pageRow.title },
        booking: { id: row.id, email: row.invitee_email, name: row.invitee_name, startIso: row.start_iso },
        reason: (req.body && req.body.reason) || null,
      };
      fireWorkflows(workflows, 'on_cancelled', cancelPayload).catch(() => {});
      emitEvent('booking.canceled', cancelPayload, pageRow.user_id).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Lookup by cancel token
router.get('/api/public/booking/by-cancel-token/:token', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT b.*, p.title AS page_title, p.slug AS page_slug, p.host_name, p.duration_min,
             p.brand_color, p.logo_url, p.cover_image_url
      FROM bookings b JOIN booking_pages p ON p.id = b.page_id
      WHERE b.cancel_token = ?
    `).get(req.params.token);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({
      ok: true,
      booking: {
        id: row.id,
        startIso: row.start_iso,
        endIso: row.end_iso,
        status: row.status,
        inviteeName: row.invitee_name,
        inviteeEmail: row.invitee_email,
        page: {
          title: row.page_title, slug: row.page_slug, hostName: row.host_name,
          durationMin: row.duration_min, brandColor: row.brand_color,
          logoUrl: row.logo_url, coverImageUrl: row.cover_image_url,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Reschedule: GET booking by reschedule token + POST in-place reschedule
// ---------------------------------------------------------------------------
router.get('/api/public/booking/by-reschedule-token/:token', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT b.*, p.title AS page_title, p.slug AS page_slug, p.host_name, p.duration_min,
             p.brand_color, p.logo_url, p.cover_image_url, p.timezone AS page_tz
      FROM bookings b JOIN booking_pages p ON p.id = b.page_id
      WHERE b.reschedule_token = ?
    `).get(req.params.token);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    if (row.status !== 'confirmed') {
      return res.status(410).json({ ok: false, error: 'This booking can no longer be rescheduled.' });
    }
    res.json({
      ok: true,
      booking: {
        id: row.id,
        startIso: row.start_iso,
        endIso: row.end_iso,
        status: row.status,
        inviteeName: row.invitee_name,
        inviteeEmail: row.invitee_email,
        page: {
          title: row.page_title, slug: row.page_slug, hostName: row.host_name,
          durationMin: row.duration_min, brandColor: row.brand_color,
          logoUrl: row.logo_url, coverImageUrl: row.cover_image_url,
          timezone: row.page_tz,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/api/public/booking/reschedule/:token', async (req, res) => {
  try {
    const db = getDb();
    const ip = req.ip;
    if (!rateLimit(ip, 10, 60000)) return res.status(429).json({ ok: false, error: 'Too many requests' });

    const body = req.body || {};
    if (!body.startIso || !body.endIso) {
      return res.status(400).json({ ok: false, error: 'startIso and endIso required' });
    }
    const newStartMs = Date.parse(body.startIso);
    const newEndMs = Date.parse(body.endIso);
    if (isNaN(newStartMs) || isNaN(newEndMs) || newEndMs <= newStartMs) {
      return res.status(400).json({ ok: false, error: 'invalid time range' });
    }

    const booking = db.prepare(`
      SELECT b.*, p.id AS page_id, p.user_id AS p_user_id, p.timezone AS page_tz,
             p.calendar_id AS page_cal_id, p.duration_min AS page_dur,
             p.buffer_before_min AS page_bb, p.buffer_after_min AS page_ba,
             p.check_calendar_ids AS page_check_ids, p.title AS page_title, p.slug AS page_slug
      FROM bookings b JOIN booking_pages p ON p.id = b.page_id
      WHERE b.reschedule_token = ?
    `).get(req.params.token);
    if (!booking) return res.status(404).json({ ok: false, error: 'Not found' });
    if (booking.status !== 'confirmed') {
      return res.status(410).json({ ok: false, error: 'This booking can no longer be rescheduled.' });
    }

    // Validate the new slot is currently free. Reuse computeSlots semantics.
    const tz = booking.page_tz || 'UTC';
    const startDate = dateInTz(newStartMs, tz);
    const fromIso = `${startDate}T00:00:00.000Z`;
    const toIso = new Date(Date.parse(fromIso) + 36 * 3600 * 1000).toISOString();
    let busy = [];
    let checkIds = [];
    try { checkIds = JSON.parse(booking.page_check_ids || '[]'); } catch {}
    if (checkIds.length && google.isConnected(booking.p_user_id)) {
      try { busy = await fetchBusyIntervals(booking.p_user_id, checkIds, fromIso, toIso); } catch {}
    }
    const dayStart = new Date(`${startDate}T00:00:00`).toISOString();
    const dayEnd = new Date(Date.parse(dayStart) + 36 * 3600 * 1000).toISOString();

    // Atomic recheck + update. Exclude the booking we're moving from the busy
    // set so it doesn't conflict with itself.
    const moveBooking = db.transaction(() => {
      const existingBookings = db.prepare(`
        SELECT * FROM bookings
        WHERE page_id = ? AND status = 'confirmed' AND id != ?
          AND start_iso < ? AND end_iso > ?
      `).all(booking.page_id, booking.id, dayEnd, dayStart);
      const computeRow = {
        ...booking,
        duration_min: booking.page_dur,
        buffer_before_min: booking.page_bb,
        buffer_after_min: booking.page_ba,
        timezone: tz,
        slot_step_min: 5,           // permissive on reschedule (no step gating)
        min_notice_min: 0,
        max_advance_days: 365,
      };
      const slots = computeSlots(computeRow, startDate, busy, existingBookings);
      const targetIso = new Date(newStartMs).toISOString();
      if (!slots.some(s => s.startIso === targetIso)) {
        const e = new Error('That time is no longer available.');
        e.http = 409; throw e;
      }
      db.prepare(`
        UPDATE bookings SET start_iso = ?, end_iso = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(new Date(newStartMs).toISOString(), new Date(newEndMs).toISOString(), booking.id);
    });

    try {
      moveBooking();
    } catch (err) {
      const code = err.http || 500;
      return res.status(code).json({ ok: false, error: err.message });
    }

    // Best-effort: patch the Google Calendar event to the new times.
    if (booking.google_event_id && booking.google_calendar_id && google.isConnected(booking.p_user_id)) {
      try {
        await google.updateEvent(booking.p_user_id, booking.google_calendar_id, booking.google_event_id, {
          start: { dateTime: new Date(newStartMs).toISOString(), timeZone: tz },
          end:   { dateTime: new Date(newEndMs).toISOString(),   timeZone: tz },
        });
      } catch (err) {
        console.warn('reschedule google update failed:', err.message);
      }
    }

    // Fire webhook event
    emitEvent('booking.rescheduled', {
      page: { slug: booking.page_slug, title: booking.page_title },
      booking: {
        id: booking.id,
        email: booking.invitee_email,
        oldStartIso: booking.start_iso,
        startIso: new Date(newStartMs).toISOString(),
        endIso: new Date(newEndMs).toISOString(),
      },
    }, booking.p_user_id).catch(() => {});

    res.json({
      ok: true,
      booking: {
        id: booking.id,
        startIso: new Date(newStartMs).toISOString(),
        endIso: new Date(newEndMs).toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// ICS download
// ---------------------------------------------------------------------------
router.get('/api/public/booking/by-cancel-token/:token/ics', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT b.*, p.title AS page_title, p.description AS page_desc,
             p.location_value AS page_loc, p.host_name, p.host_email, p.slug AS page_slug
      FROM bookings b JOIN booking_pages p ON p.id = b.page_id
      WHERE b.cancel_token = ?
    `).get(req.params.token);
    if (!row) return res.status(404).send('Not found');
    const ics = buildIcs({
      uid: row.id,
      summary: row.page_title,
      description: row.page_desc || '',
      start: row.start_iso,
      end: row.end_iso,
      location: row.page_loc,
      organizer: row.host_email ? { name: row.host_name, email: row.host_email } : null,
      attendee: { name: row.invitee_name, email: row.invitee_email },
      url: `${publicOrigin(req)}/book/${row.page_slug}`,
    });
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="invite.ics"`);
    res.send(ics);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ---------------------------------------------------------------------------
// Single-use invite endpoints
// ---------------------------------------------------------------------------
router.get('/api/public/invite/:token', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT bi.*, p.slug AS page_slug, p.title AS page_title, p.is_active AS page_active
      FROM booking_invites bi
      JOIN booking_pages p ON p.id = bi.page_id
      WHERE bi.token = ?
    `).get(req.params.token);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    if (row.used_by_booking_id) return res.status(410).json({ ok: false, error: 'Link already used' });
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return res.status(410).json({ ok: false, error: 'Link expired' });
    }
    if (!row.page_active) return res.status(404).json({ ok: false, error: 'Page is inactive' });
    res.json({
      ok: true,
      invite: {
        token: row.token,
        pageSlug: row.page_slug,
        typeId: row.type_id,
        expiresAt: row.expires_at,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Routing forms (public submission)
// ---------------------------------------------------------------------------
router.get('/api/public/forms/:slug', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM routing_forms WHERE slug = ? AND is_active = 1').get(req.params.slug);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    let questions = [];
    try { questions = JSON.parse(row.questions_json || '[]'); } catch {}
    // Rules are deliberately NOT returned — they map answers to internal page
    // slugs and would let any anonymous visitor enumerate the routing setup.
    // Submit answers via POST /api/public/forms/:slug/route to get a destination.
    res.json({
      ok: true,
      form: { slug: row.slug, title: row.title, description: row.description, questions },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/api/public/forms/:slug/route', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM routing_forms WHERE slug = ? AND is_active = 1').get(req.params.slug);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    let rules = [];
    try { rules = JSON.parse(row.rules_json || '[]'); } catch {}
    const answers = req.body?.answers || {};
    // First matching rule wins
    for (const rule of rules) {
      const matches = (rule.when || []).every(c => matchCondition(c, answers[c.q]));
      if (matches) {
        return res.json({
          ok: true,
          target: {
            pageSlug: rule.goto?.pageSlug || null,
            typeSlug: rule.goto?.typeSlug || null,
            url: rule.goto?.pageSlug
              ? `/book/${rule.goto.pageSlug}${rule.goto.typeSlug ? `/${rule.goto.typeSlug}` : ''}`
              : null,
          },
        });
      }
    }
    res.json({ ok: true, target: null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

function matchCondition(cond, value) {
  if (!cond) return false;
  switch (cond.op) {
    case 'eq': return value === cond.value;
    case 'neq': return value !== cond.value;
    case 'contains': return String(value || '').toLowerCase().includes(String(cond.value || '').toLowerCase());
    case 'in': return Array.isArray(cond.value) && cond.value.includes(value);
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Time-poll (Doodle-style)
// ---------------------------------------------------------------------------
router.post('/api/public/booking/:slug/poll', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT id FROM booking_pages WHERE slug = ? AND is_active = 1').get(req.params.slug);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    const b = req.body || {};
    if (!b.email || !Array.isArray(b.proposedIso) || b.proposedIso.length === 0) {
      return res.status(400).json({ ok: false, error: 'email and proposedIso[] required' });
    }
    const id = uuid();
    db.prepare(`
      INSERT INTO time_polls (id, page_id, invitee_email, proposed_iso_json, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(id, row.id, b.email, JSON.stringify(b.proposedIso));
    res.json({ ok: true, pollId: id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Public HTML entry
// ---------------------------------------------------------------------------
const distPath = join(__dirname, '..', '..', 'dist');
function serveBookingHtml(req, res) {
  const candidates = [join(distPath, 'book.html'), join(__dirname, '..', 'views', 'book.html')];
  for (const p of candidates) {
    if (existsSync(p)) return res.type('html').send(readFileSync(p, 'utf8'));
  }
  res.status(500).send('Booking widget not built');
}

// Specific routes BEFORE the catch-all /book/:slug — Express matches in
// registration order, so without this the cancel/reschedule/invite/form
// routes would be shadowed by /book/:slug interpreting the literal segment
// as a slug. They all happen to call the same handler today, but reordering
// keeps the routing intent correct if behaviour ever diverges.
router.get('/book/cancel/:token', serveBookingHtml);
router.get('/book/reschedule/:token', serveBookingHtml);
router.get('/book/i/:token', serveBookingHtml);   // single-use invites
router.get('/book/form/:slug', serveBookingHtml); // routing forms
router.get('/book/:slug', serveBookingHtml);
router.get('/book/:slug/:typeSlug', serveBookingHtml);

export default router;
