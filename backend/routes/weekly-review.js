import { Router } from 'express';
import { q } from '../db/init.js';

const router = Router();

/**
 * GET /api/weekly-review — synthesis #2: what actually happened.
 *
 * Sunday/Monday morning surface. Reads the user's existing data and frames it
 * as comparisons (this week vs. baseline) plus *implicit decisions*. Tufte +
 * Newport hammer this in the reference library: every metric must lead to a
 * decision. Otherwise it's a vanity panel.
 *
 * Inputs:
 *   ?weekStart=YYYY-MM-DD   — optional. Defaults to most recent Monday in the user's tz.
 *   ?tz=America/Denver      — optional. Falls back to user prefs, then server tz, then UTC.
 *
 * Response shape (truncated):
 *   {
 *     ok: true,
 *     timezone: 'America/Denver',
 *     weekStart: '2026-04-27',     // Monday
 *     weekEnd:   '2026-05-04',     // exclusive
 *     baselineWeeks: 4,
 *     completion: {
 *       completed: 23,             // tasks completed this week
 *       opened: 31,                // tasks created this week
 *       avgAgeAtCompletionDays: 4.1,
 *       baselineAvgAgeAtCompletionDays: 3.7,
 *     },
 *     meetings: { hours: 19, baselineHours: 16.3, declined: 2 },
 *     stale: [                     // tasks that have lived >14 days, never completed
 *       { id, content, ageDays, priority }
 *     ],
 *     pushedRepeatedly: [          // tasks whose due date moved >=3 times
 *       { id, content, moveCount, currentDueDate }
 *     ],
 *     headlines: [                 // up to 4 framed sentences with linked actions
 *       {
 *         id: 'completion',
 *         tone: 'good'|'neutral'|'concern',
 *         text: '...',
 *         action: { kind: 'view'|'bulk_drop'|'bulk_reschedule', ... }?
 *       }
 *     ]
 *   }
 *
 * The *headlines* array is the synthesis. Everything else is the supporting
 * data. Keep the headlines few (max 4); the value is in the framing, not the
 * volume.
 */
