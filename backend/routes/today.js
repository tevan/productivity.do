import { Router } from 'express';
import { q } from '../db/init.js';
import { fetchBusyIntervals } from '../lib/booking.js';
import { expandFocusBlocks, DEFAULT_WORK_HOURS } from '../lib/autoSchedule.js';
import { projectLoad, getTaskRatio, getProjectRatios } from '../lib/estimation.js';
import { rankTasks } from '../lib/ranker.js';
import { getProjectMomentum } from '../lib/projects.js';
import * as todoist from '../lib/todoist.js';

const router = Router();

/**
 * GET /api/today — the synthesis layer's first surface.
 *
 * Returns the *honest shape* of the user's day. Not a list of tasks and
 * events; the synthesis is the comparison between what's committed and what
 * fits. Data is already in the user's DB — calendar, tasks_cache, focus_blocks,
 * preferences. The work here is the *framing*.
 *
 * Response shape:
 *   {
 *     ok: true,
 *     date: 'YYYY-MM-DD',          // user's local date
 *     timezone: 'America/Denver',
 *     freeMinutes: 210,            // free time inside work hours after now
 *     committedMinutes: 300,       // sum of estimated minutes for due-today + overdue
 *     committedTaskCount: 7,
 *     overdueCount: 3,
 *     dueTodayCount: 4,
 *     hero: {
 *       kind: 'overcommitted'|'fits'|'free'|'no_estimates'|'no_work_hours',
 *       sentence: 'You have 3.5 free hours today. Committed work needs 5 hours.'
 *     },
 *     tasks: [                     // slip-risk tasks, ranked
 *       { id, content, dueDate, priority, estimatedMinutes, slipRisk: 'overdue'|'due_today', ageDays }
 *     ]
 *   }
 *
 * Design notes:
 *  - Default estimate when none set: 30 minutes. Clamped to 15..120 so a single
 *    huge task can't dominate the bar. Matches autoSchedule.js fallback.
 *  - Free time is computed from NOW forward to end-of-work-hours-today, not
 *    full-day. The synthesis is about the rest of *today*, not retrospective.
 *  - We treat focus blocks as committed (they're the user's deep-work intent),
 *    not free. Same as auto-schedule.
 *  - The hero sentence is deterministic. Branching on simple thresholds keeps
 *    it debuggable and trustworthy. AI-driven phrasing comes later, if ever.
 */
