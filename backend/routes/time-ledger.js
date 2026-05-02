import { Router } from 'express';
import { q } from '../db/init.js';

const router = Router();

/**
 * GET /api/time-ledger — synthesis #4: planned vs. actual hours.
 *
 * The Calendar pillar's stake. Sums event durations per calendar (the user's
 * own categorization — Work, Personal, etc.) for the past N weeks and returns
 * a per-week × per-category matrix plus a 12-week per-category sparkline.
 *
 * "Planned" = scheduled events on the user's visible calendars.
 * "Actual"  = scheduled events whose end_time has passed (i.e. they happened
 *             unless explicitly cancelled). We don't have an "I attended"
 *             toggle; in practice the calendar IS the actual unless the user
 *             declined or the event was cancelled.
 *
 * Default window: 12 weeks ending this week (inclusive). Tunable via ?weeks=N.
 *
 * Response shape:
 *   {
 *     ok: true,
 *     weeks: 12,
 *     timezone: 'America/Denver',
 *     range: { start: '2026-02-09', end: '2026-05-04' },
 *     categories: [
 *       { id: 'cal-id', name: 'Work', color: '#…',
 *         totalHours: 162.5,            // last N weeks
 *         lastWeekHours: 19.0,
 *         priorWeekAvgHours: 16.2,      // baseline = mean of weeks 2..N
 *         deltaHours: 2.8,              // lastWeek - priorWeekAvg
 *         deltaPct: 17,                 // 0..N rounded
 *         sparkline: [w0..w11]          // hours per week, oldest → newest
 *       }
 *     ],
 *     totals: { lastWeekHours, priorWeekAvgHours, deltaHours, sparkline },
 *     headline: { tone, text }          // one sentence framed observation
 *   }
 */
