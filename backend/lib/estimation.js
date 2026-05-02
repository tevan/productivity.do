// Estimation Intelligence — the closed loop between estimated_minutes and
// actual_minutes. Pure SQL, no inference, no streaming. Cheap on every read.
//
// We aggregate:
//   - A single global ratio per user (avg actual / estimated across all
//     completed tasks with both numbers present).
//   - A per-project ratio (avg actual / estimated grouped by project_name).
//   - A per-task historical ratio (when the same content has been completed
//     multiple times — useful for recurring tasks).
//
// The label dimension would also be useful but tasks_cache doesn't currently
// store labels locally — Todoist owns them. Add later if/when labels move
// into our cache.
//
// All ratios require ≥3 completions to qualify; below that the variance is
// too high to be honest. We clamp ratios to [0.5, 4] so a single "I started
// it then stepped away for hours" doesn't wreck the user's history.

import { q } from '../db/init.js';

// Minimum completions to publish a ratio. Below this we say "we don't know
// yet" rather than show a misleading number.
const MIN_SAMPLES = 3;
const RATIO_FLOOR = 0.5;
const RATIO_CEIL = 4.0;

/**
 * Global per-user ratio. Returns null if not enough samples.
 * @param {number} userId
 * @returns {{ratio: number, samples: number} | null}
 */
export function getGlobalRatio(userId) {
  const rows = q(`
    SELECT estimated_minutes, actual_minutes
      FROM tasks_cache
     WHERE user_id = ?
       AND is_completed = 1
       AND estimated_minutes IS NOT NULL AND estimated_minutes > 0
       AND actual_minutes IS NOT NULL AND actual_minutes > 0
  `).all(userId);

  if (rows.length < MIN_SAMPLES) return null;

  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const ratio = r.actual_minutes / r.estimated_minutes;
    if (ratio < RATIO_FLOOR || ratio > RATIO_CEIL) continue;
    sum += ratio;
    n += 1;
  }
  if (n < MIN_SAMPLES) return null;
  return { ratio: sum / n, samples: n };
}

/**
 * Per-project ratios. Returns a Map<projectName, {ratio, samples}>.
 * Only includes projects with ≥3 qualifying completions.
 */
export function getProjectRatios(userId) {
  const rows = q(`
    SELECT project_name, estimated_minutes, actual_minutes
      FROM tasks_cache
     WHERE user_id = ?
       AND is_completed = 1
       AND project_name IS NOT NULL
       AND estimated_minutes IS NOT NULL AND estimated_minutes > 0
       AND actual_minutes IS NOT NULL AND actual_minutes > 0
  `).all(userId);

  const buckets = new Map();
  for (const r of rows) {
    const ratio = r.actual_minutes / r.estimated_minutes;
    if (ratio < RATIO_FLOOR || ratio > RATIO_CEIL) continue;
    const b = buckets.get(r.project_name) || { sum: 0, n: 0 };
    b.sum += ratio;
    b.n += 1;
    buckets.set(r.project_name, b);
  }

  const out = new Map();
  for (const [name, b] of buckets) {
    if (b.n >= MIN_SAMPLES) out.set(name, { ratio: b.sum / b.n, samples: b.n });
  }
  return out;
}

/**
 * Per-task historical ratio. Looks at completions of tasks with the SAME
 * content (case-insensitive trim) for this user — useful for recurring
 * tasks ("write blog post", "weekly review") where the same content gets
 * re-created.
 *
 * @param {number} userId
 * @param {string} content
 * @returns {{ratio: number, samples: number} | null}
 */
export function getTaskRatio(userId, content) {
  if (!content || typeof content !== 'string') return null;
  const key = content.trim().toLowerCase();
  if (!key) return null;
  const rows = q(`
    SELECT estimated_minutes, actual_minutes
      FROM tasks_cache
     WHERE user_id = ?
       AND is_completed = 1
       AND LOWER(TRIM(content)) = ?
       AND estimated_minutes IS NOT NULL AND estimated_minutes > 0
       AND actual_minutes IS NOT NULL AND actual_minutes > 0
  `).all(userId, key);

  if (rows.length < MIN_SAMPLES) return null;
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const ratio = r.actual_minutes / r.estimated_minutes;
    if (ratio < RATIO_FLOOR || ratio > RATIO_CEIL) continue;
    sum += ratio;
    n += 1;
  }
  if (n < MIN_SAMPLES) return null;
  return { ratio: sum / n, samples: n };
}

/**
 * Compute a "realistic load" for today given a list of tasks.
 * Each task's estimated_minutes is multiplied by the most-specific available
 * ratio (per-task → per-project → global), defaulting to 1.0 when nothing
 * qualifies.
 *
 * Returns:
 *   {
 *     estimated: total estimated minutes (sum of task estimates),
 *     realistic: total adjusted minutes,
 *     ratio: average applied ratio (realistic / estimated, when estimated > 0),
 *     samples: total sample count across applied ratios,
 *     hasHistory: bool — true if at least one ratio was applied
 *   }
 */
export function projectLoad(userId, tasks) {
  const global = getGlobalRatio(userId);
  const projects = getProjectRatios(userId);
  let est = 0;
  let realistic = 0;
  let appliedSamples = 0;
  let hadAny = false;

  for (const t of tasks) {
    const m = t.estimatedMinutes || 0;
    if (m <= 0) continue;
    est += m;

    const taskR = getTaskRatio(userId, t.content);
    const projR = t.projectName ? projects.get(t.projectName) : null;
    let chosen = null;
    if (taskR) chosen = taskR;
    else if (projR) chosen = projR;
    else if (global) chosen = global;

    if (chosen) {
      hadAny = true;
      appliedSamples += chosen.samples;
      realistic += m * chosen.ratio;
    } else {
      realistic += m; // no signal → trust the estimate
    }
  }

  return {
    estimated: Math.round(est),
    realistic: Math.round(realistic),
    ratio: est > 0 ? realistic / est : 1,
    samples: appliedSamples,
    hasHistory: hadAny,
  };
}
