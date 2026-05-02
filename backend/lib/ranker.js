// Decision ranker — the heart of the "what should I do right now" surface.
//
// Pure function. Takes already-fetched data (tasks, project metadata,
// momentum, project list, free minutes). Returns the same tasks with a
// numeric score and the top-level signals that contributed, so the UI
// can show "why is this first?" without re-running the math.
//
// Two modes:
//   default  — rank across all projects using the full composite
//   pinned   — pre-filter to tasks in pinned projects only; ranker
//              ignores project-position weight (everyone's pinned, no
//              meaningful relative position)
//
// Design discipline (from docs/internal/productivity-surface-strategy.md):
//   - Deterministic. No ML. Each weight is justifiable.
//   - Auditable. Returns the per-signal contributions on each task.
//   - Time-aware. Free-minutes-now and project rhythm both matter.
//   - Extensible without schema changes. Every new signal is a new term
//     in the composite, scored from existing data.

// Weights — picked so a typical signal is worth ~5 points, with strong
// signals (overdue, in-rhythm) reaching ~10. Roughly tunable; the
// ordering matters more than the absolute numbers.
const W = {
  overdue:           20,   // overdue tasks dominate
  due_today:         12,
  due_within_3d:      6,
  due_within_7d:      3,
  priority_p4:        8,   // Todoist's "P1" (priority=4)
  priority_p3:        5,
  priority_p2:        2,
  favorite_project:   4,
  pinned_project:    10,   // pinned projects have a strong baseline pull
  in_rhythm:          6,   // "I work on this on Tuesday afternoons" matched
  project_first:      3,   // Todoist sidebar order: 0 → +3, 1 → +2, 2 → +1
  project_second:     2,
  project_third:      1,
  recent_completion:  4,   // project moved in last 7 days
  no_recent_30d:     -3,   // stalled penalty
  fits_now:           5,   // estimated_minutes <= free_minutes_now
  doesnt_fit:        -2,
  project_due_soon:   8,   // proximity to project deadline pulls all its tasks
  project_due_3d:     5,
  project_due_7d:     2,
};

/**
 * Score a list of tasks.
 *
 * @param {object} args
 * @param {Array} args.tasks — minimal shape: { id, content, projectId, dueDate,
 *   dueDatetime, priority, estimatedMinutes, slipRisk? }
 * @param {Map<projectId, object>} args.projectMeta — from /api/project-meta
 * @param {Map<projectId, object>} args.momentum — from getProjectMomentum
 * @param {Array} args.projects — Todoist project list (for is_favorite + order)
 * @param {number} args.freeMinutes — minutes free in the rest of today
 * @param {string} args.timezone
 * @param {Date}   args.now
 * @param {'default'|'pinned'} args.mode
 * @returns {{ tasks: Array, mode: string, pinnedProjectIds: string[] }}
 */
