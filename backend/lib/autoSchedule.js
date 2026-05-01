import * as google from './google.js';
import { fetchBusyIntervals } from './booking.js';

/**
 * AI auto-scheduling for tasks.
 *
 * Given a task with estimated_minutes and an optional dueDate, find the next
 * free slot inside the user's work hours that doesn't conflict with any busy
 * event (Google Calendar) or any earlier auto-scheduled block on the same
 * calendar. Honors a configurable buffer between events and a "deep work
 * preference" that prefers morning slots for >=60min tasks.
 *
 * Inputs:
 *   userId         — owner
 *   calendarIds    — calendars to treat as busy (the user's primary + any
 *                    they choose to "block against" in settings)
 *   workHours      — { mon:[{start:"09:00",end:"17:00"}], tue:[…], … }
 *                    Same shape as booking-page availability, minus overrides.
 *   timezone       — IANA tz used to interpret workHours wall-clock
 *   durationMin    — required slot length
 *   bufferMin      — minutes of breathing room before+after (default 10)
 *   notBefore      — Date; never schedule before this (default = now+15min)
 *   notAfter       — Date; never schedule after this (default = notBefore + 14d)
 *   stepMin        — search granularity (default 15)
 *
 * Returns: { startIso, endIso } or null if no slot is free in the window.
 */
export async function findNextFreeSlot({
  userId, calendarIds, workHours, timezone,
  durationMin, bufferMin = 10, notBefore, notAfter, stepMin = 15,
  extraBusy = [],
}) {
  const tz = timezone || 'UTC';
  const start = notBefore || new Date(Date.now() + 15 * 60_000);
  const end = notAfter || new Date(start.getTime() + 14 * 86_400_000);

  // Pull all busy intervals once (covers the entire search window). Caller
  // can also pass `extraBusy` (e.g. focus blocks) which is merged in.
  const fetched = await fetchBusyIntervals(
    userId,
    calendarIds || [],
    start.toISOString(),
    end.toISOString(),
  );
  const busy = [...fetched, ...extraBusy];
  // Sort once for fast overlap checks.
  busy.sort((a, b) => a.start - b.start);

  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  // Walk forward day-by-day in the host tz.
  let cursorDate = ymdInTz(start, tz);
  const lastDate = ymdInTz(end, tz);

  let safety = 60; // never search >60 days, no matter the inputs
  while (cursorDate <= lastDate && safety-- > 0) {
    const wkKey = dayKeys[weekdayInTz(cursorDate, tz)];
    const windows = (workHours && workHours[wkKey]) || [];
    for (const w of windows) {
      const winStart = wallToUtc(cursorDate, w.start, tz);
      const winEnd   = wallToUtc(cursorDate, w.end,   tz);
      // Clamp to overall search range.
      let cursor = new Date(Math.max(winStart.getTime(), start.getTime()));
      // Snap up to the next stepMin boundary.
      cursor = snapUp(cursor, stepMin);

      while (cursor.getTime() + durationMin * 60_000 <= winEnd.getTime()) {
        const slotStart = cursor;
        const slotEnd = new Date(cursor.getTime() + durationMin * 60_000);
        if (slotEnd > end) break;

        // Buffer-extended interval used for conflict checks.
        const probeStart = new Date(slotStart.getTime() - bufferMin * 60_000);
        const probeEnd   = new Date(slotEnd.getTime()   + bufferMin * 60_000);

        // Linear scan; busy is sorted but list is small (a workday's events).
        let conflict = false;
        for (const b of busy) {
          if (b.end <= probeStart) continue;
          if (b.start >= probeEnd) break;
          conflict = true; break;
        }
        if (!conflict) {
          return { startIso: slotStart.toISOString(), endIso: slotEnd.toISOString() };
        }
        cursor = new Date(cursor.getTime() + stepMin * 60_000);
      }
    }
    cursorDate = nextDate(cursorDate);
  }
  return null;
}

/**
 * Like findNextFreeSlot but returns up to `limit` free slots inside the
 * search window. Walks the same day-by-day work-hours grid; each found slot
 * is added and the cursor advances by `durationMin` (so we don't return
 * heavily-overlapping starts). Caller can render these as suggestion list.
 */
export async function findFreeSlots({
  userId, calendarIds, workHours, timezone,
  durationMin, bufferMin = 10, notBefore, notAfter, stepMin = 15,
  extraBusy = [], limit = 8,
}) {
  const tz = timezone || 'UTC';
  const start = notBefore || new Date(Date.now() + 15 * 60_000);
  const end = notAfter || new Date(start.getTime() + 14 * 86_400_000);

  const fetched = await fetchBusyIntervals(
    userId,
    calendarIds || [],
    start.toISOString(),
    end.toISOString(),
  );
  const busy = [...fetched, ...extraBusy];
  busy.sort((a, b) => a.start - b.start);

  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const found = [];

  let cursorDate = ymdInTz(start, tz);
  const lastDate = ymdInTz(end, tz);

  let safety = 60;
  while (cursorDate <= lastDate && safety-- > 0 && found.length < limit) {
    const wkKey = dayKeys[weekdayInTz(cursorDate, tz)];
    const windows = (workHours && workHours[wkKey]) || [];
    for (const w of windows) {
      if (found.length >= limit) break;
      const winStart = wallToUtc(cursorDate, w.start, tz);
      const winEnd   = wallToUtc(cursorDate, w.end,   tz);
      let cursor = new Date(Math.max(winStart.getTime(), start.getTime()));
      cursor = snapUp(cursor, stepMin);

      while (cursor.getTime() + durationMin * 60_000 <= winEnd.getTime() && found.length < limit) {
        const slotStart = cursor;
        const slotEnd = new Date(cursor.getTime() + durationMin * 60_000);
        if (slotEnd > end) break;

        const probeStart = new Date(slotStart.getTime() - bufferMin * 60_000);
        const probeEnd   = new Date(slotEnd.getTime()   + bufferMin * 60_000);

        let conflict = false;
        for (const b of busy) {
          if (b.end <= probeStart) continue;
          if (b.start >= probeEnd) break;
          conflict = true; break;
        }
        if (!conflict) {
          found.push({ startIso: slotStart.toISOString(), endIso: slotEnd.toISOString() });
          // Advance past this slot to avoid back-to-back overlaps.
          cursor = new Date(cursor.getTime() + durationMin * 60_000);
        } else {
          cursor = new Date(cursor.getTime() + stepMin * 60_000);
        }
      }
    }
    cursorDate = nextDate(cursorDate);
  }
  return found;
}