router.get('/api/today', async (req, res) => {
  try {
    const userId = req.user.id;

    // ---- Preferences: workHours + timezone ----
    const prefRows = q(
      'SELECT key, value FROM preferences WHERE user_id = ? AND key IN (?, ?)'
    ).all(userId, 'workHours', 'primaryTimezone');
    const prefs = {};
    for (const r of prefRows) {
      try { prefs[r.key] = JSON.parse(r.value); } catch { prefs[r.key] = r.value; }
    }
    const workHours = prefs.workHours || DEFAULT_WORK_HOURS;

    const isValidTz = (tz) => {
      if (!tz || typeof tz !== 'string') return false;
      try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
      catch { return false; }
    };
    const bodyTz = req.query.tz;
    let timezone =
      (isValidTz(bodyTz) && bodyTz) ||
      (isValidTz(prefs.primaryTimezone) && prefs.primaryTimezone) ||
      null;
    if (!timezone) {
      try {
        const serverTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        timezone = isValidTz(serverTz) ? serverTz : 'UTC';
      } catch { timezone = 'UTC'; }
    }

    // ---- Today's wall-clock window in the user's tz ----
    const now = new Date();
    const ymd = ymdInTz(now, timezone);
    const dayKey = ['sun','mon','tue','wed','thu','fri','sat'][weekdayInTz(ymd, timezone)];
    const windows = (workHours && workHours[dayKey]) || [];

    // ---- Calendars to count as busy: visible ones ----
    const busyCalIds = q(
      'SELECT id FROM calendars WHERE user_id = ? AND visible = 1'
    ).all(userId).map(r => r.id);

    // Compute the today window in UTC for the busy fetch (start-of-day → end-of-day local).
    const dayStartUtc = wallToUtc(ymd, '00:00', timezone);
    const dayEndUtc   = wallToUtc(ymd, '23:59', timezone);

    let busy = [];
    if (busyCalIds.length) {
      try {
        busy = await fetchBusyIntervals(
          userId, busyCalIds,
          dayStartUtc.toISOString(), dayEndUtc.toISOString(),
        );
      } catch {
        // Calendar fetch failure shouldn't block the synthesis; we still have
        // task data and focus blocks. Synthesis just becomes less precise.
        busy = [];
      }
    }

    // Focus blocks count as committed (busy) too.
    const focusRows = q(
      'SELECT weekday, start_time, end_time FROM focus_blocks WHERE user_id = ?'
    ).all(userId);
    const focusBusy = expandFocusBlocks(focusRows, timezone, 1);
    busy = [...busy, ...focusBusy];

    // ---- Free minutes today, from NOW forward ----
    const cursor = now;
    let freeMinutes = 0;
    for (const w of windows) {
      const winStart = wallToUtc(ymd, w.start, timezone);
      const winEnd   = wallToUtc(ymd, w.end, timezone);
      const effStart = new Date(Math.max(winStart.getTime(), cursor.getTime()));
      if (effStart >= winEnd) continue;
      freeMinutes += subtractBusy(effStart, winEnd, busy);
    }
    freeMinutes = Math.max(0, Math.round(freeMinutes));

    // ---- Tasks: due today (in user tz) + overdue, not completed ----
    const cacheRows = q(`
      SELECT todoist_id, content, description, due_date, due_datetime,
             priority, estimated_minutes, is_completed, created_at, updated_at,
             project_name
        FROM tasks_cache
       WHERE user_id = ? AND (is_completed = 0 OR is_completed IS NULL)
    `).all(userId);

    const todayStartLocal = wallToUtc(ymd, '00:00', timezone).getTime();
    const todayEndLocal = wallToUtc(ymd, '23:59', timezone).getTime();

    const overdue = [];
    const dueToday = [];
    let estimatesPresent = 0;
    let estimatesTotal = 0;

    for (const r of cacheRows) {
      const dueMs = taskDueMs(r, timezone);
      if (dueMs == null) continue;
      const est = clampEstimate(r.estimated_minutes);
      estimatesTotal += 1;
      if (r.estimated_minutes && r.estimated_minutes > 0) estimatesPresent += 1;

      // Age uses created_at when known. Tasks created before this column
      // existed have created_at = NULL and report ageDays = null (unknown);
      // the UI hides the age in that case rather than lying. For overdue
      // tasks specifically, "how long since the due date" is the more
      // useful number anyway, so we compute that as a fallback.
      let ageDays = null;
      if (r.created_at) {
        ageDays = Math.max(0, Math.floor(
          (now.getTime() - new Date(r.created_at).getTime()) / 86_400_000
        ));
      } else if (dueMs != null && dueMs < todayStartLocal) {
        ageDays = Math.max(0, Math.floor(
          (todayStartLocal - dueMs) / 86_400_000
        ));
      }

      if (dueMs < todayStartLocal) {
        overdue.push({
          id: r.todoist_id,
          content: r.content,
          dueDate: r.due_date,
          dueDatetime: r.due_datetime,
          priority: r.priority,
          estimatedMinutes: est,
          projectName: r.project_name,
          slipRisk: 'overdue',
          ageDays,
        });
      } else if (dueMs <= todayEndLocal) {
        dueToday.push({
          id: r.todoist_id,
          content: r.content,
          dueDate: r.due_date,
          dueDatetime: r.due_datetime,
          priority: r.priority,
          estimatedMinutes: est,
          projectName: r.project_name,
          slipRisk: 'due_today',
          ageDays,
        });
      }
    }

    // Rank: overdue (oldest first) → due today (highest priority first, then due time)
    overdue.sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0));
    dueToday.sort((a, b) => {
      if (b.priority !== a.priority) return (b.priority || 0) - (a.priority || 0);
      if (a.dueDatetime && b.dueDatetime) return a.dueDatetime.localeCompare(b.dueDatetime);
      return 0;
    });
    const tasks = [...overdue, ...dueToday];

    const committedMinutes = tasks.reduce((s, t) => s + t.estimatedMinutes, 0);
    const committedTaskCount = tasks.length;

    // ---- Estimation Intelligence: realistic load ----
    // Multiply each task's estimate by the most-specific available historical
    // ratio (per-task → per-project → global). hasHistory is false until the
    // user has ≥3 completed tasks with both estimated_minutes and
    // actual_minutes — until then, this is a no-op echo of committedMinutes.
    const load = projectLoad(userId, tasks);

    // Per-task ratios (task-level → project-level fallback). We don't surface
    // the global ratio per-row — that's redundant noise; the global ratio
    // already shows up in the day-level capacity warning. Per-row badges are
    // for tasks where we have task or project history that diverges from 1.0.
    const projectRatios = getProjectRatios(userId);
    const taskRatios = {};
    for (const t of tasks) {
      const taskR = getTaskRatio(userId, t.content);
      const projR = t.projectName ? projectRatios.get(t.projectName) : null;
      const r = taskR || projR || null;
      if (r) {
        taskRatios[t.id] = {
          ratio: Number(r.ratio.toFixed(2)),
          samples: r.samples,
          source: taskR ? 'task' : 'project',
        };
      }
    }

    // ---- Decision ranker ----
    // Rank tasks (overdue + due-today) using the composite score over
    // priority, project favorite, project pin, project order, project
    // momentum, project rhythm, project deadline, due urgency, and
    // estimation-fit. Returns the same task list with a `score` and
    // `scoreReasons` per item so the UI can show "why is this first?".
    let projectMetaMap = new Map();
    try {
      const rows = q(`
        SELECT project_id, due_date, intent_line, rhythm_json, pinned_at
          FROM project_meta
         WHERE user_id = ?
      `).all(userId);
      for (const r of rows) {
        let rhythm = null;
        try { rhythm = r.rhythm_json ? JSON.parse(r.rhythm_json) : null; } catch {}
        projectMetaMap.set(r.project_id, {
          dueDate: r.due_date,
          intentLine: r.intent_line,
          rhythm,
          pinnedAt: r.pinned_at,
        });
      }
    } catch {}

    const momentumMap = getProjectMomentum(userId);

    let projectsList = [];
    try {
      projectsList = await todoist.listProjects(userId);
    } catch { /* fallback: empty — ranker still runs but loses favorite/order signal */ }

    const tasksForRank = tasks.map(t => ({
      id: t.id, content: t.content, projectId: null, // filled below
      dueDate: t.dueDate, dueDatetime: t.dueDatetime,
      priority: t.priority, estimatedMinutes: t.estimatedMinutes,
      slipRisk: t.slipRisk,
    }));
    // Hydrate projectId by looking up the cache row again — the original
    // SELECT didn't include project_id. (Cheap; small set.)
    if (tasks.length) {
      const idList = tasks.map(t => t.id);
      const placeholders = idList.map(() => '?').join(',');
      const projRows = q(`
        SELECT todoist_id, project_id FROM tasks_cache
         WHERE user_id = ? AND todoist_id IN (${placeholders})
      `).all(userId, ...idList);
      const projById = new Map(projRows.map(r => [r.todoist_id, r.project_id]));
      for (const t of tasksForRank) t.projectId = projById.get(t.id) || null;
    }

    const ranked = rankTasks({
      tasks: tasksForRank,
      projectMeta: projectMetaMap,
      momentum: momentumMap,
      projects: projectsList,
      freeMinutes,
      timezone,
      now,
      mode: req.query.mode === 'pinned' ? 'pinned' : 'default',
    });

    // ---- The hero sentence ----
    const hero = composeHero({
      freeMinutes,
      committedMinutes,
      // When we have history, the hero reasons about realistic load.
      // When we don't, it falls back to committedMinutes (the estimate sum).
      realisticMinutes: load.hasHistory ? load.realistic : null,
      committedTaskCount,
      overdueCount: overdue.length,
      dueTodayCount: dueToday.length,
      hasWorkHours: windows.length > 0,
      estimatesPresent,
      estimatesTotal,
    });

    res.json({
      ok: true,
      date: ymd,
      timezone,
      freeMinutes,
      committedMinutes,
      committedTaskCount,
      overdueCount: overdue.length,
      dueTodayCount: dueToday.length,
      hero,
      tasks,
      // Estimation Intelligence payload — frontend renders the day-capacity
      // warning + per-task accuracy badges from this. ratio == 1 + samples == 0
      // means no history yet; UI hides the badge.
      load: {
        estimated: load.estimated,
        realistic: load.realistic,
        ratio: Number(load.ratio.toFixed(2)),
        samples: load.samples,
        hasHistory: load.hasHistory,
      },
      taskRatios,
      // Decision ranker output. `ranked` is the same task list re-sorted
      // by composite score, with `score` and `scoreReasons` per task. Mode
      // tells the UI whether pinned-mode is in effect; pinnedProjectIds
      // lets the UI surface a "showing only pinned" badge.
      ranked: ranked.tasks,
      rankerMode: ranked.mode,
      pinnedProjectIds: ranked.pinnedProjectIds,
    });
  } catch (err) {
    console.error('GET /api/today error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Helpers — kept local; nothing else needs them yet.
// ---------------------------------------------------------------------------

function clampEstimate(m) {
  const n = Number(m);
  if (!n || n <= 0) return 30;
  return Math.max(15, Math.min(120, Math.round(n)));
}

function ymdInTz(d, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d); // YYYY-MM-DD (en-CA)
}

function weekdayInTz(ymd, tz) {
  // Use noon to avoid DST edge surprises.
  const probe = new Date(`${ymd}T12:00:00Z`);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  const wd = fmt.format(probe);
  const map = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  return map[wd] ?? 0;
}

// wall-clock (ymd + HH:MM) in tz → UTC Date. Probes to handle DST.
function wallToUtc(ymd, hhmm, tz) {
  const naive = new Date(`${ymd}T${hhmm}:00Z`);
  // Find the instant whose tz-rendered wall clock matches naive.
  // Try -12h, naive, +12h offsets and pick the closest match.
  const candidates = [-12, 0, 12].map(h => new Date(naive.getTime() + h * 3600_000));
  let best = candidates[1], bestDiff = Infinity;
  for (const c of candidates) {
    const partsFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hour12: false,
    });
    const parts = Object.fromEntries(partsFmt.formatToParts(c).map(p => [p.type, p.value]));
    const target = `${ymd} ${hhmm}`;
    const got = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
    const diff = Math.abs(new Date(got).getTime() - new Date(target).getTime());
    if (diff < bestDiff) { bestDiff = diff; best = c; }
  }
  return best;
}