export function rankTasks({
  tasks,
  projectMeta,
  momentum,
  projects = [],
  freeMinutes = 0,
  timezone = 'UTC',
  now = new Date(),
  mode = 'default',
}) {
  const projMap = new Map();
  for (const p of projects) projMap.set(String(p.id), p);

  // Pinned set comes from project_meta rows with non-null pinned_at.
  const pinnedProjectIds = [];
  for (const [pid, meta] of projectMeta) {
    if (meta.pinnedAt) pinnedProjectIds.push(pid);
  }
  const pinnedSet = new Set(pinnedProjectIds);
  const inPinnedMode = mode === 'pinned' && pinnedSet.size > 0;

  // Filter first if pinned mode. We don't filter in default mode — pinned
  // project tasks just outrank by virtue of the pinned_project weight.
  const candidates = inPinnedMode
    ? tasks.filter(t => t.projectId && pinnedSet.has(String(t.projectId)))
    : tasks.slice();

  const scored = candidates.map(t => {
    const reasons = [];
    let score = 0;

    // ---- Due-date urgency ----
    const dueMs = taskDueMs(t);
    if (dueMs != null) {
      const days = (dueMs - now.getTime()) / 86_400_000;
      if (days < 0) { score += W.overdue; reasons.push(['overdue', W.overdue]); }
      else if (days < 1) { score += W.due_today; reasons.push(['due today', W.due_today]); }
      else if (days <= 3) { score += W.due_within_3d; reasons.push(['due within 3d', W.due_within_3d]); }
      else if (days <= 7) { score += W.due_within_7d; reasons.push(['due within 7d', W.due_within_7d]); }
    }

    // ---- Task priority (Todoist 4 = highest) ----
    const p = Number(t.priority) || 1;
    if (p === 4) { score += W.priority_p4; reasons.push(['priority P1', W.priority_p4]); }
    else if (p === 3) { score += W.priority_p3; reasons.push(['priority P2', W.priority_p3]); }
    else if (p === 2) { score += W.priority_p2; reasons.push(['priority P3', W.priority_p2]); }

    // ---- Project signals ----
    const projId = t.projectId ? String(t.projectId) : null;
    const proj = projId ? projMap.get(projId) : null;
    const meta = projId ? projectMeta.get(projId) : null;
    const mom  = projId ? momentum.get(projId) : null;

    if (proj?.isFavorite) {
      score += W.favorite_project;
      reasons.push(['favorited project', W.favorite_project]);
    }

    if (meta?.pinnedAt && !inPinnedMode) {
      score += W.pinned_project;
      reasons.push(['pinned project', W.pinned_project]);
    }

    // Project sidebar order — only the first three get a small bonus, and
    // only in default mode.
    if (!inPinnedMode && proj?.order != null) {
      const o = Number(proj.order);
      if (o === 0)      { score += W.project_first;  reasons.push(['top project', W.project_first]); }
      else if (o === 1) { score += W.project_second; reasons.push(['2nd project', W.project_second]); }
      else if (o === 2) { score += W.project_third;  reasons.push(['3rd project', W.project_third]); }
    }

    // Project momentum
    if (mom?.momentum === 'moving') {
      score += W.recent_completion;
      reasons.push(['active project', W.recent_completion]);
    } else if (mom?.momentum === 'stalled') {
      score += W.no_recent_30d;
      reasons.push(['stalled project', W.no_recent_30d]);
    }

    // Project rhythm — boost when in declared working window
    if (meta?.rhythm && isInRhythm(meta.rhythm, now, timezone)) {
      score += W.in_rhythm;
      reasons.push(['in project rhythm', W.in_rhythm]);
    }

    // Project deadline proximity
    if (meta?.dueDate) {
      const days = projectDueDays(meta.dueDate, now, timezone);
      if (days != null) {
        if (days < 0)      { /* overdue: handled by individual task overdue if any */ }
        else if (days < 1) { score += W.project_due_soon; reasons.push(['project due today', W.project_due_soon]); }
        else if (days <= 3){ score += W.project_due_3d;   reasons.push(['project due within 3d', W.project_due_3d]); }
        else if (days <= 7){ score += W.project_due_7d;   reasons.push(['project due within 7d', W.project_due_7d]); }
      }
    }

    // ---- Estimation fit ----
    const est = Number(t.estimatedMinutes) || 0;
    if (est > 0 && freeMinutes > 0) {
      if (est <= freeMinutes) {
        score += W.fits_now;
        reasons.push(['fits in free time', W.fits_now]);
      } else if (est > freeMinutes * 1.5) {
        // Significantly larger than what's free — small penalty so it
        // doesn't dominate when nothing else is on the schedule.
        score += W.doesnt_fit;
        reasons.push(['larger than free time', W.doesnt_fit]);
      }
    }

    return { ...t, score, scoreReasons: reasons };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break: earlier due first, then created earlier (using id as
    // proxy for stable order when due is missing).
    const ad = taskDueMs(a); const bd = taskDueMs(b);
    if (ad != null && bd != null) return ad - bd;
    if (ad != null) return -1;
    if (bd != null) return 1;
    return String(a.id).localeCompare(String(b.id));
  });

  return {
    tasks: scored,
    mode: inPinnedMode ? 'pinned' : 'default',
    pinnedProjectIds,
  };
}

function taskDueMs(t) {
  if (t.dueDatetime) {
    const ms = new Date(t.dueDatetime).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (t.dueDate) {
    const ms = new Date(`${t.dueDate}T00:00:00`).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function projectDueDays(ymd, now, /* tz unused for now — local-midnight is fine */) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const ms = new Date(`${ymd}T23:59:59`).getTime();
  if (!Number.isFinite(ms)) return null;
  return (ms - now.getTime()) / 86_400_000;
}

function isInRhythm(rhythm, now, tz) {
  // rhythm shape: { mon:[{start:'13:00', end:'17:00'}, ...], tue:[...], ... }
  // Day key is en-US 3-letter lowercase.
  if (!rhythm || typeof rhythm !== 'object') return false;
  let dayKey, hhmm;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
    dayKey = parts.weekday?.toLowerCase();
    hhmm = `${parts.hour}:${parts.minute}`;
  } catch {
    return false;
  }
  const windows = rhythm[dayKey];
  if (!Array.isArray(windows)) return false;
  for (const w of windows) {
    if (!w?.start || !w?.end) continue;
    if (hhmm >= w.start && hhmm < w.end) return true;
  }
  return false;
}