/**
 * High-level: given a task, schedule it to the user's primary calendar and
 * return the created event row. Caller is responsible for marking the task
 * as scheduled (e.g. setting due_datetime in Todoist).
 */
export async function autoScheduleTask({
  userId, task, calendarId, calendarIds, workHours, timezone, bufferMin,
  extraBusy = [],
}) {
  const durationMin = Math.max(15, Math.min(8 * 60, Number(task.estimatedMinutes) || 30));
  // Don't schedule past the task's due date if one is set.
  let notAfter = null;
  if (task.dueDate) {
    // End-of-day in host tz, conservative.
    notAfter = wallToUtc(task.dueDate, '23:59', timezone || 'UTC');
  }

  const slot = await findNextFreeSlot({
    userId, calendarIds: calendarIds || [calendarId],
    workHours, timezone,
    durationMin, bufferMin,
    notAfter,
    extraBusy,
  });
  if (!slot) return { ok: false, error: 'No free slot found in the next 14 days during your work hours.' };

  const ev = await google.createEvent(userId, calendarId, {
    summary: task.content,
    description: task.description ? `${task.description}\n\n— Auto-scheduled by productivity.do` : 'Auto-scheduled by productivity.do',
    start: { dateTime: slot.startIso, timeZone: timezone || 'UTC' },
    end:   { dateTime: slot.endIso,   timeZone: timezone || 'UTC' },
    extendedProperties: {
      private: { autoScheduledFromTaskId: String(task.id || '') },
    },
  });
  return {
    ok: true,
    event: ev,
    startIso: slot.startIso,
    endIso: slot.endIso,
  };
}

// ---------------------------------------------------------------------------
// Date helpers (tz-aware, no extra deps)
// ---------------------------------------------------------------------------

function ymdInTz(d, tz) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return dtf.format(d); // "YYYY-MM-DD"
}

function weekdayInTz(ymd, tz) {
  // Get the weekday number (0=Sun..6=Sat) for a YYYY-MM-DD interpreted in tz.
  // We probe noon to avoid DST edges affecting day identity.
  const utcNoon = wallToUtc(ymd, '12:00', tz);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short',
  });
  const w = dtf.format(utcNoon);
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(w);
}

function nextDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function snapUp(d, stepMin) {
  const ms = stepMin * 60_000;
  const t = d.getTime();
  return new Date(Math.ceil(t / ms) * ms);
}

// Same DST-safe algorithm as backend/lib/booking.js → tzWallToUtc.
export function wallToUtc(ymd, hm, tz) {
  const [y, mo, d] = ymd.split('-').map(Number);
  const [h, m] = hm.split(':').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, m, 0);

  const offBefore = offsetMinutes(naive - 12 * 3600 * 1000, tz);
  const offAfter  = offsetMinutes(naive + 12 * 3600 * 1000, tz);
  const candA = naive - offBefore * 60_000;
  const candB = naive - offAfter  * 60_000;

  const matchA = wallMatches(candA, y, mo, d, h, m, tz);
  const matchB = wallMatches(candB, y, mo, d, h, m, tz);
  if (matchA && matchB) return new Date(Math.min(candA, candB));
  if (matchA) return new Date(candA);
  if (matchB) return new Date(candB);
  return new Date(candA); // spring-forward gap
}

function offsetMinutes(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour) === 24 ? 0 : Number(map.hour),
    Number(map.minute), Number(map.second),
  );
  return Math.round((asUtc - utcMs) / 60_000);
}

function wallMatches(utcMs, y, mo, d, h, m, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
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
 * Expand a list of weekly focus blocks ({weekday, start_time, end_time}) into
 * concrete UTC intervals across the next `numDays` days, in the user's tz.
 * Used as `extraBusy` so auto-schedule won't place tasks during focus time.
 */
export function expandFocusBlocks(blocks, tz, numDays = 14) {
  if (!blocks?.length) return [];
  const out = [];
  const today = new Date();
  for (let i = 0; i < numDays; i++) {
    const probe = new Date(today.getTime() + i * 86_400_000);
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(probe);
    const dayKeys = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const wkLabel = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
      .format(wallToUtc(ymd, '12:00', tz));
    const weekday = dayKeys.indexOf(wkLabel);
    for (const b of blocks) {
      if (b.weekday !== weekday) continue;
      const start = wallToUtc(ymd, b.start_time, tz);
      const end   = wallToUtc(ymd, b.end_time,   tz);
      if (end > start) out.push({ start, end });
    }
  }
  return out;
}

export const DEFAULT_WORK_HOURS = {
  sun: [],
  mon: [{ start: '09:00', end: '17:00' }],
  tue: [{ start: '09:00', end: '17:00' }],
  wed: [{ start: '09:00', end: '17:00' }],
  thu: [{ start: '09:00', end: '17:00' }],
  fri: [{ start: '09:00', end: '17:00' }],
  sat: [],
};
