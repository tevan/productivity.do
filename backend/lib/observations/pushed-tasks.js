/**
 * Observation: a task has been pushed forward 4+ times in the last 30 days
 * and is still open. Surface the worst offender; offer to drop or schedule it
 * tomorrow morning.
 *
 * The 4-times threshold (vs. 3 in weekly review) is deliberately stricter —
 * weekly review is a list, the observation is the single sharpest one.
 *
 * Verifiable: the user can see the task and (eventually, when we wire it)
 * the revision history.
 */
export default function pushedTasksObservation(ctx) {
  const { userId, q } = ctx;

  const rows = q(`
    SELECT resource_id, before_json, after_json, created_at
      FROM revisions
     WHERE user_id = ? AND resource = 'tasks' AND op = 'update'
       AND created_at >= datetime('now', '-30 days')
  `).all(userId);

  const counts = new Map();
  for (const row of rows) {
    let before, after;
    try { before = JSON.parse(row.before_json); } catch { continue; }
    try { after  = JSON.parse(row.after_json);  } catch { continue; }
    const beforeDue = before?.dueDate || before?.dueDatetime || null;
    const afterDue  = after?.dueDate  || after?.dueDatetime  || null;
    if (beforeDue !== afterDue && (beforeDue || afterDue)) {
      const c = counts.get(row.resource_id) || 0;
      counts.set(row.resource_id, c + 1);
    }
  }

  const top = [...counts.entries()]
    .filter(([, n]) => n >= 4)
    .sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;

  const [taskId, moveCount] = top;
  const task = q(
    'SELECT todoist_id, content, is_completed FROM tasks_cache WHERE user_id = ? AND todoist_id = ?'
  ).get(userId, taskId);
  if (!task || task.is_completed) return null;

  const truncated = task.content.length > 60
    ? task.content.slice(0, 60) + '…'
    : task.content;

  return {
    id: `pushed_tasks:${taskId}`,
    kind: 'pushed_tasks',
    message: `You've moved "${truncated}" forward ${moveCount} times. It's not happening on its own — drop it, or schedule it for tomorrow morning.`,
    action: {
      kind: 'task',
      label: 'Open task',
      payload: { taskId },
    },
    confidence: Math.min(0.95, 0.55 + moveCount * 0.05),
    evidenceIds: [taskId],
  };
}
