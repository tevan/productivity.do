/**
 * GET /api/timeline — cross-pillar chronological feed.
 *
 * Unified surface across:
 *   - revisions (note + task edits)
 *   - events_cache (calendar events, past + future)
 *   - files (uploads)
 *   - bookings (reservations through booking pages)
 *
 * Query params:
 *   from        ISO-8601 lower bound (default: 7 days ago)
 *   to          ISO-8601 upper bound (default: 14 days from now — events
 *               in the future are part of the timeline by design)
 *   types       comma-separated filter — any of:
 *               note_change,task_change,event,file,booking
 *               omitted = all
 *   limit       per-source cap (default 100, max 500)
 *
 * Response shape:
 *   { ok: true, items: TimelineRow[], groups: [{day, items[]}] }
 *
 * The route does the SQL fan-out per source (with user_id scoping in
 * each WHERE), normalizes via lib/timeline.js, sorts globally, and groups
 * by day-in-tz. Pure helper does the per-row transform; this file is
 * pure plumbing.
 */

import { Router } from 'express';
import { getDb } from '../db/init.js';
import {
  buildTimelineRow,
  sortTimelineRows,
  groupByDay,
  ALL_KINDS,
  TIMELINE_KINDS,
} from '../lib/timeline.js';

const router = Router();

const KIND_TO_SOURCE = Object.freeze({
  [TIMELINE_KINDS.NOTE_CHANGE]: 'revision',
  [TIMELINE_KINDS.TASK_CHANGE]: 'revision',
  [TIMELINE_KINDS.EVENT]:       'event',
  [TIMELINE_KINDS.FILE]:        'file',
  [TIMELINE_KINDS.BOOKING]:     'booking',
});

function isValidTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
}

function parseIsoOrDefault(value, fallbackMs) {
  if (typeof value !== 'string' || !value) return new Date(fallbackMs);
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : new Date(fallbackMs);
}

function parseTypes(raw) {
  if (!raw || typeof raw !== 'string') return new Set(ALL_KINDS);
  const requested = raw.split(',').map(s => s.trim()).filter(Boolean);
  const valid = new Set(ALL_KINDS);
  const out = new Set(requested.filter(t => valid.has(t)));
  return out.size === 0 ? new Set(ALL_KINDS) : out;
}

router.get('/api/timeline', (req, res) => {
  try {
    const userId = req.user.id;
    const db = getDb();

    const now = new Date();
    const nowMs = now.getTime();

    // Default window: last 7 days through next 14 days.
    const from = parseIsoOrDefault(req.query.from, nowMs - 7 * 86_400_000);
    const to   = parseIsoOrDefault(req.query.to,   nowMs + 14 * 86_400_000);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    // SQLite's revisions/files use `YYYY-MM-DD HH:MM:SS` (no tz). Comparing
    // against an ISO string with `Z` mostly works because the lexical sort
    // of `2026-05-02 14:00:00` vs `2026-05-02T14:00:00Z` is wrong — the
    // T is greater than space. Convert the bounds to the SQLite shape for
    // those columns.
    const fromSqlite = fromIso.replace('T', ' ').slice(0, 19);
    const toSqlite   = toIso.replace('T', ' ').slice(0, 19);

    const limit = Math.min(500, Math.max(10, Number(req.query.limit) || 100));
    const types = parseTypes(req.query.types);

    let timezone =
      (isValidTz(req.query.tz) && req.query.tz) ||
      null;
    if (!timezone) {
      try {
        const t = Intl.DateTimeFormat().resolvedOptions().timeZone;
        timezone = isValidTz(t) ? t : 'UTC';
      } catch { timezone = 'UTC'; }
    }

    const rows = [];

    // ---- Revisions (note_change + task_change) ----
    if (types.has(TIMELINE_KINDS.NOTE_CHANGE) || types.has(TIMELINE_KINDS.TASK_CHANGE)) {
      const resourceFilter = [];
      if (types.has(TIMELINE_KINDS.NOTE_CHANGE)) resourceFilter.push("'notes'");
      if (types.has(TIMELINE_KINDS.TASK_CHANGE)) resourceFilter.push("'tasks'");
      const rev = db.prepare(`
        SELECT id, resource, resource_id, op, after_json, created_at
          FROM revisions
         WHERE user_id = ?
           AND resource IN (${resourceFilter.join(',')})
           AND created_at BETWEEN ? AND ?
         ORDER BY created_at DESC
         LIMIT ?
      `).all(userId, fromSqlite, toSqlite, limit);
      for (const r of rev) {
        const row = buildTimelineRow('revision', r, nowMs);
        if (row) rows.push(row);
      }
    }

    // ---- Events (events_cache, scoped by user_id) ----
    if (types.has(TIMELINE_KINDS.EVENT)) {
      const evt = db.prepare(`
        SELECT google_event_id, calendar_id, summary, start_time, end_time,
               all_day, status
          FROM events_cache
         WHERE user_id = ?
           AND start_time BETWEEN ? AND ?
           AND (status IS NULL OR status != 'cancelled')
         ORDER BY start_time DESC
         LIMIT ?
      `).all(userId, fromIso, toIso, limit);
      for (const r of evt) {
        const row = buildTimelineRow('event', r, nowMs);
        if (row) rows.push(row);
      }
    }

    // ---- Files ----
    if (types.has(TIMELINE_KINDS.FILE)) {
      const f = db.prepare(`
        SELECT id, original_name, size, mime, hash, created_at
          FROM files
         WHERE user_id = ?
           AND created_at BETWEEN ? AND ?
         ORDER BY created_at DESC
         LIMIT ?
      `).all(userId, fromSqlite, toSqlite, limit);
      for (const r of f) {
        const row = buildTimelineRow('file', r, nowMs);
        if (row) rows.push(row);
      }
    }

    // ---- Bookings (joined through booking_pages.user_id) ----
    if (types.has(TIMELINE_KINDS.BOOKING)) {
      const b = db.prepare(`
        SELECT b.id, b.invitee_name, b.page_id, b.start_iso, b.status,
               b.created_at
          FROM bookings b
          JOIN booking_pages p ON p.id = b.page_id
         WHERE p.user_id = ?
           AND b.created_at BETWEEN ? AND ?
         ORDER BY b.created_at DESC
         LIMIT ?
      `).all(userId, fromSqlite, toSqlite, limit);
      for (const r of b) {
        const row = buildTimelineRow('booking', r, nowMs);
        if (row) rows.push(row);
      }
    }

    const sorted = sortTimelineRows(rows);
    const groups = groupByDay(sorted, timezone);

    res.json({
      ok: true,
      from: fromIso,
      to: toIso,
      timezone,
      types: [...types],
      counts: countByKind(sorted),
      items: sorted,
      groups,
    });
  } catch (err) {
    console.error('GET /api/timeline error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function countByKind(rows) {
  const out = {};
  for (const k of ALL_KINDS) out[k] = 0;
  for (const r of rows) {
    if (r?.kind && out[r.kind] != null) out[r.kind] += 1;
  }
  return out;
}

export default router;