// Subtract busy intervals from [start, end), return free minutes.
function subtractBusy(start, end, busy) {
  let cursor = start.getTime();
  const endMs = end.getTime();
  let free = 0;
  // busy is unsorted; sort once for cleaner walk.
  const sorted = [...busy].sort((a, b) => new Date(a.start) - new Date(b.start));
  for (const b of sorted) {
    const bStart = new Date(b.start).getTime();
    const bEnd = new Date(b.end).getTime();
    if (bEnd <= cursor) continue;
    if (bStart >= endMs) break;
    if (bStart > cursor) free += (Math.min(bStart, endMs) - cursor) / 60_000;
    cursor = Math.max(cursor, bEnd);
    if (cursor >= endMs) break;
  }
  if (cursor < endMs) free += (endMs - cursor) / 60_000;
  return free;
}

function taskDueMs(row, tz) {
  if (row.due_datetime) {
    const t = new Date(row.due_datetime).getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (row.due_date) {
    // Treat YYYY-MM-DD as local-midnight in user's tz.
    const d = wallToUtc(row.due_date, '00:00', tz);
    return d.getTime();
  }
  return null;
}

function composeHero({
  freeMinutes, committedMinutes, realisticMinutes, committedTaskCount,
  overdueCount, dueTodayCount, hasWorkHours,
  estimatesPresent, estimatesTotal,
}) {
  const fmtH = (m) => {
    if (m < 60) return `${m} min`;
    const h = m / 60;
    if (Math.abs(h - Math.round(h)) < 0.05) return `${Math.round(h)} ${h === 1 ? 'hour' : 'hours'}`;
    return `${h.toFixed(1)} hours`;
  };

  // The hero reasons about REALISTIC load when we have user history; that's
  // the whole point of Estimation Intelligence. Without history we use the
  // user's own estimates verbatim. Either way, "load" is what we compare
  // to free time when deciding overcommitted vs fits.
  const load = (typeof realisticMinutes === 'number' && realisticMinutes > 0)
    ? realisticMinutes
    : committedMinutes;

  // Each branch returns at most one hero sentence and one support line.
  // The hero is the focal thought; the support is the prompt for action.
  // Frontend renders them in different weights / colors.

  if (!hasWorkHours) {
    return committedTaskCount
      ? {
          kind: 'no_work_hours',
          sentence: `${committedTaskCount} ${plural('task', committedTaskCount)} on your plate today.`,
          support: 'Set work hours in Settings to see what fits.',
        }
      : {
          kind: 'no_work_hours',
          sentence: 'A quiet day.',
          support: 'Set work hours in Settings to see capacity when it matters.',
        };
  }

  if (committedTaskCount === 0 && freeMinutes > 0) {
    return {
      kind: 'free',
      sentence: `${fmtH(freeMinutes)} free, nothing committed.`,
      support: 'Pick something to start, or close the laptop.',
    };
  }

  if (committedTaskCount === 0 && freeMinutes === 0) {
    return {
      kind: 'free',
      sentence: 'No tasks today. Day is fully booked.',
      support: 'Survive it.',
    };
  }

  // Lots of tasks, few estimates → the math is approximate. Only call this
  // out when the answer isn't already obvious.
  const obvious = freeMinutes <= 15 && load >= 30;
  if (!obvious && committedTaskCount >= 3 && estimatesPresent / Math.max(1, estimatesTotal) < 0.4) {
    return {
      kind: 'no_estimates',
      sentence: `${committedTaskCount} ${plural('task', committedTaskCount)} on your plate, ${fmtH(freeMinutes)} free.`,
      support: 'Set time estimates and the math gets sharper.',
    };
  }

  const diff = load - freeMinutes;
  // When realistic load > estimate, mention that the math reflects history.
  const realisticInflated = (typeof realisticMinutes === 'number') && (realisticMinutes > committedMinutes + 15);

  if (diff > 30) {
    const over = fmtH(diff);
    let overdueClause;
    if (overdueCount > 0) {
      overdueClause = `${overdueCount} ${plural('item', overdueCount)} already overdue.`;
    } else if (realisticInflated) {
      overdueClause = `Based on history, today's work likely runs ${fmtH(realisticMinutes)} — drop or move ${over}.`;
    } else {
      overdueClause = `Drop or move ${over} of work.`;
    }
    return {
      kind: 'overcommitted',
      sentence: `Today's plate needs ${over} more than fits.`,
      support: overdueClause,
    };
  }

  if (diff < -30) {
    const supportText = realisticInflated
      ? `${fmtH(committedMinutes)} estimated · ${fmtH(realisticMinutes)} realistic, ${fmtH(freeMinutes)} free.`
      : `${fmtH(committedMinutes)} of work, ${fmtH(freeMinutes)} free.`;
    return {
      kind: 'fits',
      sentence: `It fits, with room to spare.`,
      support: supportText,
    };
  }

  const tightSupport = realisticInflated
    ? `${fmtH(realisticMinutes)} of work (history-adjusted) in ${fmtH(freeMinutes)} free. Begin.`
    : `${fmtH(committedMinutes)} of work in ${fmtH(freeMinutes)} of free time. Begin.`;
  return {
    kind: 'fits',
    sentence: `It fits.`,
    support: tightSupport,
  };
}

function plural(word, n) {
  return n === 1 ? word : `${word}s`;
}

export default router;
