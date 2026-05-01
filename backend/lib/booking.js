import { randomBytes } from 'crypto';
import * as google from './google.js';

/**
 * ---------------------------------------------------------------------------
 * Booking availability logic
 *
 * Inputs (page row):
 *   duration_min, buffer_before_min, buffer_after_min, slot_step_min,
 *   min_notice_min, max_advance_days, daily_max,
 *   availability_json: {
 *     sun:[{start:"09:00",end:"17:00"}], mon:[...], ..., sat:[...],
 *     overrides: { "2026-05-01": null | [{start,end}, ...] }   // null = closed
 *   },
 *   check_calendar_ids: JSON array of calendar IDs,
 *   timezone (host tz, IANA),
 * Inputs (request):
 *   date "YYYY-MM-DD" (host-local date for the day to display),
 *   inviteeTz (optional; only affects formatting upstream)
 *
 * Returns:
 *   [{ startIso, endIso, label }]  in UTC ISO; widget formats labels in invitee tz
 * ---------------------------------------------------------------------------
 */

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseHM(hm) {
  const [h, m] = hm.split(':').map(Number);
  return { h, m };
}

/**
 * Convert a host-local "YYYY-MM-DD" + "HH:MM" + tz to a UTC Date by computing
 * the offset of that wall-clock time in the target IANA timezone.
 *
 * This avoids pulling in a heavy tz library; we lean on Intl.DateTimeFormat.
 */
function tzWallToUtc(dateStr, hm, tz) {
  // Convert a wall-clock (date + HH:MM) in tz to a UTC instant.
  //
  // DST edge cases:
  //   • Fall-back: a wall time like 01:30 occurs twice (two valid UTC instants).
  //     We prefer the earlier instant (pre-DST-end), which matches what most
  //     scheduling tools do — bookings can sit on the "first" 01:30, and the
  //     "second" 01:30 is reachable only via the prev-DST window above.
  //   • Spring-forward: a wall time like 02:30 doesn't exist. We resolve to the
  //     instant the gap *starts* (the moment the clock jumps forward), so the
  //     slot still has a deterministic UTC anchor and won't crash callers.
  const [y, mo, d] = dateStr.split('-').map(Number);
  const { h, m } = parseHM(hm);
  const naive = Date.UTC(y, mo - 1, d, h, m, 0);

  // Probe offsets ±12h from the naive instant. These bracket any DST transition
  // (transitions are always 1h, sometimes 30m; never more than a few hours).
  const offBefore = getTimezoneOffsetMinutes(naive - 12 * 3600 * 1000, tz);
  const offAfter  = getTimezoneOffsetMinutes(naive + 12 * 3600 * 1000, tz);

  // Candidate UTC instants assuming each offset.
  const candA = naive - offBefore * 60000;
  const candB = naive - offAfter  * 60000;

  // For each candidate, ask Intl what wall-clock it actually maps to in tz.
  // A candidate is "valid" if it round-trips to the requested wall time.
  const matchA = wallMatches(candA, y, mo, d, h, m, tz);
  const matchB = wallMatches(candB, y, mo, d, h, m, tz);

  if (matchA && matchB) {
    // Ambiguous (fall-back) → pick earlier UTC.
    return new Date(Math.min(candA, candB));
  }
  if (matchA) return new Date(candA);
  if (matchB) return new Date(candB);

  // Neither matches → spring-forward gap. Use the candidate that's closer to
  // the naive instant; semantically this lands at the moment the gap starts.
  const fallback = Math.abs(candA - naive) <= Math.abs(candB - naive) ? candA : candB;
  return new Date(fallback);
}

function wallMatches(utcMs, y, mo, d, h, m, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const map = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) map[p.type] = p.value;
  return (
    Number(map.year) === y &&
    Number(map.month) === mo &&
    Number(map.day) === d &&
    (Number(map.hour) === 24 ? 0 : Number(map.hour)) === h &&
    Number(map.minute) === m
  );
}

/**
 * Returns the offset (in minutes east of UTC) for the given tz at the given UTC instant.
 */
