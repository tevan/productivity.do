/**
 * Cross-pillar timeline — pure transform from raw DB rows into a uniform
 * timeline-row shape.
 *
 * The timeline is a superset of the revisions activity feed:
 *
 *   Source           kind                    Coverage
 *   ─────────────    ─────────────────────   ─────────────────────────────
 *   revisions        note_change, task_change   notes + tasks edits
 *   events_cache     event_scheduled         Calendar events (past + future)
 *   files            file_added              File uploads
 *   bookings         booking_created         Booking page reservations
 *   task_pins        task_pinned             Pin/unpin events (future)
 *
 * This module is pure: no DB, no fetch, no Date.now(). Caller passes raw
 * rows + `kind`, gets the uniform shape back. Easy to test and easy to
 * extend with new sources without touching the route handler.
 */

// ---------------------------------------------------------------------------
// Public types of timeline rows. Snake_case keys are stable identifiers —
// the UI can branch on `kind` to pick an icon, route a click, or filter.
// ---------------------------------------------------------------------------
export const TIMELINE_KINDS = Object.freeze({
  NOTE_CHANGE: 'note_change',
  TASK_CHANGE: 'task_change',
  EVENT: 'event',
  FILE: 'file',
  BOOKING: 'booking',
});

// All known kinds — useful for client filters + spec.
export const ALL_KINDS = Object.freeze(Object.values(TIMELINE_KINDS));

/**
 * @typedef TimelineRow
 * @property {string} id          - opaque, unique within (kind, source row)
 * @property {string} kind        - one of TIMELINE_KINDS values
 * @property {string} timestamp   - ISO-8601; the moment the event occurred/will occur
 * @property {string} label       - one-line title (truncated upstream if needed)
 * @property {string} sublabel    - context (project name, calendar name, etc); may be ''
 * @property {string} url         - SPA-routable URL or null
 * @property {string} icon        - emoji or short identifier the UI maps to a glyph
 * @property {string} op          - 'create' | 'update' | 'delete' | 'restore' | etc
 * @property {boolean} future     - true if `timestamp` is in the future (events only)
 * @property {object} meta        - kind-specific extras (resource_id, etc)
 */

// ---------------------------------------------------------------------------
// Per-source builders. Each returns a TimelineRow or null (skip).
// `nowMs` is passed in so the `future` flag is computed deterministically.
// ---------------------------------------------------------------------------

function fromRevision(row, nowMs) {
  if (!row) return null;
  // resource ∈ 'notes' | 'tasks' | (future) 'events'
  const kind = row.resource === 'notes' ? TIMELINE_KINDS.NOTE_CHANGE
             : row.resource === 'tasks' ? TIMELINE_KINDS.TASK_CHANGE
             : null;
  if (!kind) return null;

  const label = extractLabelFromRevision(row);
  const op = String(row.op || 'update');
  const ts = isoFromSqliteUtc(row.created_at);
  const tsMs = ts ? Date.parse(ts) : null;

  return {
    id: `rev-${row.id}`,
    kind,
    timestamp: ts || row.created_at,
    label: label || (kind === TIMELINE_KINDS.NOTE_CHANGE ? '(untitled note)' : '(task)'),
    sublabel: opSublabel(op),
    url: kind === TIMELINE_KINDS.NOTE_CHANGE && row.resource_id
      ? `/notes/${row.resource_id}`
      : null,
    icon: kind === TIMELINE_KINDS.NOTE_CHANGE ? '📝' : '✓',
    op,
    future: tsMs != null && tsMs > nowMs,
    meta: {
      revisionId: row.id,
      resource: row.resource,
      resourceId: row.resource_id,
    },
  };
}

function fromEvent(row, nowMs) {
  if (!row) return null;
  const ts = isoFromSqliteUtc(row.start_time) || row.start_time;
  const tsMs = ts ? Date.parse(ts) : null;
  return {
    id: `evt-${row.google_event_id}`,
    kind: TIMELINE_KINDS.EVENT,
    timestamp: ts,
    label: row.summary || '(untitled event)',
    sublabel: row.calendar_id || '',
    url: null, // events open via the SPA calendar context, not URL
    icon: '📅',
    op: 'scheduled',
    future: tsMs != null && tsMs > nowMs,
    meta: {
      googleEventId: row.google_event_id,
      calendarId: row.calendar_id,
      endTime: row.end_time,
      allDay: !!row.all_day,
    },
  };
}

function fromFile(row, nowMs) {
  if (!row) return null;
  const ts = isoFromSqliteUtc(row.created_at) || row.created_at;
  const tsMs = ts ? Date.parse(ts) : null;
  return {
    id: `file-${row.id}`,
    kind: TIMELINE_KINDS.FILE,
    timestamp: ts,
    label: row.original_name || '(unnamed file)',
    sublabel: humanSize(row.size),
    url: `/api/files/${row.id}`,
    icon: row.mime?.startsWith('image/') ? '🖼' : '📎',
    op: 'added',
    future: false,
    meta: {
      fileId: row.id,
      mime: row.mime,
      size: row.size,
      hash: row.hash,
    },
  };
}

