import { Router } from 'express';
import { getDb, q } from '../db/init.js';
import {
  isConnected,
  listCalendars as gcalListCalendars,
  listEvents as gcalListEvents,
  listEventsIncremental,
  createEvent as gcalCreateEvent,
  updateEvent as gcalUpdateEvent,
  deleteEvent as gcalDeleteEvent,
  getEvent as gcalGetEvent,
  extractConferenceUrl,
} from '../lib/google.js';
import { generatePrep, inputHash, isConfigured as isPrepConfigured } from '../lib/prep.js';
import { createOperation, runOperation } from '../lib/operations.js';
import { findFreeSlots, expandFocusBlocks } from '../lib/autoSchedule.js';
import { recordRevision } from '../lib/revisions.js';
import {
  computeUntilForFollowing,
  applyUntilToRecurrenceLines,
  normalizeScope,
} from '../lib/recurrence.js';

const router = Router();

/**
 * Resolve the user's primary timezone (IANA), with fallbacks. Used to populate
 * Google Calendar's required `timeZone` field on event create/update when the
 * incoming `dateTime` strings don't carry an offset (e.g. `2026-05-02T14:00:00`
 * from the form). Without this, Google rejects with "Missing time zone
 * definition for start time" and the event silently fails to save.
 */
function isValidTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
}
function resolveUserTimezone(userId, override = null) {
  if (isValidTz(override)) return override;
  const row = q(`SELECT value FROM preferences WHERE user_id = ? AND key = ?`)
    .get(userId, 'primaryTimezone');
  if (row) {
    try {
      const parsed = JSON.parse(row.value);
      if (isValidTz(parsed)) return parsed;
    } catch {}
  }
  // Last-resort fallback to the user row, then UTC. The user's `users.timezone`
  // is the column populated at signup; preferences.primaryTimezone is the
  // user-editable override.
  const userRow = q('SELECT timezone FROM users WHERE id = ?').get(userId);
  if (userRow && isValidTz(userRow.timezone)) return userRow.timezone;
  return 'UTC';
}
/**
 * True when an ISO-ish datetime string already has a timezone offset
 * (so Google won't need a separate `timeZone` field). Matches `Z`, `+HH:MM`,
 * `-HH:MM`, `+HHMM`, `-HHMM` at the end.
 */
function hasOffset(s) {
  if (!s || typeof s !== 'string') return false;
  return /(Z|[+-]\d{2}:?\d{2})$/.test(s);
}

/**
 * Build the revision-projection of an event. The activity feed and version
 * history serialize this — keep it slim (just the user-visible fields, no
 * internal flags). `id` here is the event id (Google id or native id);
 * we store calendarId alongside so the activity feed can render a "View"
 * link without a second lookup.
 */
function eventProjection(ev, { calendarId } = {}) {
  if (!ev) return null;
  return {
    id: ev.id,
    calendarId: calendarId || ev.calendarId || null,
    summary: ev.summary || '',
    description: ev.description || null,
    location: ev.location || null,
    start: ev.start?.dateTime || ev.start?.date || ev.start || null,
    end: ev.end?.dateTime || ev.end?.date || ev.end || null,
    allDay: !!(ev.start?.date || ev.allDay),
  };
}

/**
 * Translate a friendly recurrence value into the Google Calendar `recurrence`
 * array (RFC 5545 lines). Inputs:
 *   - null/undefined/'none'      → no recurrence
 *   - 'daily'                    → every day
 *   - 'weekdays'                 → Mon-Fri
 *   - 'weekly'                   → every week, same weekday as start
 *   - 'monthly'                  → every month, same day-of-month
 *   - 'yearly'                   → every year, same date
 *   - { freq, interval?, count?, until?, byDay?, byMonthDay? }  custom shape
 *   - string starting with 'RRULE:' or 'EXRULE:' or 'RDATE:' or 'EXDATE:'  → passthrough
 *   - array of any of the above  → all included
 *
 * Returns string[] suitable to assign to event.recurrence.
 */
function expandRecurrence(input) {
  if (!input || input === 'none') return [];
  if (Array.isArray(input)) return input.flatMap(expandRecurrence);
  if (typeof input === 'string') {
    if (/^(RRULE|EXRULE|RDATE|EXDATE):/i.test(input)) return [input];
    const presets = {
      daily:    'RRULE:FREQ=DAILY',
      weekdays: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      weekly:   'RRULE:FREQ=WEEKLY',
      biweekly: 'RRULE:FREQ=WEEKLY;INTERVAL=2',
      monthly:  'RRULE:FREQ=MONTHLY',
      yearly:   'RRULE:FREQ=YEARLY',
    };
    return presets[input] ? [presets[input]] : [];
  }
  if (typeof input === 'object') {
    const parts = [];
    const freq = String(input.freq || '').toUpperCase();
    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return [];
    parts.push(`FREQ=${freq}`);
    if (Number.isFinite(Number(input.interval)) && Number(input.interval) > 1) {
      parts.push(`INTERVAL=${Number(input.interval)}`);
    }
    if (Number.isFinite(Number(input.count)) && Number(input.count) > 0) {
      parts.push(`COUNT=${Number(input.count)}`);
    }
    if (typeof input.until === 'string' && /^\d{4}-\d{2}-\d{2}/.test(input.until)) {
      // Convert YYYY-MM-DD to YYYYMMDDT235959Z (end-of-day, RFC 5545 UTC form).
      const d = input.until.slice(0, 10).replace(/-/g, '');
      parts.push(`UNTIL=${d}T235959Z`);
    }
    if (Array.isArray(input.byDay) && input.byDay.length) {
      const valid = input.byDay.filter(s => /^(MO|TU|WE|TH|FR|SA|SU)$/.test(s));
      if (valid.length) parts.push(`BYDAY=${valid.join(',')}`);
    }
    if (Number.isFinite(Number(input.byMonthDay))) {
      parts.push(`BYMONTHDAY=${Number(input.byMonthDay)}`);
    }
    return [`RRULE:${parts.join(';')}`];
  }
  return [];
}