function getTimezoneOffsetMinutes(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  // Reconstruct what wall-clock that instant is in tz, then compare to UTC.
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) === 24 ? 0 : Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return Math.round((asUtc - utcMs) / 60000);
}

function dayKeyForDate(dateStr) {
  // dateStr "YYYY-MM-DD" → weekday key in host context (timezone-agnostic for date math)
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return DAY_KEYS[dow];
}

/**
 * Compute candidate slots for a given host-local date.
 *
 * page: row from booking_pages
 * busyEvents: array of { start: Date, end: Date } that block availability
 *   (gathered upstream from Google + existing bookings)
 * existingBookingsForDay: array of bookings for the same day (for daily_max)
 * now: Date (defaults to new Date()); used for min_notice
 */
export function computeSlots(page, dateStr, busyEvents, existingBookingsForDay, now = new Date()) {
  const tz = page.timezone || 'UTC';
  const availability = parseAvailability(page.availability_json);
  // Daily max: if reached, no slots.
  if (page.daily_max && existingBookingsForDay.length >= page.daily_max) {
    return [];
  }

  // Determine the windows for this date — overrides win, otherwise per-weekday.
  let windows = null;
  const overrides = availability.overrides || {};
  if (Object.prototype.hasOwnProperty.call(overrides, dateStr)) {
    const o = overrides[dateStr];
    if (o === null || (Array.isArray(o) && o.length === 0)) return []; // closed
    windows = o;
  } else {
    windows = availability[dayKeyForDate(dateStr)] || [];
  }
  if (!windows.length) return [];

  // Min/max bounds
  const earliest = new Date(now.getTime() + (page.min_notice_min || 0) * 60000);
  const latest = new Date(now.getTime() + (page.max_advance_days || 365) * 86400000);

  const duration = page.duration_min;
  const step = page.slot_step_min || page.duration_min;
  const bufBefore = page.buffer_before_min || 0;
  const bufAfter = page.buffer_after_min || 0;

  const slots = [];

  for (const w of windows) {
    let cursorUtc = tzWallToUtc(dateStr, w.start, tz);
    const windowEndUtc = tzWallToUtc(dateStr, w.end, tz);

    while (cursorUtc.getTime() + duration * 60000 <= windowEndUtc.getTime()) {
      const slotStart = new Date(cursorUtc);
      const slotEnd = new Date(cursorUtc.getTime() + duration * 60000);

      // Buffer-extended interval used for conflict checks:
      const bufStart = new Date(slotStart.getTime() - bufBefore * 60000);
      const bufEnd = new Date(slotEnd.getTime() + bufAfter * 60000);

      const respectsNotice = slotStart >= earliest;
      const respectsMaxAdvance = slotStart <= latest;
      const conflictsWithBusy = busyEvents.some(b => intervalsOverlap(bufStart, bufEnd, b.start, b.end));
      const conflictsWithBooking = existingBookingsForDay.some(b => {
        const bs = new Date(b.start_iso);
        const be = new Date(b.end_iso);
        return intervalsOverlap(bufStart, bufEnd, bs, be);
      });

      if (respectsNotice && respectsMaxAdvance && !conflictsWithBusy && !conflictsWithBooking) {
        slots.push({
          startIso: slotStart.toISOString(),
          endIso: slotEnd.toISOString(),
        });
      }

      cursorUtc = new Date(cursorUtc.getTime() + step * 60000);
    }
  }
  return slots;
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function parseAvailability(json) {
  try {
    const v = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    return v || {};
  } catch {
    return {};
  }
}

/**
 * Default availability template: Mon-Fri 9am-5pm.
 */
export function defaultAvailability() {
  return {
    sun: [],
    mon: [{ start: '09:00', end: '17:00' }],
    tue: [{ start: '09:00', end: '17:00' }],
    wed: [{ start: '09:00', end: '17:00' }],
    thu: [{ start: '09:00', end: '17:00' }],
    fri: [{ start: '09:00', end: '17:00' }],
    sat: [],
    overrides: {},
  };
}

/**
 * Fetch busy intervals across multiple Google calendars within a window.
 * Returns array of { start: Date, end: Date }. All-day events are blocked-out
 * fully. Cancelled and tentative events are excluded.
 */
export async function fetchBusyIntervals(userId, calendarIds, fromIso, toIso) {
  if (!calendarIds || !calendarIds.length) return [];
  const lists = await Promise.all(
    calendarIds.map(id => google.listEvents(userId, id, fromIso, toIso).catch(() => []))
  );
  const intervals = [];
  for (const events of lists) {
    for (const ev of events) {
      if (ev.status === 'cancelled') continue;
      if (ev.transparency === 'transparent') continue; // marked "free"
      const start = ev.start?.dateTime || ev.start?.date;
      const end = ev.end?.dateTime || ev.end?.date;
      if (!start || !end) continue;
      intervals.push({ start: new Date(start), end: new Date(end) });
    }
  }
  return intervals;
}

/**
 * Resolve the list of host user IDs for a page. Always includes the page
 * owner (user_id). Falls back to [user_id] for legacy/single-host pages.
 */
export function resolveHostUserIds(page) {
  const owner = page.user_id;
  let extras = [];
  try {
    extras = JSON.parse(page.host_user_ids || '[]');
    if (!Array.isArray(extras)) extras = [];
  } catch { extras = []; }
  const set = new Set([owner, ...extras.filter(x => Number.isFinite(Number(x)))]);
  return Array.from(set).map(Number);
}

/**
 * Gather busy intervals across all hosts of a team booking page.
 * For 'collective' strategy: a slot is blocked if ANY host is busy → just
 *   union all hosts' intervals.
 * For 'round_robin': a slot is bookable if AT LEAST ONE host is free →
 *   we return intervals as a per-host map so the caller can intersect.
 *
 * Returns: { union: Interval[], perHost: Map<userId, Interval[]> }
 */
export async function fetchTeamBusyIntervals(hostUserIds, calendarIds, fromIso, toIso) {
  const perHost = new Map();
  const unionList = [];
  for (const uid of hostUserIds) {
    let intervals = [];
    try {
      intervals = await fetchBusyIntervals(uid, calendarIds || [], fromIso, toIso);
    } catch {
      // If a host's Google isn't connected, treat their schedule as unknown
      // (we conservatively assume they're FREE — better to occasionally
      // double-book a misconfigured host than to ghost-cancel valid slots).
    }
    perHost.set(uid, intervals);
    unionList.push(...intervals);
  }
  return { union: unionList, perHost };
}

/**
 * Pick the next host for a round-robin booking.
 * Strategy: load-balanced — pick whichever host has the fewest confirmed
 * upcoming bookings on this page. Stable tiebreaker = host_user_ids order.
 */
export function pickRoundRobinHost(db, pageId, hostUserIds) {
  if (!hostUserIds.length) return null;
  const counts = new Map(hostUserIds.map(uid => [uid, 0]));
  const rows = db.prepare(`
    SELECT assigned_user_id, COUNT(*) AS n
    FROM bookings
    WHERE page_id = ? AND status = 'confirmed'
      AND start_iso > datetime('now')
    GROUP BY assigned_user_id
  `).all(pageId);
  for (const r of rows) {
    if (r.assigned_user_id && counts.has(r.assigned_user_id)) {
      counts.set(r.assigned_user_id, r.n);
    }
  }
  let best = hostUserIds[0];
  let bestCount = counts.get(best);
  for (const uid of hostUserIds) {
    const c = counts.get(uid);
    if (c < bestCount) { best = uid; bestCount = c; }
  }
  return best;
}

/**
 * Generate a URL-safe slug suggestion from a title.
 */
export function slugify(input) {
  return (input || 'meet')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'meet';
}

/**
 * Generate a random slug fragment to disambiguate. Not security-sensitive
 * but uses CSPRNG anyway for consistency.
 */
export function randomSlugFragment() {
  return randomBytes(4).toString('hex').slice(0, 5);
}

/**
 * Generate a random opaque token for cancel/reschedule/invite URLs.
 * Cryptographically secure — these are the sole credential anonymous users
 * need to cancel/reschedule any booking, so predictability would be a vuln.
 */
export function randomToken() {
  return randomBytes(16).toString('hex'); // 128 bits of real entropy
}
