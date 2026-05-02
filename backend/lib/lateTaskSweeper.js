// Auto-move late tasks → today.
//
// For each user with `autoMoveLateTasks=true`, find tasks whose due_date is
// strictly before the user's "today" (in their tz) and roll them to today.
// Routed per-provider:
//   - todoist (or NULL provider, legacy): PUT /tasks/:id with due_date=ymd via
//     the Todoist client. Local cache is updated optimistically.
//   - native: UPDATE tasks_native SET due_date = ymd.
//   - other providers: skipped (not all providers support a due-date update —
//     we'll add per-adapter handling when there's a real signal).
//
// Idempotent: if a task is already due today, leave it. If a sweep partially
// completes (e.g. Todoist API errors after some tasks moved), the rest catch
// up next sweep. We *never* move a task that's marked completed.
//
// Frequency: top-of-the-hour. The first sweep after the user's local
// midnight rolls their overdue tasks; subsequent hours catch any tasks that
// became overdue mid-day (e.g. due_datetime that just passed).

import { q } from '../db/init.js';
import * as todoist from './todoist.js';
import { captureError } from './sentry.js';

let running = false;

export async function sweepLateTasks() {
  if (running) return;
  running = true;
  try {
    const users = q(`
      SELECT u.id, p.value AS pref_value, tz.value AS tz_value
        FROM users u
   LEFT JOIN preferences p
          ON p.user_id = u.id AND p.key = 'autoMoveLateTasks'
   LEFT JOIN preferences tz
          ON tz.user_id = u.id AND tz.key = 'primaryTimezone'
       WHERE u.deleted_at IS NULL
    `).all();

    for (const u of users) {
      try {
        const enabled = u.pref_value && safeJson(u.pref_value);
        if (!enabled) continue;
        const tz = isValidTz(safeJson(u.tz_value)) ? safeJson(u.tz_value) : 'UTC';
        await sweepOneUser(u.id, tz);
      } catch (err) {
        captureError?.(err, { component: 'lateTaskSweeper.user', userId: u.id });
        console.warn('[lateTaskSweeper] user', u.id, 'sweep failed:', err.message);
      }
    }
  } catch (err) {
    captureError?.(err, { component: 'lateTaskSweeper.outer' });
    console.warn('[lateTaskSweeper] outer:', err.message);
  } finally {
    running = false;
  }
}

async function sweepOneUser(userId, tz) {
  const todayYmd = ymdInTz(new Date(), tz);

  // Pull overdue + open + non-recurring tasks. We deliberately skip
  // recurring tasks: rolling a recurring task would either no-op (Todoist
  // recomputes) or be wrong (we'd skip an instance). Better to leave them.
  const rows = q(`
    SELECT todoist_id, due_date, due_datetime, provider
      FROM tasks_cache
     WHERE user_id = ?
       AND (is_completed = 0 OR is_completed IS NULL)
       AND (
         (due_date IS NOT NULL AND due_date < ?)
      OR (due_datetime IS NOT NULL AND due_datetime < datetime('now'))
       )
       LIMIT 200
  `).all(userId, todayYmd);

  let moved = 0;
  for (const r of rows) {
    try {
      const provider = r.provider || 'todoist';
      if (provider === 'todoist') {
        await todoist.updateTask(r.todoist_id, { due_date: todayYmd }, userId);
        // Reflect locally so the SPA + the synthesis layer both see it
        // without waiting for the next Todoist resync. Clear due_datetime
        // since we're switching to date-only.
        q(`
          UPDATE tasks_cache
             SET due_date = ?, due_datetime = NULL, updated_at = datetime('now')
           WHERE user_id = ? AND todoist_id = ?
        `).run(todayYmd, userId, r.todoist_id);
        moved += 1;
      } else if (provider === 'native') {
        q(`
          UPDATE tasks_native
             SET due_date = ?, due_datetime = NULL, updated_at = datetime('now')
           WHERE user_id = ? AND id = ?
        `).run(todayYmd, userId, r.todoist_id);
        moved += 1;
      }
      // Other providers: skip silently. Per-adapter wiring is a later add.
    } catch (err) {
      // One bad task shouldn't stop the sweep.
      console.warn(`[lateTaskSweeper] u${userId} t${r.todoist_id}:`, err.message);
    }
  }

  if (moved > 0) {
    console.log(`[lateTaskSweeper] u${userId}: moved ${moved} task(s) to ${todayYmd}`);
  }
}

export function startLateTaskSweeper() {
  // Run once on startup, then hourly.
  setTimeout(() => sweepLateTasks().catch(() => {}), 30_000);
  setInterval(() => sweepLateTasks().catch(() => {}), 60 * 60_000).unref?.();
}

function safeJson(s) {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
}
function isValidTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
}
function ymdInTz(d, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d);
}