// ---------------------------------------------------------------------------
// GET /api/calendars — list calendars (from Google, cached in SQLite)
// ---------------------------------------------------------------------------
router.get('/api/calendars', async (req, res) => {
  try {
    const userId = req.user.id;
    if (!isConnected(userId)) {
      return res.json({ ok: true, calendars: [] });
    }

    const calendars = await gcalListCalendars(userId);
    const db = getDb();

    const upsert = db.prepare(`
      INSERT INTO calendars (id, summary, color, primary_cal, visible, user_id, access_role, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        summary = excluded.summary,
        color = excluded.color,
        primary_cal = excluded.primary_cal,
        access_role = excluded.access_role,
        user_id = excluded.user_id,
        updated_at = datetime('now')
    `);

    const upsertMany = db.transaction((cals) => {
      for (const cal of cals) {
        upsert.run(cal.id, cal.summary, cal.backgroundColor || null, cal.primary ? 1 : 0, userId, cal.accessRole || null);
      }
    });
    upsertMany(calendars);

    // Return from DB (includes visibility state)
    const rows = q('SELECT * FROM calendars WHERE user_id = ? ORDER BY primary_cal DESC, summary').all(userId);
    res.json({ ok: true, calendars: rows });
  } catch (err) {
    console.error('GET /api/calendars error:', err.message);
    // Fall back to cached data
    try {
      const db = getDb();
      const rows = q('SELECT * FROM calendars WHERE user_id = ? ORDER BY primary_cal DESC, summary').all(req.user.id);
      res.json({ ok: true, calendars: rows, cached: true });
    } catch {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
});

// ---------------------------------------------------------------------------
// GET /api/events?start=ISO&end=ISO — fetch events for date range
// ---------------------------------------------------------------------------
// Pull events from non-Google sources (native + cached Microsoft/CalDAV
// rows) for the requested window. Same shape as Google events so the
// merge below is uniform.
function nonGoogleEvents(userId, start, end) {
  const out = [];
  // Native events (events_native).
  const native = q(`
    SELECT id, summary, description, location, start_at, end_at, all_day, color
    FROM events_native
    WHERE user_id = ? AND end_at >= ? AND start_at <= ?
  `).all(userId, start, end);
  for (const r of native) {
    out.push({
      id: r.id,
      calendarId: 'native',
      provider: 'native',
      summary: r.summary,
      description: r.description,
      location: r.location,
      start: r.start_at,
      end: r.end_at,
      allDay: !!r.all_day,
      color: r.color,
    });
  }
  // Cached events from non-Google providers (Microsoft, CalDAV).
  const cached = q(`
    SELECT provider, calendar_id, google_event_id, summary, description, location,
           start_time, end_time, all_day
    FROM events_cache
    WHERE user_id = ? AND provider != 'google_calendar'
      AND end_time >= ? AND start_time <= ?
  `).all(userId, start, end);
  for (const r of cached) {
    out.push({
      id: r.google_event_id,
      calendarId: r.calendar_id,
      provider: r.provider,
      summary: r.summary,
      description: r.description,
      location: r.location,
      start: r.start_time,
      end: r.end_time,
      allDay: !!r.all_day,
    });
  }
  return out;
}

router.get('/api/events', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ ok: false, error: 'start and end query params required' });
    }

    const userId = req.user.id;
    // Always include native + non-Google cached events, even if Google
    // isn't connected. This is the "use the app without third-parties" path.
    const baseExtras = nonGoogleEvents(userId, start, end);
    if (!isConnected(userId)) {
      return res.json({ ok: true, events: baseExtras });
    }

    const db = getDb();
    const visibleCalendars = q('SELECT id FROM calendars WHERE user_id = ? AND visible = 1').all(userId);

    if (visibleCalendars.length === 0) {
      return res.json({ ok: true, events: [] });
    }

    const allEvents = [];

    for (const cal of visibleCalendars) {
      try {
        const events = await gcalListEvents(userId, cal.id, start, end);
        for (const ev of events) {
          const conferenceUrl = extractConferenceUrl(
            (ev.description || '') + ' ' + (ev.location || '')
          ) || (ev.conferenceData?.entryPoints?.[0]?.uri || null);

          const isAllDay = !!ev.start?.date;

          // Cache in SQLite
          db.prepare(`
            INSERT INTO events_cache (google_event_id, calendar_id, summary, description, location,
              start_time, end_time, all_day, color_id, recurrence, conference_url, status, user_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(google_event_id) DO UPDATE SET
              calendar_id = excluded.calendar_id,
              summary = excluded.summary,
              description = excluded.description,
              location = excluded.location,
              start_time = excluded.start_time,
              end_time = excluded.end_time,
              all_day = excluded.all_day,
              color_id = excluded.color_id,
              recurrence = excluded.recurrence,
              conference_url = excluded.conference_url,
              status = excluded.status,
              user_id = excluded.user_id,
              updated_at = datetime('now')
          `).run(
            ev.id,
            cal.id,
            ev.summary || null,
            ev.description || null,
            ev.location || null,
            ev.start?.dateTime || ev.start?.date || '',
            ev.end?.dateTime || ev.end?.date || '',
            isAllDay ? 1 : 0,
            ev.colorId || null,
            ev.recurrence ? JSON.stringify(ev.recurrence) : null,
            conferenceUrl,
            ev.status || 'confirmed',
            userId
          );

          allEvents.push({
            id: ev.id,
            calendarId: cal.id,
            summary: ev.summary,
            description: ev.description,
            location: ev.location,
            start: ev.start?.dateTime || ev.start?.date,
            end: ev.end?.dateTime || ev.end?.date,
            allDay: isAllDay,
            colorId: ev.colorId,
            conferenceUrl,
            status: ev.status,
            attendees: (ev.attendees || []).map(a => ({
              email: a.email,
              displayName: a.displayName,
              responseStatus: a.responseStatus, // accepted | declined | tentative | needsAction
              organizer: !!a.organizer,
              self: !!a.self,
            })),
            attachments: (ev.attachments || []).map(a => ({
              fileUrl: a.fileUrl,
              title: a.title,
              mimeType: a.mimeType,
              iconLink: a.iconLink,
            })),
            eventType: ev.eventType, // 'default' | 'outOfOffice' | 'workingLocation' | 'focusTime'
            workingLocation: ev.workingLocationProperties || null,
            outOfOffice: ev.outOfOfficeProperties || null,
          });
        }
      } catch (calErr) {
        console.error(`Failed to fetch events for calendar ${cal.id}:`, calErr.message);
      }
    }

    // Filter out user-hidden events.
    const hiddenSet = new Set(
      getDb().prepare('SELECT calendar_id, event_id FROM hidden_events WHERE user_id = ?')
        .all(req.user.id)
        .map(r => `${r.calendar_id}:${r.event_id}`)
    );
    let filtered = allEvents.filter(e => !hiddenSet.has(`${e.calendarId}:${e.id}`));

    // Merge subscribed-calendar events (read-only ICS feeds).
    try {
      const subs = getDb().prepare(
        'SELECT id, name, color FROM subscribed_calendars WHERE user_id = ? AND visible = 1'
      ).all(req.user.id);
      if (subs.length) {
        const subIds = subs.map(s => s.id);
        const placeholders = subIds.map(() => '?').join(',');
        const subEvents = getDb().prepare(`
          SELECT * FROM subscribed_events
          WHERE subscription_id IN (${placeholders})
            AND start_time < ? AND (end_time IS NULL OR end_time > ?)
        `).all(...subIds, req.query.end, req.query.start);
        const subById = Object.fromEntries(subs.map(s => [s.id, s]));
        for (const se of subEvents) {
          const sub = subById[se.subscription_id];
          filtered.push({
            id: `sub-${se.id}`,
            calendarId: `sub-${se.subscription_id}`,
            calendarName: sub.name,
            summary: se.summary,
            description: se.description,
            location: se.location,
            start: se.start_time,
            end: se.end_time || se.start_time,
            allDay: !!se.all_day,
            readOnly: true,
            subscriptionColor: sub.color,
          });
        }
      }
    } catch (subErr) {
      console.warn('subscribed events merge failed:', subErr.message);
    }

    // Working-location dedup: if multiple workingLocation events share the
    // same visible label and overlap on a given day, keep the longest-spanning
    // one and drop the rest. Opt-out via prefs.showDuplicateWorkingLocations.
    let showDupWL = false;
    try {
      const row = db.prepare(
        'SELECT value FROM preferences WHERE user_id = ? AND key = ?'
      ).get(userId, 'showDuplicateWorkingLocations');
      if (row) {
        try { showDupWL = !!JSON.parse(row.value); } catch { showDupWL = false; }
      }
    } catch { /* table may be empty */ }

    if (!showDupWL) {
      // Build per-day clusters keyed by (label, day). Day = YYYY-MM-DD of start.
      // For each cluster, keep only the event whose [start,end) span (in days) is
      // longest; ties keep the earliest start.
      const wlBuckets = new Map();
      const wlDropIds = new Set();
      const dayMs = 86400000;
      const spanDays = (ev) => {
        if (!ev.start || !ev.end) return 1;
        if (ev.allDay) {
          const s = String(ev.start).slice(0, 10);
          const e = String(ev.end).slice(0, 10);
          const sd = new Date(s + 'T00:00:00Z').getTime();
          const ed = new Date(e + 'T00:00:00Z').getTime();
          return Math.max(1, Math.round((ed - sd) / dayMs));
        }
        return Math.max(1, (new Date(ev.end) - new Date(ev.start)) / dayMs);
      };
      for (const ev of filtered) {
        if (ev.eventType !== 'workingLocation') continue;
        const label = (ev.summary || '').trim().toLowerCase();
        if (!label) continue;
        const day = String(ev.start || '').slice(0, 10);
        const key = `${label}|${day}`;
        if (!wlBuckets.has(key)) wlBuckets.set(key, []);
        wlBuckets.get(key).push(ev);
      }
      for (const dupes of wlBuckets.values()) {
        if (dupes.length < 2) continue;
        let keeper = dupes[0];
        let keeperSpan = spanDays(keeper);
        for (let i = 1; i < dupes.length; i++) {
          const s = spanDays(dupes[i]);
          if (s > keeperSpan || (s === keeperSpan && String(dupes[i].start) < String(keeper.start))) {
            keeper = dupes[i];
            keeperSpan = s;
          }
        }
        for (const ev of dupes) {
          if (ev !== keeper) wlDropIds.add(`${ev.calendarId}:${ev.id}`);
        }
      }
      if (wlDropIds.size) {
        filtered = filtered.filter(ev => !wlDropIds.has(`${ev.calendarId}:${ev.id}`));
      }

      // Adjacent-run merge: same label working-location events on consecutive
      // calendar days collapse into a single multi-day chip. Uses Google's
      // exclusive-end convention — when ev1.end (YYYY-MM-DD) === ev2.start,
      // they're touching. The merged event gets the earliest id and the
      // latest exclusive end, plus mergedFromIds[] for traceability.
      const wlByLabel = new Map();
      for (const ev of filtered) {
        if (ev.eventType !== 'workingLocation') continue;
        if (!ev.allDay) continue; // working locations are virtually always all-day
        const label = (ev.summary || '').trim().toLowerCase();
        if (!label) continue;
        if (!wlByLabel.has(label)) wlByLabel.set(label, []);
        wlByLabel.get(label).push(ev);
      }
      const wlMergedDropIds = new Set();
      const wlMergedReplacements = new Map(); // ev.id -> updated event
      for (const group of wlByLabel.values()) {
        if (group.length < 2) continue;
        // Sort by start ascending.
        group.sort((a, b) => String(a.start).localeCompare(String(b.start)));
        let runStart = 0;
        while (runStart < group.length) {
          let runEnd = runStart;
          while (
            runEnd + 1 < group.length &&
            String(group[runEnd].end).slice(0, 10) === String(group[runEnd + 1].start).slice(0, 10)
          ) {
            runEnd++;
          }
          if (runEnd > runStart) {
            // Merge: keep earliest as canonical, extend end, drop the rest.
            const keeper = group[runStart];
            const merged = {
              ...keeper,
              end: group[runEnd].end,
              mergedFromIds: group.slice(runStart, runEnd + 1).map(g => g.id),
            };
            wlMergedReplacements.set(keeper.id, merged);
            for (let i = runStart + 1; i <= runEnd; i++) {
              wlMergedDropIds.add(`${group[i].calendarId}:${group[i].id}`);
            }
          }
          runStart = runEnd + 1;
        }
      }
      if (wlMergedDropIds.size || wlMergedReplacements.size) {
        filtered = filtered
          .filter(ev => !wlMergedDropIds.has(`${ev.calendarId}:${ev.id}`))
          .map(ev => wlMergedReplacements.get(ev.id) || ev);
      }
    }

    // Combine duplicate events (same summary + same start, across calendars).
    // Cluster, keep the first as canonical, attach `mergedFromCalendarIds`.
    const buckets = new Map();
    for (const ev of filtered) {
      if (ev.readOnly) continue;
      // For dedup, normalize the start so allDay events with mixed shapes
      // (date vs dateTime in different calendars) collapse together. Use
      // the first 10 chars (YYYY-MM-DD) for allDay, full ISO otherwise.
      const startKey = ev.allDay ? String(ev.start).slice(0, 10) : ev.start;
      const key = `${(ev.summary || '').trim().toLowerCase()}|${startKey}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(ev);
    }
    const merged = [];
    const seen = new Set();
    for (const ev of filtered) {
      if (ev.readOnly) { merged.push(ev); continue; }
      // For dedup, normalize the start so allDay events with mixed shapes
      // (date vs dateTime in different calendars) collapse together. Use
      // the first 10 chars (YYYY-MM-DD) for allDay, full ISO otherwise.
      const startKey = ev.allDay ? String(ev.start).slice(0, 10) : ev.start;
      const key = `${(ev.summary || '').trim().toLowerCase()}|${startKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const dupes = buckets.get(key);
      if (dupes.length > 1) {
        merged.push({ ...dupes[0], mergedFromCalendarIds: dupes.map(d => d.calendarId) });
      } else {
        merged.push(ev);
      }
    }

    // Append native + Microsoft + CalDAV events on top of the Google merge.
    // No dedup against Google — different sources for genuinely different
    // events; user can hide one calendar source if they get duplicates.
    res.json({ ok: true, events: [...merged, ...baseExtras] });
  } catch (err) {
    console.error('GET /api/events error:', err.message);
    // Fall back to cached events
    try {
      const db = getDb();
      const { start, end } = req.query;
      const rows = db.prepare(`
        SELECT * FROM events_cache
        WHERE user_id = ? AND start_time < ? AND end_time > ? AND status != 'cancelled'
        ORDER BY start_time
      `).all(req.user.id, end, start);
      res.json({
        ok: true,
        events: rows.map(r => ({
          id: r.google_event_id,
          calendarId: r.calendar_id,
          summary: r.summary,
          description: r.description,
          location: r.location,
          start: r.start_time,
          end: r.end_time,
          allDay: !!r.all_day,
          colorId: r.color_id,
          conferenceUrl: r.conference_url,
          status: r.status,
        })),
        cached: true,
      });
    } catch {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
});

