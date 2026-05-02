// Project-level derivations. Pure SQL on tasks_cache.completed_at + open
// task counts. No storage — this is observation, not prediction.
//
// Momentum classification:
//   moving  — at least one task completed in the last 7 days
//   stalled — has open tasks AND no completions in the last 30 days
//   idle    — no open tasks (and not "moving"); the project is at rest
//
// "Recency" used by the ranker is just the most recent completed_at per
// project; momentum is the human-readable label derived from it.

import { q } from '../db/init.js';

/**
 * Compute project momentum + last-touched timestamps.
 *
 * @param {number} userId
 * @returns {Map<projectId, { momentum: 'moving'|'stalled'|'idle',
 *                            lastCompletedAt: string|null,
 *                            openCount: number,
 *                            completed7d: number }>}
 */
export function getProjectMomentum(userId) {
  const rows = q(`
    SELECT
      project_id,
      MAX(CASE WHEN is_completed = 1 THEN completed_at END) AS last_completed_at,
      SUM(CASE WHEN (is_completed = 0 OR is_completed IS NULL) THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN is_completed = 1 AND completed_at >= datetime('now', '-7 days')
               THEN 1 ELSE 0 END) AS completed_7d,
      SUM(CASE WHEN is_completed = 1 AND completed_at >= datetime('now', '-30 days')
               THEN 1 ELSE 0 END) AS completed_30d
      FROM tasks_cache
     WHERE user_id = ?
       AND project_id IS NOT NULL
     GROUP BY project_id
  `).all(userId);

  const out = new Map();
  for (const r of rows) {
    let momentum;
    if (r.completed_7d > 0) momentum = 'moving';
    else if (r.open_count > 0 && r.completed_30d === 0) momentum = 'stalled';
    else if (r.open_count === 0) momentum = 'idle';
    else momentum = 'stalled'; // open tasks + last completion 7-30d ago — slight pull

    out.set(r.project_id, {
      momentum,
      lastCompletedAt: r.last_completed_at,
      openCount: Number(r.open_count || 0),
      completed7d: Number(r.completed_7d || 0),
    });
  }
  return out;
}