router.get('/api/time-ledger', async (req, res) => {
  try {
    const userId = req.user.id;
    const weeks = clamp(parseInt(req.query.weeks, 10) || 12, 4, 52);

    // ---- Resolve timezone (mirrors today.js) ----
    const prefRows = q(
      'SELECT key, value FROM preferences WHERE user_id = ? AND key = ?'
    ).all(userId, 'primaryTimezone');
    let timezone = null;
    for (const r of prefRows) {
      try { timezone = JSON.parse(r.value); } catch { timezone = r.value; }
    }
    if (!timezone || !isValidTz(timezone)) {
      try {
        const serverTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        timezone = isValidTz(serverTz) ? serverTz : 'UTC';
      } catch { timezone = 'UTC'; }
    }

    // ---- Compute Monday-anchored week buckets in user's tz ----
    const now = new Date();
    const todayYmd = ymdInTz(now, timezone);
    // Monday of this week (week-start). Then walk back N-1 weeks.
    const thisMondayYmd = mondayOf(todayYmd, timezone);
    const buckets = []; // [{start: Date(UTC), end: Date(UTC), key: 'YYYY-MM-DD'}]
    for (let i = weeks - 1; i >= 0; i--) {
      const startYmd = addDays(thisMondayYmd, -7 * i);
      const endYmd = addDays(startYmd, 7); // exclusive
      const start = wallToUtc(startYmd, '00:00', timezone);
      const end = wallToUtc(endYmd, '00:00', timezone);
      buckets.push({ start, end, key: startYmd });
    }
    const rangeStart = buckets[0].start;
    const rangeEnd = buckets[buckets.length - 1].end;

    // ---- Visible calendars become categories ----
    const calRows = q(
      'SELECT id, summary, color FROM calendars WHERE user_id = ? AND visible = 1 ORDER BY summary'
    ).all(userId);
    const calMap = new Map();
    for (const c of calRows) {
      calMap.set(c.id, {
        id: c.id,
        name: c.summary || '(untitled calendar)',
        color: c.color || null,
        weekHours: new Array(weeks).fill(0),
      });
    }

    // ---- Pull events in window from cache, status not cancelled ----
    const evs = q(`
      SELECT calendar_id, start_time, end_time, all_day, status
        FROM events_cache
       WHERE user_id = ?
         AND end_time >= ?
         AND start_time < ?
    `).all(userId, rangeStart.toISOString(), rangeEnd.toISOString());

    for (const e of evs) {
      const cal = calMap.get(e.calendar_id);
      if (!cal) continue; // hidden calendar — skip
      if (e.status === 'cancelled') continue;
      if (e.all_day) continue; // all-day items aren't "time spent"

      const sMs = new Date(e.start_time).getTime();
      const eMs = new Date(e.end_time).getTime();
      if (!Number.isFinite(sMs) || !Number.isFinite(eMs) || eMs <= sMs) continue;

      // Distribute event duration across week buckets it overlaps.
      // Most events live entirely in one week, but cross-week overnight
      // bookings or multi-day non-all-day events do happen.
      for (let i = 0; i < buckets.length; i++) {
        const b = buckets[i];
        const bStart = b.start.getTime();
        const bEnd = b.end.getTime();
        const overlap = Math.max(0, Math.min(eMs, bEnd) - Math.max(sMs, bStart));
        if (overlap > 0) cal.weekHours[i] += overlap / 3_600_000;
      }
    }

    // ---- Roll up into category records ----
    const categories = [];
    for (const cal of calMap.values()) {
      const total = cal.weekHours.reduce((a, b) => a + b, 0);
      if (total < 0.05 && cal.weekHours.every(h => h < 0.05)) continue; // empty cat
      const lastWeek = cal.weekHours[weeks - 1];
      // Prior baseline: mean of weeks [0..N-1) excluding the current week.
      // If N=12, that's an 11-week mean.
      const baselineSlice = cal.weekHours.slice(0, weeks - 1);
      const baselineAvg = baselineSlice.length
        ? baselineSlice.reduce((a, b) => a + b, 0) / baselineSlice.length
        : 0;
      const delta = lastWeek - baselineAvg;
      const deltaPct = baselineAvg > 0
        ? Math.round((delta / baselineAvg) * 100)
        : (lastWeek > 0 ? 100 : 0);
      categories.push({
        id: cal.id,
        name: cal.name,
        color: cal.color,
        totalHours: round1(total),
        lastWeekHours: round1(lastWeek),
        priorWeekAvgHours: round1(baselineAvg),
        deltaHours: round1(delta),
        deltaPct,
        sparkline: cal.weekHours.map(round1),
      });
    }
    // Largest first.
    categories.sort((a, b) => b.totalHours - a.totalHours);

    // ---- Totals row ----
    const totalSpark = new Array(weeks).fill(0);
    for (const cat of categories) {
      for (let i = 0; i < weeks; i++) totalSpark[i] += cat.sparkline[i];
    }
    const lastWeekTotal = totalSpark[weeks - 1];
    const baselineTotalAvg = (totalSpark.slice(0, weeks - 1).reduce((a, b) => a + b, 0) /
      Math.max(1, weeks - 1));
    const totals = {
      lastWeekHours: round1(lastWeekTotal),
      priorWeekAvgHours: round1(baselineTotalAvg),
      deltaHours: round1(lastWeekTotal - baselineTotalAvg),
      sparkline: totalSpark.map(round1),
    };

    // ---- Headline ----
    // One sentence. The most striking change first; falls back to total.
    const headline = composeLedgerHeadline(categories, totals);

    res.json({
      ok: true,
      weeks,
      timezone,
      range: {
        start: ymdInTz(rangeStart, timezone),
        end: ymdInTz(rangeEnd, timezone),
      },
      categories,
      totals,
      headline,
    });
  } catch (err) {
    console.error('GET /api/time-ledger error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function round1(n) { return Math.round(n * 10) / 10; }

function isValidTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
}

function ymdInTz(d, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function weekdayInTz(ymd, tz) {
  const probe = new Date(`${ymd}T12:00:00Z`);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
    .format(probe);
  return { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[wd] ?? 0;
}

function mondayOf(ymd, tz) {
  const wd = weekdayInTz(ymd, tz);
  const back = wd === 0 ? 6 : wd - 1; // Sun → 6 days back
  return addDays(ymd, -back);
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const Y = dt.getUTCFullYear();
  const M = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const D = String(dt.getUTCDate()).padStart(2, '0');
  return `${Y}-${M}-${D}`;
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

function composeLedgerHeadline(categories, totals) {
  if (categories.length === 0) {
    return { tone: 'neutral', text: 'No scheduled time on visible calendars yet.' };
  }
  // Find the largest absolute delta among categories with meaningful baseline.
  let pick = null;
  for (const c of categories) {
    if (c.priorWeekAvgHours < 1.0) continue;
    if (Math.abs(c.deltaHours) < 1.0) continue;
    if (!pick || Math.abs(c.deltaHours) > Math.abs(pick.deltaHours)) pick = c;
  }
  if (pick) {
    const dir = pick.deltaHours > 0 ? 'up' : 'down';
    const tone = pick.deltaHours > 0 ? 'concern' : 'good';
    const abs = Math.abs(pick.deltaHours).toFixed(1);
    return {
      tone,
      text: `${pick.name} time is ${dir} ${abs}h vs your ${pick.sparkline.length - 1}-week baseline.`,
    };
  }
  // Fallback to total
  if (Math.abs(totals.deltaHours) >= 1.0) {
    const dir = totals.deltaHours > 0 ? 'up' : 'down';
    const abs = Math.abs(totals.deltaHours).toFixed(1);
    return {
      tone: totals.deltaHours > 0 ? 'concern' : 'good',
      text: `Total scheduled time is ${dir} ${abs}h vs your baseline.`,
    };
  }
  return {
    tone: 'neutral',
    text: `${totals.lastWeekHours.toFixed(1)}h scheduled this week, in line with your baseline.`,
  };
}

export default router;