// ---------------------------------------------------------------------------
// POST /api/events — create event
// ---------------------------------------------------------------------------
router.post('/api/events', async (req, res) => {
  try {
    const userId = req.user.id;
    if (!isConnected(userId)) {
      return res.status(400).json({ ok: false, error: 'Google Calendar not connected' });
    }

    const { calendarId, summary, start, end, location, description, colorId, allDay, recurrence } = req.body;
    if (!calendarId || !summary) {
      return res.status(400).json({ ok: false, error: 'calendarId and summary required' });
    }

    const eventBody = {
      summary,
      description: description || undefined,
      location: location || undefined,
      colorId: colorId || undefined,
    };

    if (allDay) {
      // Google all-day expects YYYY-MM-DD with EXCLUSIVE end. The form sends
      // inclusive end-date strings, so bump end by +1 day.
      const sd = String(start).slice(0, 10);
      const edInclusive = String(end || start).slice(0, 10);
      const [ey, em, edd] = edInclusive.split('-').map(Number);
      const endExclusive = new Date(ey, em - 1, edd + 1);
      const ed = `${endExclusive.getFullYear()}-${String(endExclusive.getMonth() + 1).padStart(2,'0')}-${String(endExclusive.getDate()).padStart(2,'0')}`;
      eventBody.start = { date: sd };
      eventBody.end = { date: ed };
    } else {
      // Google requires either a full offset on `dateTime` (e.g. `...-06:00`)
      // OR a separate `timeZone` field. The SPA sends naive local datetimes
      // (`YYYY-MM-DDTHH:MM:SS`), so we attach the user's primary timezone.
      // If the client did include an offset, keep it as-is.
      const tz = resolveUserTimezone(userId);
      const startBlock = { dateTime: start };
      const endBlock = { dateTime: end };
      if (!hasOffset(start)) startBlock.timeZone = tz;
      if (!hasOffset(end)) endBlock.timeZone = tz;
      eventBody.start = startBlock;
      eventBody.end = endBlock;
    }

    // Recurrence: accept either a preset string (daily|weekly|monthly|yearly|weekdays)
    // or a raw RRULE/EXRULE/RDATE/EXDATE list. Google expects an array of full
    // iCal lines (e.g. ['RRULE:FREQ=WEEKLY']).
    const rules = expandRecurrence(recurrence);
    if (rules.length) eventBody.recurrence = rules;

    const created = await gcalCreateEvent(userId, calendarId, eventBody);

    // Cache the new event
    const conferenceUrl = extractConferenceUrl(
      (created.description || '') + ' ' + (created.location || '')
    ) || (created.conferenceData?.entryPoints?.[0]?.uri || null);

    const db = getDb();
    db.prepare(`
      INSERT INTO events_cache (google_event_id, calendar_id, summary, description, location,
        start_time, end_time, all_day, color_id, conference_url, status, user_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(google_event_id) DO UPDATE SET
        summary = excluded.summary, description = excluded.description,
        location = excluded.location, start_time = excluded.start_time,
        end_time = excluded.end_time, all_day = excluded.all_day,
        color_id = excluded.color_id, conference_url = excluded.conference_url,
        status = excluded.status, user_id = excluded.user_id, updated_at = datetime('now')
    `).run(
      created.id, calendarId, created.summary, created.description || null,
      created.location || null,
      created.start?.dateTime || created.start?.date || '',
      created.end?.dateTime || created.end?.date || '',
      allDay ? 1 : 0, created.colorId || null, conferenceUrl, created.status || 'confirmed',
      userId
    );

    const eventOut = {
      id: created.id,
      calendarId,
      summary: created.summary,
      description: created.description,
      location: created.location,
      start: created.start?.dateTime || created.start?.date,
      end: created.end?.dateTime || created.end?.date,
      allDay: !!allDay,
      colorId: created.colorId,
      conferenceUrl,
      status: created.status,
    };
    // Record in the activity feed.
    try {
      recordRevision({
        userId, resource: 'events', resourceId: created.id,
        op: 'create', before: null, after: eventProjection(eventOut),
      });
    } catch (e) { console.warn('events recordRevision (create):', e.message); }

    res.json({ ok: true, event: eventOut });
  } catch (err) {
    console.error('POST /api/events error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/events/:calendarId/:eventId — update event
// ---------------------------------------------------------------------------
router.put('/api/events/:calendarId/:eventId', async (req, res) => {
  try {
    const userId = req.user.id;
    if (!isConnected(userId)) {
      return res.status(400).json({ ok: false, error: 'Google Calendar not connected' });
    }

    const { calendarId, eventId } = req.params;
    const { summary, start, end, location, description, colorId, allDay, recurrence, scope } = req.body;

    const eventBody = {};
    if (summary !== undefined) eventBody.summary = summary;
    if (description !== undefined) eventBody.description = description;
    if (location !== undefined) eventBody.location = location;
    if (colorId !== undefined) eventBody.colorId = colorId;

    // For all-day events, Google expects YYYY-MM-DD with EXCLUSIVE end.
    // The form sends inclusive end-date strings, so bump end by +1 day.
    const toAllDayDate = (s) => String(s).slice(0, 10);
    const bumpEndExclusive = (s) => {
      const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
      const dt = new Date(y, m - 1, d + 1);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    };
    // Same timezone-attachment rule as POST: timed events need either an
    // offset on the dateTime string OR a separate `timeZone` field, or
    // Google rejects with "Missing time zone definition".
    const tz = (start !== undefined || end !== undefined) && !allDay
      ? resolveUserTimezone(userId)
      : null;
    if (start !== undefined) {
      if (allDay) {
        eventBody.start = { date: toAllDayDate(start) };
      } else {
        eventBody.start = hasOffset(start) ? { dateTime: start } : { dateTime: start, timeZone: tz };
      }
    }
    if (end !== undefined) {
      if (allDay) {
        eventBody.end = { date: bumpEndExclusive(end) };
      } else {
        eventBody.end = hasOffset(end) ? { dateTime: end } : { dateTime: end, timeZone: tz };
      }
    }

    // Recurrence handling. `scope` is one of:
    //   'instance'  — only this occurrence (default for instance ids; PATCH it directly)
    //   'series'    — apply to the entire series; we patch the parent recurringEventId
    //   'following' — split the series (UNTIL parent + new event from this point)
    // If no scope is sent, we treat single-event PATCHes as 'instance' (no-op
    // distinction) and leave recurrence unchanged unless explicitly provided.
    if (recurrence !== undefined && scope !== 'following') {
      const rules = expandRecurrence(recurrence);
      eventBody.recurrence = rules.length ? rules : null; // null clears recurrence
    }

    let targetEventId = eventId;
    if (scope === 'series') {
      // Find the parent series id from the event we were handed.
      try {
        const inst = await gcalGetEvent(userId, calendarId, eventId);
        if (inst?.recurringEventId) targetEventId = inst.recurringEventId;
      } catch {}
    }

    const updated = await gcalUpdateEvent(userId, calendarId, targetEventId, eventBody);

    if (scope === 'following') {
      // "Edit this and following" — terminate the parent series at the
      // instance start, then create a fresh series from this instance.
      try {
        const inst = await gcalGetEvent(userId, calendarId, eventId);
        const parentId = inst?.recurringEventId;
        if (parentId) {
          const instStart = inst.originalStartTime?.dateTime || inst.originalStartTime?.date;
          const untilDt = computeUntilForFollowing(instStart);
          if (untilDt) {
            const parent = await gcalGetEvent(userId, calendarId, parentId);
            const parentRules = applyUntilToRecurrenceLines(parent?.recurrence || [], untilDt);
            await gcalUpdateEvent(userId, calendarId, parentId, { recurrence: parentRules });
            // Create a brand-new event from this point with the new recurrence.
            const newRules = expandRecurrence(recurrence);
            const newBody = {
              summary: eventBody.summary ?? inst.summary,
              description: eventBody.description ?? inst.description,
              location: eventBody.location ?? inst.location,
              colorId: eventBody.colorId ?? inst.colorId,
              start: eventBody.start ?? inst.start,
              end: eventBody.end ?? inst.end,
              recurrence: newRules.length ? newRules : undefined,
            };
            await gcalCreateEvent(userId, calendarId, newBody);
          }
        }
      } catch (err) {
        console.warn('split-series failed:', err.message);
      }
    }

    // Update cache
    const conferenceUrl = extractConferenceUrl(
      (updated.description || '') + ' ' + (updated.location || '')
    ) || (updated.conferenceData?.entryPoints?.[0]?.uri || null);

    const db = getDb();
    // Pull the pre-update snapshot before we overwrite. Used for the
    // revisions log so the activity feed can render a diff.
    const beforeRow = db.prepare(
      'SELECT * FROM events_cache WHERE google_event_id = ? AND user_id = ?'
    ).get(eventId, userId);
    const beforeProj = beforeRow ? {
      id: beforeRow.google_event_id,
      calendarId: beforeRow.calendar_id,
      summary: beforeRow.summary,
      description: beforeRow.description,
      location: beforeRow.location,
      start: beforeRow.start_time,
      end: beforeRow.end_time,
      allDay: !!beforeRow.all_day,
    } : null;

    db.prepare(`
      UPDATE events_cache SET
        summary = ?, description = ?, location = ?,
        start_time = ?, end_time = ?, all_day = ?,
        color_id = ?, conference_url = ?, status = ?,
        updated_at = datetime('now')
      WHERE google_event_id = ? AND user_id = ?
    `).run(
      updated.summary, updated.description || null, updated.location || null,
      updated.start?.dateTime || updated.start?.date || '',
      updated.end?.dateTime || updated.end?.date || '',
      (updated.start?.date && !updated.start?.dateTime) ? 1 : 0,
      updated.colorId || null, conferenceUrl, updated.status || 'confirmed',
      eventId, userId
    );

    const eventOut = {
      id: updated.id,
      calendarId,
      summary: updated.summary,
      description: updated.description,
      location: updated.location,
      start: updated.start?.dateTime || updated.start?.date,
      end: updated.end?.dateTime || updated.end?.date,
      allDay: !!(updated.start?.date && !updated.start?.dateTime),
      colorId: updated.colorId,
      conferenceUrl,
      status: updated.status,
    };
    try {
      recordRevision({
        userId, resource: 'events', resourceId: updated.id,
        op: 'update', before: beforeProj, after: eventProjection(eventOut),
      });
    } catch (e) { console.warn('events recordRevision (update):', e.message); }

    res.json({ ok: true, event: eventOut });
  } catch (err) {
    console.error('PUT /api/events error:', err.message, err.stack?.slice(0, 300));
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/events/:calendarId/:eventId — delete event
// ---------------------------------------------------------------------------
router.delete('/api/events/:calendarId/:eventId', async (req, res) => {
  try {
    const userId = req.user.id;
    if (!isConnected(userId)) {
      return res.status(400).json({ ok: false, error: 'Google Calendar not connected' });
    }

    const { calendarId, eventId } = req.params;
    const scope = normalizeScope(req.query.scope);
    const db = getDb();
    // Snapshot for the activity feed before we wipe the cache row.
    const beforeRow = db.prepare(
      'SELECT * FROM events_cache WHERE google_event_id = ? AND user_id = ?'
    ).get(eventId, userId);
    const beforeProj = beforeRow ? {
      id: beforeRow.google_event_id,
      calendarId: beforeRow.calendar_id,
      summary: beforeRow.summary,
      description: beforeRow.description,
      location: beforeRow.location,
      start: beforeRow.start_time,
      end: beforeRow.end_time,
      allDay: !!beforeRow.all_day,
    } : null;

    // Helper used by every scope branch: drop a row we know by id.
    // The cache is just that — a cache — so we don't try to find
    // "all cached instances" of a series here. The next /api/events
    // GET reconciles from Google as the source of truth.
    const dropCachedRow = (id) =>
      db.prepare(
        'DELETE FROM events_cache WHERE google_event_id = ? AND user_id = ?'
      ).run(id, userId);

    if (scope === 'series') {
      // Delete the entire parent series. Resolve the parent id from the
      // instance we were handed (or use the id directly if it's already
      // the parent — Google accepts deleting the parent for both).
      let parentId = eventId;
      try {
        const inst = await gcalGetEvent(userId, calendarId, eventId);
        if (inst?.recurringEventId) parentId = inst.recurringEventId;
      } catch {}
      await gcalDeleteEvent(userId, calendarId, parentId);
      dropCachedRow(parentId);
      if (parentId !== eventId) dropCachedRow(eventId);
    } else if (scope === 'following') {
      // Terminate the parent series at instance-1s, leaving past
      // instances intact. Mirrors the edit-following path.
      try {
        const inst = await gcalGetEvent(userId, calendarId, eventId);
        const parentId = inst?.recurringEventId;
        const instStart = inst?.originalStartTime?.dateTime
          || inst?.originalStartTime?.date
          || inst?.start?.dateTime
          || inst?.start?.date;
        const untilDt = computeUntilForFollowing(instStart);
        if (parentId && untilDt) {
          const parent = await gcalGetEvent(userId, calendarId, parentId);
          const parentRules = applyUntilToRecurrenceLines(parent?.recurrence || [], untilDt);
          await gcalUpdateEvent(userId, calendarId, parentId, { recurrence: parentRules });
          dropCachedRow(eventId);
        } else {
          // No parent or no instance start — fall back to instance delete.
          await gcalDeleteEvent(userId, calendarId, eventId);
          dropCachedRow(eventId);
        }
      } catch (err) {
        console.warn('delete-following failed:', err.message);
        // Last-resort fallback: at minimum remove the instance the user
        // clicked on, so the click isn't a no-op.
        try {
          await gcalDeleteEvent(userId, calendarId, eventId);
          dropCachedRow(eventId);
        } catch {}
      }
    } else {
      // 'instance' — current behavior: delete just this occurrence.
      await gcalDeleteEvent(userId, calendarId, eventId);
      dropCachedRow(eventId);
    }

    try {
      // recordRevision currently accepts { before, after } only — scope is
      // logged via res.json so the caller knows what happened, and the
      // scope decision is captured implicitly by the diff (instance vs.
      // series id, or "following" which doesn't fully wipe the parent).
      recordRevision({
        userId, resource: 'events', resourceId: eventId,
        op: 'delete', before: beforeProj, after: null,
      });
    } catch (e) { console.warn('events recordRevision (delete):', e.message); }

    res.json({ ok: true, scope });
  } catch (err) {
    console.error('DELETE /api/events error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/events/sync — incremental sync using syncToken
// ---------------------------------------------------------------------------
router.get('/api/events/sync', async (req, res) => {
  try {
    const userId = req.user.id;
    if (!isConnected(userId)) {
      return res.json({ ok: true, updated: 0 });
    }

    const db = getDb();
    const visibleCalendars = q('SELECT id FROM calendars WHERE user_id = ? AND visible = 1').all(userId);
    let totalUpdated = 0;

    for (const cal of visibleCalendars) {
      const syncRow = q('SELECT sync_token FROM sync_state WHERE user_id = ? AND id = ?').get(userId, cal.id);

      if (!syncRow?.sync_token) {
        // No sync token — skip incremental, client should do full fetch via /api/events
        continue;
      }

      const result = await listEventsIncremental(userId, cal.id, syncRow.sync_token);

      if (result === null) {
        // 410 Gone — clear sync token so next full fetch gets a new one
        db.prepare('DELETE FROM sync_state WHERE user_id = ? AND id = ?').run(userId, cal.id);
        continue;
      }

      for (const ev of result.events) {
        if (ev.status === 'cancelled') {
          db.prepare('DELETE FROM events_cache WHERE google_event_id = ? AND user_id = ?').run(ev.id, userId);
        } else {
          const conferenceUrl = extractConferenceUrl(
            (ev.description || '') + ' ' + (ev.location || '')
          ) || (ev.conferenceData?.entryPoints?.[0]?.uri || null);
          const isAllDay = !!ev.start?.date;

          db.prepare(`
            INSERT INTO events_cache (google_event_id, calendar_id, summary, description, location,
              start_time, end_time, all_day, color_id, recurrence, conference_url, status, user_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(google_event_id) DO UPDATE SET
              calendar_id = excluded.calendar_id, summary = excluded.summary,
              description = excluded.description, location = excluded.location,
              start_time = excluded.start_time, end_time = excluded.end_time,
              all_day = excluded.all_day, color_id = excluded.color_id,
              recurrence = excluded.recurrence, conference_url = excluded.conference_url,
              status = excluded.status, user_id = excluded.user_id, updated_at = datetime('now')
          `).run(
            ev.id, cal.id, ev.summary || null, ev.description || null,
            ev.location || null,
            ev.start?.dateTime || ev.start?.date || '',
            ev.end?.dateTime || ev.end?.date || '',
            isAllDay ? 1 : 0, ev.colorId || null,
            ev.recurrence ? JSON.stringify(ev.recurrence) : null,
            conferenceUrl, ev.status || 'confirmed', userId
          );
        }
        totalUpdated++;
      }

      if (result.nextSyncToken) {
        db.prepare(`
          INSERT INTO sync_state (user_id, id, sync_token, last_sync)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(user_id, id) DO UPDATE SET
            sync_token = excluded.sync_token,
            last_sync = datetime('now')
        `).run(userId, cal.id, result.nextSyncToken);
      }
    }

    res.json({ ok: true, updated: totalUpdated });
  } catch (err) {
    console.error('GET /api/events/sync error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/weather?lat=X&lon=X — 7-day forecast from Open-Meteo
// ---------------------------------------------------------------------------
router.get('/api/weather', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ ok: false, error: 'lat and lon query params required' });
    }

    const db = getDb();
    const cached = q('SELECT * FROM weather_cache WHERE id = 1').get();

    // Check if cache is fresh (< 1 hour) and same location
    if (cached) {
      const age = Date.now() - new Date(cached.fetched_at + 'Z').getTime();
      const sameLocation = Math.abs(cached.location_lat - parseFloat(lat)) < 0.01
        && Math.abs(cached.location_lon - parseFloat(lon)) < 0.01;

      if (age < 3600000 && sameLocation) {
        const parsed = JSON.parse(cached.data);
        // New shape: { forecast, current }. Old shape: bare array.
        if (Array.isArray(parsed)) {
          return res.json({ ok: true, forecast: parsed, current: null });
        }
        return res.json({ ok: true, forecast: parsed.forecast || [], current: parsed.current || null });
      }
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weathercode&current_weather=true&timezone=auto&forecast_days=7`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo API ${response.status}`);
    }

    const data = await response.json();
    const forecast = data.daily.time.map((date, i) => ({
      date,
      tempMax: data.daily.temperature_2m_max[i],
      tempMin: data.daily.temperature_2m_min[i],
      weatherCode: data.daily.weathercode[i],
    }));
    const current = data.current_weather ? {
      temperature: data.current_weather.temperature,
      weatherCode: data.current_weather.weathercode,
    } : null;

    const payload = JSON.stringify({ forecast, current });
    db.prepare(`
      INSERT INTO weather_cache (id, data, location_lat, location_lon, fetched_at)
      VALUES (1, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        data = excluded.data,
        location_lat = excluded.location_lat,
        location_lon = excluded.location_lon,
        fetched_at = datetime('now')
    `).run(payload, parseFloat(lat), parseFloat(lon));

    res.json({ ok: true, forecast, current });
  } catch (err) {
    console.error('GET /api/weather error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/weather/narrative?lat=X&lon=X — short day-by-day phrases like
// "Mostly clear, warm afternoon" from Tomorrow.io. Cached server-side for 1h
// so we stay well within the 500-call/day free tier even with active hover.
// Falls back to a code-derived phrase if WEATHER_API_KEY isn't configured.
// ---------------------------------------------------------------------------
const TOMORROW_CACHE = new Map(); // `${lat}|${lon}` → { fetchedAt, days: [...] }
const TOMORROW_CACHE_MS = 60 * 60 * 1000; // 1h

// Tomorrow.io weatherCode reference: https://docs.tomorrow.io/reference/data-layers-weather-codes
function codeToPhrase(code) {
  const m = {
    0: 'Unknown', 1000: 'Clear', 1100: 'Mostly clear', 1101: 'Partly cloudy',
    1102: 'Mostly cloudy', 1001: 'Cloudy', 2000: 'Fog', 2100: 'Light fog',
    4000: 'Drizzle', 4001: 'Rain', 4200: 'Light rain', 4201: 'Heavy rain',
    5000: 'Snow', 5001: 'Flurries', 5100: 'Light snow', 5101: 'Heavy snow',
    6000: 'Freezing drizzle', 6001: 'Freezing rain',
    6200: 'Light freezing rain', 6201: 'Heavy freezing rain',
    7000: 'Ice pellets', 7101: 'Heavy ice pellets', 7102: 'Light ice pellets',
    8000: 'Thunderstorm',
  };
  return m[code] || 'Unknown';
}

// Compose a richer human-friendly sentence from the daily values. Targets
// 10–18 words — long enough to feel descriptive, short enough to fit
// comfortably in a tooltip's sub line.
//
// Order of facts: condition phrase → precipitation likelihood (when
// notable) → wind (when notable) → humidity (only when extreme). High/low
// temps live separately on the tooltip title so we don't repeat them here.
function buildNarrative(d) {
  const v = d.values || {};
  const code = v.weatherCodeMax || v.weatherCodeAvg || 0;
  const phrase = codeToPhrase(code);
  const high = Math.round(v.temperatureMax);
  const low = Math.round(v.temperatureMin);
  const precip = Math.round(v.precipitationProbabilityAvg ?? v.precipitationProbabilityMax ?? 0);
  const precipMm = v.precipitationIntensityAvg || 0;
  const wind = Math.round(v.windSpeedMax || 0);
  const humidity = Math.round(v.humidityAvg || 0);
  const cloud = Math.round(v.cloudCoverAvg || 0);

  const sentence = [];
  // Lead with the conditions phrase.
  sentence.push(phrase);

  // Precipitation: lead with likelihood, qualify with intensity if heavy.
  if (precip >= 70) {
    sentence.push(`with ${precip}% chance of ${codeIsSnow(code) ? 'snow' : 'rain'}`);
  } else if (precip >= 40) {
    sentence.push(`with a ${precip}% chance of ${codeIsSnow(code) ? 'snow' : 'rain'}`);
  } else if (precip >= 20) {
    sentence.push(`with a small chance of ${codeIsSnow(code) ? 'snow' : 'showers'}`);
  } else if (cloud >= 80 && phrase === 'Clear') {
    // Belt-and-suspenders: occasionally Tomorrow.io's max code lags the cloud
    // cover; if the day is overcast despite the "Clear" label, be honest.
    sentence.push('overcast at times');
  }

  // Wind: only when notable. Tomorrow.io reports m/s; convert to mph for
  // the english phrasing (the user's tempUnit pref is for chips, not prose).
  const windMph = Math.round(wind * 2.237);
  if (windMph >= 25) sentence.push(`with strong wind (${windMph} mph)`);
  else if (windMph >= 15) sentence.push(`breezy (${windMph} mph)`);

  // Humidity edges only — too dry or muggy.
  if (humidity >= 85 && phrase !== 'Fog' && phrase !== 'Light fog') sentence.push('humid');
  else if (humidity > 0 && humidity <= 25) sentence.push('very dry');

  // Join with spaces; the leading phrase is capitalized, the rest are
  // lowercase fragments meant to flow.
  const phraseStr = sentence.shift();
  const rest = sentence.join(', ');
  const text = rest ? `${phraseStr} ${rest}.` : `${phraseStr}.`;

  return { phrase: text, high, low, precip, wind, humidity, code };
}

function codeIsSnow(code) {
  // Tomorrow.io snow / freezing-precip codes (5xxx, 6xxx, 7xxx).
  return (code >= 5000 && code < 8000);
}

router.get('/api/weather/narrative', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ ok: false, error: 'lat and lon query params required' });
    }
    const key = `${parseFloat(lat).toFixed(2)}|${parseFloat(lon).toFixed(2)}`;
    const cached = TOMORROW_CACHE.get(key);
    if (cached && (Date.now() - cached.fetchedAt) < TOMORROW_CACHE_MS) {
      return res.json({ ok: true, days: cached.days, locationName: cached.locationName, source: 'cache' });
    }

    const apiKey = process.env.WEATHER_API_KEY;
    if (!apiKey || process.env.WEATHER_NARRATIVE_PROVIDER === 'none') {
      return res.json({ ok: true, days: [], source: 'disabled' });
    }

    const url = `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}&timesteps=1d&units=metric&apikey=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Tomorrow.io ${r.status}: ${text.slice(0, 200)}`);
    }
    const data = await r.json();
    const days = (data.timelines?.daily || []).map(d => ({
      date: d.time?.slice(0, 10),
      ...buildNarrative(d),
    }));
    // Tomorrow.io's response includes a friendly location name we can use
    // in the tooltip header ("Weather for Salt Lake City"). Falls back to
    // the lat/lon string when the API doesn't resolve a name.
    const locationName = data.location?.name
      || `${parseFloat(lat).toFixed(2)},${parseFloat(lon).toFixed(2)}`;
    TOMORROW_CACHE.set(key, { fetchedAt: Date.now(), days, locationName });
    res.json({ ok: true, days, locationName, source: 'live' });
  } catch (err) {
    console.error('GET /api/weather/narrative error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/weather/geocode?q=<city> — Open-Meteo geocoding (no key required)
// ---------------------------------------------------------------------------
router.get('/api/weather/geocode', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ ok: true, results: [] });

    // Postal-code path: zippopotam.us covers US, CA, GB, DE, FR, AU, BR, etc.
    // Optional country prefix: "US 90210", "GB SW1A", "CA M5V". Defaults to US
    // when the query is purely digits (most common: 5-digit US ZIPs).
    const postalMatch = q.match(/^([A-Za-z]{2})\s+(.+)$/) || (/^\d{4,10}$/.test(q) ? [null, 'US', q] : null);
    if (postalMatch) {
      const country = postalMatch[1].toUpperCase();
      const code = postalMatch[2].trim();
      try {
        const r = await fetch(`https://api.zippopotam.us/${country}/${encodeURIComponent(code)}`);
        if (r.ok) {
          const data = await r.json();
          const results = (data.places || []).slice(0, 5).map(p => ({
            name: p['place name'],
            label: `${p['place name']}, ${p['state abbreviation'] || p.state || ''} ${data['post code']} · ${data.country}`.trim(),
            lat: parseFloat(p.latitude),
            lon: parseFloat(p.longitude),
            country: data['country abbreviation'],
          }));
          if (results.length) return res.json({ ok: true, results });
        }
      } catch {}
      // fall through to name search if postal lookup misses
    }

    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&format=json`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Geocoding ${r.status}`);
    const data = await r.json();
    const results = (data.results || []).map(p => ({
      name: p.name,
      label: [p.name, p.admin1, p.country].filter(Boolean).join(', '),
      lat: p.latitude,
      lon: p.longitude,
      country: p.country_code,
    }));
    res.json({ ok: true, results });
  } catch (err) {
    console.error('GET /api/weather/geocode error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/travel-time?origin=lat,lon&destination=address
// ---------------------------------------------------------------------------
router.get('/api/travel-time', async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.json({ ok: true, durationMinutes: null, durationText: null });
    }

    const { origin, destination } = req.query;
    if (!origin || !destination) {
      return res.status(400).json({ ok: false, error: 'origin and destination required' });
    }

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Google Maps API ${response.status}`);
    }

    const data = await response.json();
    if (data.status !== 'OK' || !data.routes?.length) {
      return res.json({ ok: true, durationMinutes: null, durationText: null });
    }

    const leg = data.routes[0].legs[0];
    res.json({
      ok: true,
      durationMinutes: Math.round(leg.duration.value / 60),
      durationText: leg.duration.text,
    });
  } catch (err) {
    console.error('GET /api/travel-time error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/events/search?q= — fuzzy search across cached events for the user
// ---------------------------------------------------------------------------
router.get('/api/events/search', (req, res) => {
  try {
    const userId = req.user.id;
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ ok: true, events: [] });
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const db = getDb();
    // Simple LIKE match on summary, description, location. Future: FTS5.
    const like = `%${q.replace(/[%_]/g, ch => '\\' + ch)}%`;
    // Sort by absolute distance from "now" so the closest match (past or
    // future) surfaces first. Earlier we biased toward future-first, but with
    // a small result limit that hid all past matches when many future ones
    // existed.
    const nowIso = new Date().toISOString();
    const rows = db.prepare(`
      SELECT *,
        ABS(strftime('%s', start_time) - strftime('%s', ?)) AS dist
      FROM events_cache
      WHERE user_id = ?
        AND (summary LIKE ? ESCAPE '\\'
             OR description LIKE ? ESCAPE '\\'
             OR location LIKE ? ESCAPE '\\')
      ORDER BY dist ASC
      LIMIT ?
    `).all(nowIso, userId, like, like, like, limit);
    res.json({
      ok: true,
      events: rows.map(r => ({
        id: r.google_event_id,
        calendarId: r.calendar_id,
        summary: r.summary,
        description: r.description,
        location: r.location,
        start: r.start_time,
        end: r.end_time,
        allDay: !!r.all_day,
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/events.csv?from=ISO&to=ISO — CSV export of cached events
// ---------------------------------------------------------------------------
router.get('/api/events.csv', (req, res) => {
  const userId = req.user.id;
  const from = req.query.from ? new Date(req.query.from).toISOString() : null;
  const to   = req.query.to   ? new Date(req.query.to).toISOString()   : null;
  const db = getDb();

  let sql = 'SELECT * FROM events_cache WHERE user_id = ?';
  const args = [userId];
  if (from) { sql += ' AND end_time >= ?';   args.push(from); }
  if (to)   { sql += ' AND start_time <= ?'; args.push(to); }
  sql += ' ORDER BY start_time';
  const rows = db.prepare(sql).all(...args);

  const headers = ['id','calendar_id','summary','description','location','start','end','all_day','status'];
  const out = [headers.join(',')];
  for (const r of rows) {
    out.push([
      r.google_event_id, r.calendar_id, r.summary || '', r.description || '',
      r.location || '', r.start_time, r.end_time,
      r.all_day ? '1' : '0', r.status || '',
    ].map(csvEsc).join(','));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="events.csv"`);
  res.send(out.join('\r\n') + '\r\n');
});

function csvEsc(v) {
  const s = v == null ? '' : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ---------------------------------------------------------------------------
// POST /api/events/:calId/:eventId/rsvp — update the user's responseStatus.
// Body: { response: 'accepted' | 'declined' | 'tentative' }
// Google requires sending the FULL attendees array on patch, with the user's
// entry updated. We pull the live event first, mutate the self entry, then
// patch back. Returns the updated attendees so the UI can re-render.
// ---------------------------------------------------------------------------
router.post('/api/events/:calId/:eventId/rsvp', async (req, res) => {
  try {
    const userId = req.user.id;
    const { calId, eventId } = req.params;
    const { response } = req.body || {};
    if (!['accepted', 'declined', 'tentative'].includes(response)) {
      return res.status(400).json({ ok: false, error: 'response must be accepted|declined|tentative' });
    }
    const live = await gcalGetEvent(userId, calId, eventId);
    const attendees = (live.attendees || []).map(a => ({ ...a }));
    const me = attendees.find(a => a.self);
    if (!me) {
      return res.status(400).json({ ok: false, error: 'You are not on the attendee list for this event.' });
    }
    me.responseStatus = response;
    const updated = await gcalUpdateEvent(userId, calId, eventId, { attendees });
    res.json({
      ok: true,
      attendees: (updated.attendees || []).map(a => ({
        email: a.email, displayName: a.displayName,
        responseStatus: a.responseStatus,
        organizer: !!a.organizer, self: !!a.self,
      })),
    });
  } catch (err) {
    console.error('POST /rsvp error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/events/:calId/:eventId/prep — generate (or return cached) AI prep.
// Body: { force?: boolean }
// Query: ?async=1 returns 202 + an Operation handle instead of blocking on
//   the Anthropic call. Caller polls GET /api/operations/:id (or :wait) to
//   collect the result. Geewax Ch 10. Default remains synchronous so
//   existing SPA callers keep working unchanged.
// ---------------------------------------------------------------------------
router.post('/api/events/:calId/:eventId/prep', async (req, res) => {
  try {
    const userId = req.user.id;
    const { calId, eventId } = req.params;
    const force = !!req.body?.force;
    const asyncMode = req.query.async === '1' || req.query.async === 'true';

    if (!isPrepConfigured()) {
      return res.status(503).json({ ok: false, error: 'AI prep not configured (set ANTHROPIC_API_KEY).' });
    }
    if (!isConnected(userId)) {
      return res.status(400).json({ ok: false, error: 'Google Calendar not connected' });
    }

    // Pull live event from Google so attendees + recent edits are current.
    // Done in the request thread (fast: ~200ms) before deciding async vs
    // sync — failures here should be visible to the caller, not buried in
    // an Operation row.
    let ev;
    try {
      ev = await gcalGetEvent(userId, calId, eventId);
    } catch (err) {
      return res.status(404).json({ ok: false, error: 'Event not found' });
    }

    const inputs = {
      summary: ev.summary || '',
      description: ev.description || '',
      startIso: ev.start?.dateTime || ev.start?.date || '',
      location: ev.location || '',
      attendees: (ev.attendees || []).map(a => ({ email: a.email, displayName: a.displayName })),
    };
    const hash = inputHash(inputs);

    const db = getDb();
    const cached = db.prepare(
      'SELECT prep_summary, prep_generated_at, prep_input_hash FROM events_cache WHERE google_event_id = ? AND user_id = ?'
    ).get(eventId, userId);
    // Cache hit: return synchronously even in async mode — there's nothing
    // to wait for. The caller can still treat the response uniformly by
    // checking for `summary` directly.
    if (!force && cached?.prep_summary && cached.prep_input_hash === hash) {
      return res.json({
        ok: true,
        cached: true,
        summary: cached.prep_summary,
        generatedAt: cached.prep_generated_at,
      });
    }

    // The Anthropic call is the slow part (5–15s). In async mode we return
    // the Operation handle and run generatePrep in the background.
    if (asyncMode) {
      const opId = createOperation({
        userId,
        kind: 'event.prep',
        metadata: { calId, eventId },
      });
      runOperation(opId, async () => {
        const summary = await generatePrep({ ...inputs, userId });
        const generatedAt = new Date().toISOString();
        db.prepare(`
          UPDATE events_cache
          SET prep_summary = ?, prep_generated_at = ?, prep_input_hash = ?
          WHERE google_event_id = ? AND user_id = ?
        `).run(summary, generatedAt, hash, eventId, userId);
        return { cached: false, summary, generatedAt };
      });
      return res.status(202).json({
        ok: true,
        operation: { id: opId, kind: 'event.prep', done: false },
        pollUrl: `/api/operations/${opId}`,
        waitUrl: `/api/operations/${opId}:wait`,
      });
    }

    // Sync path (default — preserves existing SPA behavior).
    let summary;
    try {
      summary = await generatePrep({ ...inputs, userId: req.user.id });
    } catch (err) {
      console.warn('prep generation failed:', err.message);
      return res.status(502).json({ ok: false, error: err.message });
    }

    const generatedAt = new Date().toISOString();
    db.prepare(`
      UPDATE events_cache
      SET prep_summary = ?, prep_generated_at = ?, prep_input_hash = ?
      WHERE google_event_id = ? AND user_id = ?
    `).run(summary, generatedAt, hash, eventId, userId);

    res.json({ ok: true, cached: false, summary, generatedAt });
  } catch (err) {
    console.error('POST /api/events/:id/prep error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/events/find-time — find N free slots across visible calendars.
// Body: { durationMin, bufferMin?, calendarIds?, notBefore?, notAfter?,
//         limit?, includeFocusBlocks? (default true), workHours? (override) }
// ---------------------------------------------------------------------------
router.post('/api/events/find-time', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      durationMin, bufferMin, calendarIds, notBefore, notAfter, limit,
      includeFocusBlocks = true, workHours: bodyWorkHours, timezone: bodyTz,
    } = req.body || {};

    const dur = Math.max(15, Math.min(8 * 60, Number(durationMin) || 30));
    const buf = Math.max(0, Math.min(60, Number(bufferMin) || 10));

    const db = getDb();
    let busyCalIds = Array.isArray(calendarIds) && calendarIds.length ? calendarIds : null;
    if (!busyCalIds) {
      busyCalIds = db.prepare(
        'SELECT id FROM calendars WHERE user_id = ? AND visible = 1'
      ).all(userId).map(r => r.id);
    }

    const prefRows = db.prepare(
      'SELECT key, value FROM preferences WHERE user_id = ? AND key IN (?, ?)'
    ).all(userId, 'workHours', 'primaryTimezone');
    const prefs = Object.fromEntries(prefRows.map(r => {
      try { return [r.key, JSON.parse(r.value)]; } catch { return [r.key, null]; }
    }));

    const isValidTz = (tz) => {
      if (!tz || typeof tz !== 'string') return false;
      try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
      catch { return false; }
    };
    let timezone =
      (isValidTz(bodyTz) && bodyTz) ||
      (isValidTz(prefs.primaryTimezone) && prefs.primaryTimezone) ||
      'UTC';

    const workHours = bodyWorkHours || prefs.workHours || {
      sun: [], mon: [{ start: '09:00', end: '17:00' }],
      tue: [{ start: '09:00', end: '17:00' }], wed: [{ start: '09:00', end: '17:00' }],
      thu: [{ start: '09:00', end: '17:00' }], fri: [{ start: '09:00', end: '17:00' }],
      sat: [],
    };

    let extraBusy = [];
    if (includeFocusBlocks) {
      const focusRows = db.prepare(
        'SELECT weekday, start_time, end_time FROM focus_blocks WHERE user_id = ?'
      ).all(userId);
      extraBusy = expandFocusBlocks(focusRows, timezone, 14);
    }

    const slots = await findFreeSlots({
      userId,
      calendarIds: busyCalIds,
      workHours, timezone,
      durationMin: dur, bufferMin: buf,
      notBefore: notBefore ? new Date(notBefore) : undefined,
      notAfter: notAfter ? new Date(notAfter) : undefined,
      limit: Math.min(20, Number(limit) || 8),
      extraBusy,
    });

    res.json({ ok: true, slots });
  } catch (err) {
    console.error('POST /api/events/find-time error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
