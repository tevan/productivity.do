/**
 * Observation: the user's completion times cluster heavily in one half of the
 * day. Surface the pattern and suggest auto-scheduling matching tasks there.
 *
 * Specifically: if ≥70% of the user's completed tasks (over the last 30 days,
 * minimum 15 completions) finished in either the morning (before 12 local)
 * or the evening (after 18 local), surface it.
 *
 * This is a quiet observation — just naming the pattern is the value. No
 * action button: the user decides what to do. (We could auto-schedule but
 * the literature consensus in the reference library is that auto-anything
 * here erodes trust faster than it helps.)
 */
export default function completionTimePatternObservation(ctx) {
  const { userId, timezone, q, now } = ctx;

  const sinceUtc = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const completed = q(`
    SELECT completed_at
      FROM tasks_cache
     WHERE user_id = ?
       AND completed_at IS NOT NULL
       AND completed_at >= ?
  `).all(userId, sinceUtc);

  if (completed.length < 15) return null;

  let morning = 0, afternoon = 0, evening = 0;
  for (const r of completed) {
    const t = new Date(r.completed_at);
    if (!Number.isFinite(t.getTime())) continue;
    const hourFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour: 'numeric', hour12: false,
    });
    const h = parseInt(hourFmt.format(t), 10);
    if (Number.isNaN(h)) continue;
    if (h < 12) morning += 1;
    else if (h < 18) afternoon += 1;
    else evening += 1;
  }
  const total = morning + afternoon + evening;
  if (total < 15) return null;

  const morningPct = morning / total;
  const eveningPct = evening / total;

  if (morningPct >= 0.7) {
    return {
      id: 'completion_time:morning',
      kind: 'completion_time_pattern',
      message: `${Math.round(morningPct * 100)}% of your tasks last month were finished before noon. You're a morning closer — protect that window.`,
      action: null,
      confidence: 0.6 + (morningPct - 0.7) * 0.5,
    };
  }
  if (eveningPct >= 0.7) {
    return {
      id: 'completion_time:evening',
      kind: 'completion_time_pattern',
      message: `${Math.round(eveningPct * 100)}% of your tasks last month were finished after 6pm. Evenings are when work actually happens for you — design days around that.`,
      action: null,
      confidence: 0.6 + (eveningPct - 0.7) * 0.5,
    };
  }

  return null;
}