router.get('/api/weekly-review', async (req, res) => {
  try {
    const userId = req.user.id;

    // ---- Timezone ----
    const prefRows = q(
      'SELECT key, value FROM preferences WHERE user_id = ? AND key = ?'
    ).all(userId, 'primaryTimezone');
    const userTz = prefRows[0]?.value ? safeJson(prefRows[0].value) : null;

    const isValidTz = (tz) => {
      if (!tz || typeof tz !== 'string') return false;
      try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
      catch { return false; }
    };
    let timezone =
      (isValidTz(req.query.tz) && req.query.tz) ||
      (isValidTz(userTz) && userTz) ||
      null;
    if (!timezone) {
      try {
        const serverTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        timezone = isValidTz(serverTz) ? serverTz : 'UTC';
      } catch { timezone = 'UTC'; }
    }

    // ---- Week boundaries (Mon-Sun) in user's tz ----
    const today = ymdInTz(new Date(), timezone);
    const reqStart = (typeof req.query.weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.weekStart))
      ? req.query.weekStart : null;
    const weekStart = reqStart || mostRecentMonday(today);
    const weekEnd = addDays(weekStart, 7);

    const baselineStart = addDays(weekStart, -28);
    const baselineEnd = weekStart;

    const weekStartUtc = wallToUtc(weekStart, '00:00', timezone).toISOString();
    const weekEndUtc = wallToUtc(weekEnd, '00:00', timezone).toISOString();
    const baselineStartUtc = wallToUtc(baselineStart, '00:00', timezone).toISOString();
    const baselineEndUtc = wallToUtc(baselineEnd, '00:00', timezone).toISOString();

    // ---- Completion counts ----
    const completedThisWeek = q(`
      SELECT todoist_id, content, priority, created_at, completed_at, estimated_minutes,
             due_date, project_name
        FROM tasks_cache
       WHERE user_id = ?
         AND completed_at IS NOT NULL
         AND completed_at >= ? AND completed_at < ?
    `).all(userId, weekStartUtc, weekEndUtc);

    const completedBaseline = q(`
      SELECT created_at, completed_at
        FROM tasks_cache
       WHERE user_id = ?
         AND completed_at IS NOT NULL
         AND completed_at >= ? AND completed_at < ?
    `).all(userId, baselineStartUtc, baselineEndUtc);

    // "Opened" only counts rows where we know the creation date — pre-
    // migration tasks have created_at = NULL and don't contribute. Better
    // to under-report than to lie.
    const openedThisWeek = q(`
      SELECT COUNT(*) AS c FROM tasks_cache
       WHERE user_id = ?
         AND created_at IS NOT NULL
         AND created_at >= ? AND created_at < ?
    `).get(userId, weekStartUtc, weekEndUtc);

    const ageDays = (created, completed) => {
      if (!created || !completed) return null;
      const c = new Date(created).getTime();
      const d = new Date(completed).getTime();
      if (!Number.isFinite(c) || !Number.isFinite(d)) return null;
      return Math.max(0, (d - c) / 86_400_000);
    };
    const avgAge = (rows) => {
      const ages = rows.map(r => ageDays(r.created_at, r.completed_at)).filter(a => a != null);
      if (!ages.length) return null;
      return ages.reduce((s, a) => s + a, 0) / ages.length;
    };
    const avgAgeAtCompletionDays = avgAge(completedThisWeek);
    const baselineAvgAgeAtCompletionDays = avgAge(completedBaseline);

    // ---- Meeting hours ----
    // events_cache has the user's calendars; we filter by start_time + skip
    // all-day events because they distort the "hours in meetings" framing.
    const meetingRowsThisWeek = q(`
      SELECT e.start_time, e.end_time, e.all_day
        FROM events_cache e
        JOIN calendars c ON c.id = e.calendar_id
       WHERE c.user_id = ?
         AND COALESCE(e.all_day, 0) = 0
         AND e.status != 'cancelled'
         AND e.start_time >= ? AND e.start_time < ?
    `).all(userId, weekStartUtc, weekEndUtc);

    const meetingRowsBaseline = q(`
      SELECT e.start_time, e.end_time, e.all_day
        FROM events_cache e
        JOIN calendars c ON c.id = e.calendar_id
       WHERE c.user_id = ?
         AND COALESCE(e.all_day, 0) = 0
         AND e.status != 'cancelled'
         AND e.start_time >= ? AND e.start_time < ?
    `).all(userId, baselineStartUtc, baselineEndUtc);

    const sumHours = (rows) => {
      let total = 0;
      for (const r of rows) {
        const a = new Date(r.start_time).getTime();
        const b = new Date(r.end_time).getTime();
        if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
          total += (b - a) / 3600_000;
        }
      }
      return total;
    };
    const meetingHours = round1(sumHours(meetingRowsThisWeek));
    const baselineMeetingHours = round1(sumHours(meetingRowsBaseline) / 4);

    // ---- Stale tasks: open, never scheduled (no due_date), >14 days old ----
    const stale = q(`
      SELECT todoist_id AS id, content, priority, project_name, created_at,
             due_date, due_datetime
        FROM tasks_cache
       WHERE user_id = ?
         AND (is_completed = 0 OR is_completed IS NULL)
         AND due_date IS NULL AND due_datetime IS NULL
         AND created_at < datetime('now', '-14 days')
       ORDER BY created_at ASC
       LIMIT 8
    `).all(userId).map(r => ({
      id: r.id,
      content: r.content,
      priority: r.priority,
      projectName: r.project_name,
      ageDays: r.created_at
        ? Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86_400_000)
        : null,
    }));

    // ---- Tasks pushed repeatedly (due_date changed >=3 times in revisions) ----
    // The revisions table records before/after on update. We count rows where
    // dueDate changed (after.dueDate !== before.dueDate). Approximate; perfect
    // accuracy isn't worth the cost of dedicated tracking.
    const pushedRows = q(`
      SELECT resource_id, before_json, after_json
        FROM revisions
       WHERE user_id = ? AND resource = 'tasks' AND op = 'update'
         AND created_at >= datetime('now', '-30 days')
    `).all(userId);
    const pushCounts = new Map();
    for (const row of pushedRows) {
      let before, after;
      try { before = JSON.parse(row.before_json); } catch { continue; }
      try { after  = JSON.parse(row.after_json);  } catch { continue; }
      const beforeDue = before?.dueDate || before?.dueDatetime || null;
      const afterDue  = after?.dueDate  || after?.dueDatetime  || null;
      if (beforeDue !== afterDue && (beforeDue || afterDue)) {
        pushCounts.set(row.resource_id, (pushCounts.get(row.resource_id) || 0) + 1);
      }
    }
    const pushedIds = [...pushCounts.entries()].filter(([, n]) => n >= 3).map(([id]) => id);
    let pushedRepeatedly = [];
    if (pushedIds.length) {
      const placeholders = pushedIds.map(() => '?').join(',');
      const rows = q(`
        SELECT todoist_id AS id, content, priority, due_date, due_datetime, project_name
          FROM tasks_cache
         WHERE user_id = ? AND (is_completed = 0 OR is_completed IS NULL)
           AND todoist_id IN (${placeholders})
      `).all(userId, ...pushedIds);
      pushedRepeatedly = rows.map(r => ({
        id: r.id,
        content: r.content,
        priority: r.priority,
        currentDueDate: r.due_datetime || r.due_date || null,
        moveCount: pushCounts.get(r.id),
        projectName: r.project_name,
      }));
      pushedRepeatedly.sort((a, b) => b.moveCount - a.moveCount);
      pushedRepeatedly = pushedRepeatedly.slice(0, 8);
    }

    // ---- Headlines: the synthesis ----
    const headlines = composeHeadlines({
      completedCount: completedThisWeek.length,
      openedCount: openedThisWeek.c,
      avgAgeAtCompletionDays,
      baselineAvgAgeAtCompletionDays,
      meetingHours,
      baselineMeetingHours,
      staleCount: stale.length,
      pushedCount: pushedRepeatedly.length,
    });

    res.json({
      ok: true,
      timezone,
      weekStart,
      weekEnd,
      baselineWeeks: 4,
      completion: {
        completed: completedThisWeek.length,
        opened: openedThisWeek.c,
        avgAgeAtCompletionDays: avgAgeAtCompletionDays != null ? round1(avgAgeAtCompletionDays) : null,
        baselineAvgAgeAtCompletionDays: baselineAvgAgeAtCompletionDays != null ? round1(baselineAvgAgeAtCompletionDays) : null,
      },
      meetings: { hours: meetingHours, baselineHours: baselineMeetingHours },
      stale,
      pushedRepeatedly,
      headlines,
    });
  } catch (err) {
    console.error('GET /api/weekly-review error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Headline composer — the heart of the synthesis.
//
// Rules:
//  1. Each headline pairs a *fact* with a *decision*. No isolated metrics.
//  2. We compare to baseline so the user knows whether the week was unusual.
//  3. Tone is graded — 'good' (acknowledge), 'neutral' (note), 'concern'
//     (suggest action). Avoid 'bad'; the goal is observation, not judgment.
//  4. Never more than 4 headlines. The user can see the data; the value is
//     the *editing*.
// ---------------------------------------------------------------------------
function composeHeadlines({
  completedCount, openedCount,
  avgAgeAtCompletionDays, baselineAvgAgeAtCompletionDays,
  meetingHours, baselineMeetingHours,
  staleCount, pushedCount,
}) {
  const out = [];

  // Completion velocity vs. baseline. The "opened" number is suppressed
  // when it's wildly inconsistent with completion (>20 opened, 0 completed
  // is almost always a data artifact from the created_at backfill window
  // rather than real behavior). We'd rather say less than say something
  // misleading.
  const openedIsTrustworthy = openedCount <= 20 || completedCount > 0;
  if (completedCount > 0) {
    const ageStr = avgAgeAtCompletionDays != null
      ? `Average task age at completion: ${avgAgeAtCompletionDays} ${avgAgeAtCompletionDays === 1 ? 'day' : 'days'}.`
      : '';
    let trend = '';
    if (avgAgeAtCompletionDays != null && baselineAvgAgeAtCompletionDays != null) {
      const diff = avgAgeAtCompletionDays - baselineAvgAgeAtCompletionDays;
      if (Math.abs(diff) >= 1.0) {
        trend = diff > 0
          ? ` That's ${round1(diff)} day${diff >= 2 ? 's' : ''} slower than your 4-week average — tasks are sitting longer before getting done.`
          : ` That's ${round1(-diff)} day${-diff >= 2 ? 's' : ''} faster than your 4-week average.`;
      }
    }
    const openedClause = openedIsTrustworthy && openedCount > 0
      ? ` (and opened ${openedCount} new ones).`
      : '.';
    out.push({
      id: 'completion',
      tone: avgAgeAtCompletionDays != null && baselineAvgAgeAtCompletionDays != null && (avgAgeAtCompletionDays - baselineAvgAgeAtCompletionDays) > 1.5
        ? 'concern' : 'neutral',
      text: `You completed ${completedCount} task${completedCount === 1 ? '' : 's'} this week${openedClause} ${ageStr}${trend}`.trim(),
    });
  } else if (openedCount > 0 && openedIsTrustworthy) {
    out.push({
      id: 'completion',
      tone: 'concern',
      text: `You opened ${openedCount} task${openedCount === 1 ? '' : 's'} this week and completed none. Pick one to start tomorrow morning.`,
    });
  }

  // Meeting load. Concern only when the absolute hours are high AND the
  // trend is up — being below your baseline is never a concern, only ever
  // an observation.
  if (meetingHours > 0) {
    const diff = meetingHours - baselineMeetingHours;
    const baselineNote = baselineMeetingHours > 0
      ? ` ${diff > 0
          ? `${Math.round((diff / baselineMeetingHours) * 100)}% more than your 4-week average.`
          : diff < 0
            ? `${Math.round((-diff / baselineMeetingHours) * 100)}% less than your 4-week average.`
            : `Right at your 4-week average.`}`
      : '';
    let action = '';
    if (meetingHours >= 20 && diff > 2) {
      action = ' Consider declining one recurring meeting next week.';
    }
    const tone = (meetingHours >= 25 && diff >= 0)
      ? 'concern'
      : (diff < 0 ? 'good' : 'neutral');
    out.push({
      id: 'meetings',
      tone,
      text: `You spent ${meetingHours} hour${meetingHours === 1 ? '' : 's'} in meetings this week.${baselineNote}${action}`,
    });
  }

  // Stale tasks — never scheduled, drifting.
  if (staleCount > 0) {
    out.push({
      id: 'stale',
      tone: staleCount >= 5 ? 'concern' : 'neutral',
      text: `${staleCount} task${staleCount === 1 ? ' has' : 's have'} been on your list 14+ days without ever being scheduled. Drop them or commit a time.`,
      action: { kind: 'view', target: 'stale' },
    });
  }

  // Tasks getting pushed repeatedly.
  if (pushedCount > 0) {
    out.push({
      id: 'pushed',
      tone: pushedCount >= 3 ? 'concern' : 'neutral',
      text: `${pushedCount} task${pushedCount === 1 ? ' has' : 's have'} been pushed forward 3+ times this month. They're not happening — decide.`,
      action: { kind: 'view', target: 'pushed' },
    });
  }

  // Cap at 4.
  return out.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Date / timezone helpers (shared shape with today.js — kept inline rather
// than cross-imported because the synthesis surfaces are independent).
// ---------------------------------------------------------------------------
function ymdInTz(d, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d);
}

function weekdayInTz(ymd, tz) {
  const probe = new Date(`${ymd}T12:00:00Z`);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  const wd = fmt.format(probe);
  return ({ Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 })[wd] ?? 0;
}

function mostRecentMonday(ymd) {
  // Compute weekday in UTC; 'most recent Monday' is a wall-clock concept and
  // we use UTC noon to dodge DST edges. The user's locale week-start may
  // vary; for the synthesis we pin to Monday since the language ("last
  // week", "this week") reads most naturally there.
  const probe = new Date(`${ymd}T12:00:00Z`);
  const dow = probe.getUTCDay(); // 0=Sun
  const offset = dow === 0 ? -6 : (1 - dow); // Sun → -6, Mon → 0, Tue → -1, ...
  return addDays(ymd, offset);
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function wallToUtc(ymd, hhmm, tz) {
  const naive = new Date(`${ymd}T${hhmm}:00Z`);
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

function safeJson(s) {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
}

function round1(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

export default router;
