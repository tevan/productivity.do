/**
 * Recommendations route — the "what to do right now" surface.
 *
 * Endpoints:
 *   GET    /api/recommendations/now    — top 3 ranked recs with explanations
 *   GET    /api/task-pins              — list pinned task ids
 *   POST   /api/task-pins              — pin a task ({ taskId, expiresAt? })
 *   DELETE /api/task-pins/:taskId      — unpin
 *
 * The ranker math (`backend/lib/ranker.js#rankTasks`) is shared with
 * `/api/today`. The contract layer (`backend/lib/recommendations.js`)
 * adds the three-part explanation + per-task pin override on top.
 */

import { Router } from 'express';
import { getDb } from '../db/init.js';
import { rankTasks } from '../lib/ranker.js';
import { buildRecommendations } from '../lib/recommendations.js';
import { fetchBusyIntervals } from '../lib/booking.js';
import { expandFocusBlocks } from '../lib/autoSchedule.js';

const router = Router();

const DEFAULT_WORK_HOURS = {
  mon: [{ start: '09:00', end: '17:00' }],
  tue: [{ start: '09:00', end: '17:00' }],
  wed: [{ start: '09:00', end: '17:00' }],
  thu: [{ start: '09:00', end: '17:00' }],
  fri: [{ start: '09:00', end: '17:00' }],
  sat: [],
  sun: [],
};

function ymdInTz(d, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function weekdayInTz(ymd, tz) {
  const probe = new Date(`${ymd}T12:00:00Z`);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(probe);
  return ['sun','mon','tue','wed','thu','fri','sat'][
    { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[wd]
  ] || 'mon';
}

// Wall-clock (ymd + HH:MM) in tz → UTC Date. Probes ±12h to handle DST.
function wallToUtc(ymd, hhmm, tz) {
  const naive = new Date(`${ymd}T${hhmm}:00Z`);
  const candidates = [-12, 0, 12].map(h => new Date(naive.getTime() + h * 3600_000));
  let best = candidates[1], bestDiff = Infinity;
  for (const c of candidates) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(c).map(p => [p.type, p.value]));
    const rendered = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    const naiveStr = `${ymd}T${hhmm}`;
    const diff = rendered === naiveStr ? 0 : Math.abs(c.getTime() - naive.getTime());
    if (diff < bestDiff) { best = c; bestDiff = diff; }
  }
  return best;
}

function isValidTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// Subtract busy intervals from a [start, end] window. Returns minutes free.
function subtractBusy(start, end, busy) {
  if (start >= end) return 0;
  const intersecting = (busy || [])
    .filter(b => b.start < end && b.end > start)
    .map(b => ({
      start: new Date(Math.max(b.start.getTime(), start.getTime())),
      end: new Date(Math.min(b.end.getTime(), end.getTime())),
    }))
    .sort((a, b) => a.start - b.start);

  let free = (end.getTime() - start.getTime()) / 60000;
  let cursor = start;
  for (const b of intersecting) {
    if (b.start > cursor) {
      // gap before this busy chunk — already counted in `free`
    }
    const overlap = (Math.min(b.end.getTime(), end.getTime()) - Math.max(b.start.getTime(), cursor.getTime())) / 60000;
    if (overlap > 0) free -= overlap;
    if (b.end > cursor) cursor = b.end;
  }
  return Math.max(0, free);
}

