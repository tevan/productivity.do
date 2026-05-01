// Parse an all-day date string (YYYY-MM-DD) as LOCAL midnight, not UTC.
// `new Date('2026-04-30')` gives UTC midnight, which in tz west of UTC
// shifts the date back a day — making single-day events span 2-3 cols
// and tasks due "today" appear overdue right after midnight local time.
export function parseAllDayDate(s) {
  if (!s) return new Date(NaN);
  if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  return new Date(s);
}

// Todoist project colors come back as named tokens (e.g. 'charcoal', 'blue').
// Browsers don't recognize Todoist's names as CSS colors, so map to hex.
// Source: Todoist Sync API color reference. Names not in the map fall back
// to the value itself (in case a real CSS color is supplied).
const TODOIST_COLOR_MAP = {
  berry_red: '#b8255f', red: '#db4035', orange: '#ff9933',
  yellow: '#fad000', olive_green: '#afb83b', lime_green: '#7ecc49',
  green: '#299438', mint_green: '#6accbc', teal: '#158fad',
  sky_blue: '#14aaf5', light_blue: '#96c3eb', blue: '#4073ff',
  grape: '#884dff', violet: '#af38eb', lavender: '#eb96eb',
  magenta: '#e05194', salmon: '#ff8d85', charcoal: '#808080',
  grey: '#b8b8b8', gray: '#b8b8b8', taupe: '#ccac93',
};
export function todoistColor(name) {
  if (!name) return null;
  if (typeof name === 'string' && name.startsWith('#')) return name;
  return TODOIST_COLOR_MAP[name] || null;
}

// Bucket each Todoist color name into one of the 12 palette slots so we can
// optionally route it through the active color scheme's CSS vars (--color-X).
// Each scheme defines all 12 slots, so a project that was "berry_red" can
// still distinguish itself from one that was "blue" — but both pick up the
// scheme's hue. This is the cheap way to make Todoist projects feel native
// to the chosen scheme without an explicit per-project re-color UI.
const TODOIST_COLOR_TO_SLOT = {
  berry_red: 'rose',     red: 'rose',           orange: 'peach',
  yellow: 'butter',      olive_green: 'sage',   lime_green: 'mint',
  green: 'mint',         mint_green: 'mint',    teal: 'sky',
  sky_blue: 'sky',       light_blue: 'powder',  blue: 'sky',
  grape: 'lavender',     violet: 'lilac',       lavender: 'lavender',
  magenta: 'blush',      salmon: 'coral',       charcoal: 'cloud',
  grey: 'cloud',         gray: 'cloud',         taupe: 'peach',
};
export function todoistColorThemed(name) {
  if (!name) return null;
  if (typeof name === 'string' && name.startsWith('#')) return name;
  const slot = TODOIST_COLOR_TO_SLOT[name];
  if (!slot) return TODOIST_COLOR_MAP[name] || null;
  return `var(--color-${slot}, ${TODOIST_COLOR_MAP[name] || '#888'})`;
}

// Parse a task's due date — picks dueDatetime (full ISO) when present,
// otherwise treats dueDate as a local-midnight date string. Centralizes
// the YYYY-MM-DD parsing so we never accidentally use the UTC-parsed Date.
export function parseTaskDue(task) {
  if (!task) return null;
  if (task.dueDatetime) return new Date(task.dueDatetime);
  if (task.dueDate) return parseAllDayDate(task.dueDate);
  return null;
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function startOfWeek(date, startDay = 'monday') {
  const d = new Date(date);
  const day = d.getDay();
  const target = startDay === 'sunday' ? 0 : 1;
  const diff = (day - target + 7) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addWeeks(date, weeks) {
  return addDays(date, weeks * 7);
}

export function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// Convert any locale-formatted "10:30 AM" → "10:30am" (lowercase, no space).
// Use to post-process toLocaleString output that includes a meridiem.
export function lowerAmPm(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/\s*(AM|PM)\b/g, (_, m) => m.toLowerCase());
}

export function formatTime(date, format12h = true) {
  const d = new Date(date);
  if (format12h) {
    let h = d.getHours();
    const m = d.getMinutes();
    // House style: lowercase am/pm with no space (e.g. "10:30am").
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, '0')}${ampm}`;
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatDateRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const opts = { month: 'short', day: 'numeric' };
  if (sameMonth) {
    return `${s.toLocaleDateString('en-US', opts)} - ${e.getDate()}, ${s.getFullYear()}`;
  }
  const sameYear = s.getFullYear() === e.getFullYear();
  if (sameYear) {
    return `${s.toLocaleDateString('en-US', opts)} - ${e.toLocaleDateString('en-US', opts)}, ${s.getFullYear()}`;
  }
  return `${s.toLocaleDateString('en-US', { ...opts, year: 'numeric' })} - ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}

export function getViewRange(view, date, prefs = {}) {
  const d = startOfDay(date);
  switch (view) {
    case 'day':
      return { start: d, end: endOfDay(d) };
    case 'nextdays': {
      const count = prefs.nextDaysCount || 5;
      return { start: d, end: endOfDay(addDays(d, count - 1)) };
    }
    case 'week': {
      const weekStart = startOfWeek(d, prefs.weekStartDay || 'monday');
      return { start: weekStart, end: endOfDay(addDays(weekStart, 6)) };
    }
    case 'month': {
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const monthStart = startOfWeek(first, prefs.weekStartDay || 'monday');
      const monthEnd = addDays(startOfWeek(addDays(last, 6), prefs.weekStartDay || 'monday'), 6);
      return { start: monthStart, end: endOfDay(monthEnd) };
    }
    default:
      return { start: d, end: endOfDay(addDays(d, 4)) };
  }
}

export function isSameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate();
}

export function isToday(date) {
  return isSameDay(date, new Date());
}

export function isPast(date) {
  return new Date(date) < new Date();
}

export function getHourSlots() {
  return Array.from({ length: 24 }, (_, i) => i);
}

export function getWeekDays(startDate, count = 7) {
  return Array.from({ length: count }, (_, i) => addDays(startDate, i));
}

export function getDayName(date, short = true) {
  return new Date(date).toLocaleDateString('en-US', { weekday: short ? 'short' : 'long' });
}

export function getMonthName(date, short = false) {
  return new Date(date).toLocaleDateString('en-US', { month: short ? 'short' : 'long' });
}

export function getMonthGrid(date, weekStartDay = 'monday') {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const gridStart = startOfWeek(first, weekStartDay);
  const rows = [];
  let current = new Date(gridStart);
  while (current <= last || rows.length < 5) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(current));
      current = addDays(current, 1);
    }
    rows.push(week);
    if (rows.length >= 6) break;
  }
  return rows;
}
