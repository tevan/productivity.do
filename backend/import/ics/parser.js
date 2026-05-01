// ICS parser — handles RFC 5545 well enough to extract VEVENTs as native
// events. We DON'T expand RRULE here: the master event lands in the
// import; the user can re-recur it inside the app if they want.
//
// Reuses the lightweight parsing pattern already in routes/subscriptions.js
// rather than pulling in a heavy ical library.

export function parseIcs(text) {
  if (!text || typeof text !== 'string') return { events: [], tasks: [], notes: [] };
  const events = [];
  const tasks = [];

  // Unfold continuation lines per RFC 5545 §3.1.
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n').split('\n');

  let cur = null;
  let kind = null;
  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) {
      cur = {};
      kind = 'event';
      continue;
    }
    if (line.startsWith('BEGIN:VTODO')) {
      cur = {};
      kind = 'todo';
      continue;
    }
    if (line.startsWith('END:VEVENT') || line.startsWith('END:VTODO')) {
      if (cur && kind === 'event') events.push(toEvent(cur));
      if (cur && kind === 'todo') tasks.push(toTask(cur));
      cur = null;
      kind = null;
      continue;
    }
    if (!cur) continue;
    const [rawKey, ...rest] = line.split(':');
    const value = rest.join(':');
    const key = rawKey.split(';')[0]; // strip param suffix (TZID etc.)
    if (key === 'SUMMARY') cur.summary = value;
    else if (key === 'DESCRIPTION') cur.description = value.replace(/\\n/g, '\n');
    else if (key === 'LOCATION') cur.location = value;
    else if (key === 'DTSTART') cur.dtstart = { raw: value, allDay: !value.includes('T') };
    else if (key === 'DTEND')   cur.dtend   = { raw: value, allDay: !value.includes('T') };
    else if (key === 'DUE')     cur.due     = { raw: value };
    else if (key === 'STATUS')  cur.status  = value;
    else if (key === 'UID')     cur.uid     = value;
  }

  return { events: events.filter(Boolean), tasks: tasks.filter(Boolean), notes: [] };
}

function parseDate(raw) {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (!hh) return `${y}-${mo}-${d}`;
  return `${y}-${mo}-${d}T${hh}:${mm}:${ss}${z ? 'Z' : ''}`;
}

function toEvent(o) {
  if (!o.dtstart) return null;
  const start = parseDate(o.dtstart.raw);
  let end = parseDate(o.dtend?.raw) || start;
  // Inclusive→exclusive trim for all-day events on import — keep it simple,
  // store start=end for single-day events; user can edit afterward.
  return {
    summary: o.summary || '(untitled)',
    description: o.description || null,
    location: o.location || null,
    start,
    end,
    allDay: !!o.dtstart.allDay,
  };
}

function toTask(o) {
  return {
    content: o.summary || '(untitled)',
    description: o.description || null,
    dueDate: o.due ? parseDate(o.due.raw)?.slice(0, 10) || null : null,
    isCompleted: o.status === 'COMPLETED',
  };
}