// ---------------------------------------------------------------------------
// GET /api/recommendations/now
// ---------------------------------------------------------------------------
router.get('/api/recommendations/now', async (req, res) => {
  try {
    const userId = req.user.id;
    const db = getDb();

    // ---- Preferences ----
    const prefRows = db.prepare(
      'SELECT key, value FROM preferences WHERE user_id = ? AND key IN (?, ?)'
    ).all(userId, 'workHours', 'primaryTimezone');
    const prefs = {};
    for (const r of prefRows) {
      try { prefs[r.key] = JSON.parse(r.value); } catch { prefs[r.key] = r.value; }
    }
    const workHours = prefs.workHours || DEFAULT_WORK_HOURS;

    let timezone =
      (isValidTz(req.query.tz) && req.query.tz) ||
      (isValidTz(prefs.primaryTimezone) && prefs.primaryTimezone) ||
      null;
    if (!timezone) {
      try {
        const t = Intl.DateTimeFormat().resolvedOptions().timeZone;
        timezone = isValidTz(t) ? t : 'UTC';
      } catch { timezone = 'UTC'; }
    }

    const now = new Date();
    const ymd = ymdInTz(now, timezone);
    const dayKey = weekdayInTz(ymd, timezone);
    const windows = (workHours && workHours[dayKey]) || [];

    // ---- Working-hours flag (for the explanation) ----
    const withinHours = (() => {
      if (!windows.length) return false;
      for (const w of windows) {
        const ws = wallToUtc(ymd, w.start, timezone);
        const we = wallToUtc(ymd, w.end, timezone);
        if (now >= ws && now < we) return true;
      }
      return false;
    })();

    // ---- Busy intervals + focus blocks (for freeMinutes + insideFocusBlock) ----
    const busyCalIds = db.prepare(
      'SELECT id FROM calendars WHERE user_id = ? AND visible = 1'
    ).all(userId).map(r => r.id);

    const dayStartUtc = wallToUtc(ymd, '00:00', timezone);
    const dayEndUtc = wallToUtc(ymd, '23:59', timezone);

    let busy = [];
    if (busyCalIds.length) {
      try {
        busy = await fetchBusyIntervals(
          userId, busyCalIds, dayStartUtc.toISOString(), dayEndUtc.toISOString(),
        );
      } catch {
        busy = [];
      }
    }

    const focusRows = db.prepare(
      'SELECT weekday, start_time, end_time FROM focus_blocks WHERE user_id = ?'
    ).all(userId);
    const focusBlocks = expandFocusBlocks(focusRows, timezone, 1);

    const insideFocusBlock = focusBlocks.some(b => b.start <= now && now < b.end);

    // freeMinutes = remaining minutes in the work-hour windows from NOW forward
    let freeMinutes = 0;
    for (const w of windows) {
      const ws = wallToUtc(ymd, w.start, timezone);
      const we = wallToUtc(ymd, w.end, timezone);
      const effStart = new Date(Math.max(ws.getTime(), now.getTime()));
      if (effStart >= we) continue;
      freeMinutes += subtractBusy(effStart, we, [...busy, ...focusBlocks]);
    }
    freeMinutes = Math.max(0, Math.round(freeMinutes));

    // ---- Open tasks ----
    const taskRows = db.prepare(`
      SELECT todoist_id, content, due_date, due_datetime,
             priority, estimated_minutes, is_completed,
             created_at, updated_at, project_id, project_name
        FROM tasks_cache
       WHERE user_id = ? AND (is_completed = 0 OR is_completed IS NULL)
    `).all(userId);

    const openTasks = taskRows.map(r => ({
      id: r.todoist_id,
      content: r.content,
      dueDate: r.due_date,
      dueDatetime: r.due_datetime,
      priority: r.priority,
      estimatedMinutes: r.estimated_minutes,
      projectId: r.project_id,
      projectName: r.project_name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    // ---- Project metadata + momentum (shape the existing ranker expects) ----
    const projMetaRows = db.prepare(
      'SELECT project_id, due_date, intent_line, rhythm_json, pinned_at FROM project_meta WHERE user_id = ?'
    ).all(userId);
    const projectMeta = new Map(projMetaRows.map(r => [String(r.project_id), {
      dueDate: r.due_date,
      intentLine: r.intent_line,
      rhythm: r.rhythm_json ? safeParse(r.rhythm_json) : null,
      pinnedAt: r.pinned_at,
    }]));

    // Momentum is computed from completed-task recency; the ranker only
    // needs `momentum: 'moving'|'stalled'|null`. Cheap derivation:
    // any task in the project completed in the last 7 days = moving.
    const movingProjects = new Set(db.prepare(`
      SELECT DISTINCT project_id FROM tasks_cache
       WHERE user_id = ? AND is_completed = 1 AND project_id IS NOT NULL
         AND completed_at >= datetime('now', '-7 days')
    `).all(userId).map(r => r.project_id));
    const stalledProjects = new Set();
    const allProjectIds = new Set([...projectMeta.keys(),
                                   ...openTasks.map(t => t.projectId).filter(Boolean)]);
    for (const pid of allProjectIds) {
      if (!movingProjects.has(pid)) {
        // "Stalled" = had completions in the past, none recent. Skip the
        // expensive query for first launch — empty stalled set is fine.
      }
    }
    const momentum = new Map();
    for (const pid of movingProjects) momentum.set(pid, { momentum: 'moving' });
    for (const pid of stalledProjects) momentum.set(pid, { momentum: 'stalled' });

    // The existing ranker also wants a `projects` array with order +
    // is_favorite. For now we don't surface those signals here; pass [].
    // The contract is unaffected — those are minor weights in the composite.
    const ranked = rankTasks({
      tasks: openTasks,
      projectMeta,
      momentum,
      projects: [],
      freeMinutes,
      timezone,
      now,
      mode: 'default',
    });

    // ---- Pinned task ids ----
    const pinRows = db.prepare(`
      SELECT task_id FROM task_pins
       WHERE user_id = ?
         AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).all(userId);
    const pinnedTaskIds = new Set(pinRows.map(r => r.task_id));

    const recommendations = buildRecommendations({
      rankedTasks: ranked.tasks,
      pinnedTaskIds,
      context: { freeMinutes, insideFocusBlock, withinHours },
      now,
    });

    res.json({
      ok: true,
      now: now.toISOString(),
      timezone,
      freeMinutes,
      withinHours,
      insideFocusBlock,
      pinnedTaskIds: [...pinnedTaskIds],
      recommendations,
    });
  } catch (err) {
    console.error('GET /api/recommendations/now error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Task pin CRUD
// ---------------------------------------------------------------------------
router.get('/api/task-pins', (req, res) => {
  const rows = getDb().prepare(`
    SELECT task_id, pinned_at, expires_at FROM task_pins
     WHERE user_id = ?
       AND (expires_at IS NULL OR expires_at > datetime('now'))
     ORDER BY pinned_at DESC
  `).all(req.user.id);
  res.json({ ok: true, pins: rows.map(r => ({
    taskId: r.task_id,
    pinnedAt: r.pinned_at,
    expiresAt: r.expires_at,
  })) });
});

router.post('/api/task-pins', (req, res) => {
  const { taskId, expiresAt } = req.body || {};
  if (!taskId) return res.status(400).json({ ok: false, error: 'taskId required' });

  // Default expiry: end of TODAY UTC. A forgotten pin shouldn't permanently
  // distort tomorrow's recommendations.
  let expiry = expiresAt || null;
  if (!expiry) {
    const eod = new Date();
    eod.setUTCHours(23, 59, 59, 999);
    expiry = eod.toISOString().replace('T', ' ').slice(0, 19); // sqlite-friendly
  }

  getDb().prepare(`
    INSERT INTO task_pins (user_id, task_id, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, task_id) DO UPDATE
      SET pinned_at = datetime('now'), expires_at = excluded.expires_at
  `).run(req.user.id, String(taskId), expiry);

  res.json({ ok: true });
});

router.delete('/api/task-pins/:taskId', (req, res) => {
  getDb().prepare(
    'DELETE FROM task_pins WHERE user_id = ? AND task_id = ?'
  ).run(req.user.id, String(req.params.taskId));
  res.json({ ok: true });
});

export default router;
