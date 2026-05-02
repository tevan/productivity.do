/**
 * Observation: a single weekday has averaged a high number of meetings for
 * 4 consecutive weeks. Suggest a focus block on the *opposite* part of the
 * day so the user has at least one protected window.
 *
 * Threshold: avg ≥ 5 meetings on the same weekday for 4 weeks. Tuned
 * conservatively — the goal is to surface real patterns, not noise.
 *
 * The action navigates to focus blocks settings rather than auto-creating
 * one. Auto-creating would be intrusive; surfacing is the point.
 */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function meetingDensityObservation(ctx) {
  const { userId, timezone, q, now } = ctx;

  // Last 4 full weeks of timed events on user calendars.
  const sinceUtc = new Date(now.getTime() - 28 * 86_400_000).toISOString();
  const events = q(`
    SELECT e.start_time
      FROM events_cache e
      JOIN calendars c ON c.id = e.calendar_id
     WHERE c.user_id = ?
       AND COALESCE(e.all_day, 0) = 0
       AND e.status != 'cancelled'
       AND e.start_time >= ?
  `).all(userId, sinceUtc);

  if (events.length < 20) return null;

  // Bucket by (week, weekday) in user's tz.
  const buckets = new Map(); // key: `${weekIdx}-${dow}` → count
  for (const e of events) {
    const t = new Date(e.start_time);
    if (!Number.isFinite(t.getTime())) continue;
    const weekIdx = Math.floor((now.getTime() - t.getTime()) / (7 * 86_400_000));
    if (weekIdx < 0 || weekIdx >= 4) continue;
    const dowFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
    const wd = dowFmt.format(t);
    const dow = ({ Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 })[wd];
    if (dow == null) continue;
    const key = `${weekIdx}-${dow}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  // For each weekday, did all 4 weeks have ≥5 meetings?
  let bestDow = null, bestAvg = 0;
  for (let dow = 0; dow < 7; dow++) {
    const counts = [0, 1, 2, 3].map(w => buckets.get(`${w}-${dow}`) || 0);
    if (counts.every(c => c >= 5)) {
      const avg = counts.reduce((s, c) => s + c, 0) / 4;
      if (avg > bestAvg) { bestAvg = avg; bestDow = dow; }
    }
  }
  if (bestDow == null) return null;

  return {
    id: `meeting_density:${bestDow}`,
    kind: 'meeting_density',
    message: `Your ${DAY_NAMES[bestDow]}s have averaged ${Math.round(bestAvg)} meetings for the last month. Consider blocking 90 min of focus time so the day isn't entirely reactive.`,
    action: {
      kind: 'navigate',
      label: 'Add a focus block',
      payload: { route: 'settings:focus-blocks' },
    },
    confidence: Math.min(0.9, 0.5 + (bestAvg - 5) * 0.05),
  };
}