function fromBooking(row, nowMs) {
  if (!row) return null;
  // bookings table uses `start_iso`/`page_id` (not `start_time`/`booking_page_id`).
  const ts = isoFromSqliteUtc(row.created_at) || row.created_at;
  const startIso = row.start_iso || row.start_time || null;
  const startMs = startIso ? Date.parse(startIso) : null;
  return {
    id: `book-${row.id}`,
    kind: TIMELINE_KINDS.BOOKING,
    timestamp: ts,
    label: row.invitee_name
      ? `${row.invitee_name} booked you`
      : '(booking)',
    sublabel: startIso
      ? `for ${humanWhen(startIso, nowMs)}`
      : '',
    url: null,
    icon: '🤝',
    op: row.status === 'cancelled' ? 'cancelled' : 'created',
    future: startMs != null && startMs > nowMs,
    meta: {
      bookingId: row.id,
      pageId: row.page_id || row.booking_page_id,
      status: row.status,
      startTime: startIso,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

// SQLite's CURRENT_TIMESTAMP / datetime('now') stores `YYYY-MM-DD HH:MM:SS`
// without timezone. Treat it as UTC and convert to ISO-8601 with `T` + `Z`
// so the client's Date() parses unambiguously.
export function isoFromSqliteUtc(s) {
  if (!s || typeof s !== 'string') return null;
  // Already ISO-shaped → pass through.
  if (s.includes('T')) return s;
  // SQLite shape: 2026-05-02 18:30:45 → 2026-05-02T18:30:45Z
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    return `${s.replace(' ', 'T')}Z`;
  }
  return s;
}

export function extractLabelFromRevision(row) {
  if (!row) return '';
  // Prefer pre-extracted `label` (from recentActivity()) if present.
  if (row.label) return row.label;
  if (!row.after_json) return '';
  try {
    const a = JSON.parse(row.after_json);
    if (row.resource === 'notes')  return a.title || a.body?.slice(0, 60) || '';
    if (row.resource === 'tasks')  return a.content || '';
    if (row.resource === 'events') return a.summary || '';
  } catch {}
  return '';
}

function opSublabel(op) {
  return ({
    create: 'created',
    update: 'edited',
    delete: 'deleted',
    soft_delete: 'moved to trash',
    restore: 'restored',
    scheduled: 'scheduled',
    added: 'added',
    cancelled: 'cancelled',
  })[op] || op;
}

export function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function humanWhen(iso, nowMs) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return iso;
  const diff = ms - nowMs;
  const abs = Math.abs(diff);
  const future = diff > 0;
  if (abs < 60_000) return future ? 'in a moment' : 'just now';
  if (abs < 3_600_000) {
    const m = Math.round(abs / 60_000);
    return future ? `in ${m}m` : `${m}m ago`;
  }
  if (abs < 86_400_000) {
    const h = Math.round(abs / 3_600_000);
    return future ? `in ${h}h` : `${h}h ago`;
  }
  if (abs < 86_400_000 * 7) {
    const d = Math.round(abs / 86_400_000);
    return future ? `in ${d}d` : `${d}d ago`;
  }
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Public dispatch — single entry the route uses.
// ---------------------------------------------------------------------------
const BUILDERS = {
  revision: fromRevision,
  event: fromEvent,
  file: fromFile,
  booking: fromBooking,
};

/**
 * @param {string} sourceType - one of 'revision' | 'event' | 'file' | 'booking'
 * @param {object} row        - raw DB row
 * @param {number} nowMs      - current time in ms (passed for testability)
 * @returns {TimelineRow|null}
 */
export function buildTimelineRow(sourceType, row, nowMs) {
  const fn = BUILDERS[sourceType];
  if (!fn) return null;
  return fn(row, nowMs);
}

/**
 * Sort timeline rows by timestamp DESC (newest first).
 * Stable sort: ties broken by id so re-renders don't reshuffle.
 */
export function sortTimelineRows(rows) {
  return rows
    .filter(Boolean)
    .sort((a, b) => {
      const ad = Date.parse(a.timestamp);
      const bd = Date.parse(b.timestamp);
      const at = Number.isFinite(ad) ? ad : 0;
      const bt = Number.isFinite(bd) ? bd : 0;
      if (bt !== at) return bt - at;
      return String(b.id).localeCompare(String(a.id));
    });
}

/**
 * Group rows into buckets by day-in-tz. Returns an array preserving
 * timeline order (newest day first).
 *
 * @param {TimelineRow[]} rows
 * @param {string}        tz - IANA tz name; used for the day key
 * @returns {{day: string, items: TimelineRow[]}[]}
 */
export function groupByDay(rows, tz = 'UTC') {
  const out = [];
  let current = null;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  for (const r of rows) {
    const ms = Date.parse(r.timestamp);
    const key = Number.isFinite(ms) ? fmt.format(new Date(ms)) : '?';
    if (!current || current.day !== key) {
      current = { day: key, items: [] };
      out.push(current);
    }
    current.items.push(r);
  }
  return out;
}
