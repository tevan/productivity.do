/**
 * Minimal ICS file generator. RFC 5545 lite — sufficient for "Add to Calendar"
 * integrations on confirmation emails and download buttons.
 */

function fmt(date) {
  // 20260429T150000Z
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) + 'Z'
  );
}

function escape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

// RFC 5545 §3.1 requires lines to be ≤ 75 *octets* (UTF-8 bytes), not characters.
// We use 73 to leave headroom for the CRLF. Multi-byte UTF-8 (emoji, CJK) means
// counting characters can blow past the limit; this version counts bytes and
// slices on whole-codepoint boundaries so we never split a UTF-8 sequence.
function fold(line) {
  const MAX_OCTETS = 73;
  const enc = new TextEncoder();
  if (enc.encode(line).length <= MAX_OCTETS) return line;

  const chunks = [];
  let buf = '';
  let bufBytes = 0;
  // Iterate by Unicode code points (the for...of iterator yields whole code
  // points, including surrogate pairs as a single string).
  for (const ch of line) {
    const chBytes = enc.encode(ch).length;
    if (bufBytes + chBytes > MAX_OCTETS) {
      chunks.push(buf);
      buf = ch;
      bufBytes = chBytes;
    } else {
      buf += ch;
      bufBytes += chBytes;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.join('\r\n ');
}

/**
 * Build a multi-VEVENT VCALENDAR. Used by the user's calendar-subscription
 * feed. `events` is an array of plain objects with the same fields as
 * buildIcs() takes.
 */
export function buildIcsFeed({ name, events }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//productivity.do//Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(name || 'productivity.do')}`,
  ];
  for (const ev of events) {
    if (!ev.start || !ev.end) continue;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.uid || ev.id || Math.random().toString(36).slice(2)}@productivity.do`);
    lines.push(`DTSTAMP:${fmt(new Date())}`);
    lines.push(`DTSTART:${fmt(ev.start)}`);
    lines.push(`DTEND:${fmt(ev.end)}`);
    if (ev.summary) lines.push(`SUMMARY:${escape(ev.summary)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escape(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${escape(ev.location)}`);
    if (ev.url) lines.push(`URL:${ev.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function buildIcs({ uid, summary, description, start, end, location, organizer, attendee, url }) {
  const now = fmt(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//productivity.do//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@productivity.do`,
    `DTSTAMP:${now}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${escape(summary)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${escape(description)}`);
  if (location) lines.push(`LOCATION:${escape(location)}`);
  if (organizer) lines.push(`ORGANIZER;CN=${escape(organizer.name || organizer.email)}:mailto:${organizer.email}`);
  if (attendee) {
    lines.push(`ATTENDEE;CN=${escape(attendee.name || attendee.email)};RSVP=TRUE:mailto:${attendee.email}`);
  }
  if (url) lines.push(`URL:${url}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/**
 * Add-to-calendar URL builders.
 */
export function googleCalendarUrl({ summary, description, start, end, location }) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: summary || '',
    dates: `${fmt(start)}/${fmt(end)}`,
  });
  if (description) params.set('details', description);
  if (location) params.set('location', location);
  return `https://www.google.com/calendar/render?${params.toString()}`;
}

export function outlookUrl({ summary, description, start, end, location }) {
  // Outlook live deep-link
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: summary || '',
    startdt: new Date(start).toISOString(),
    enddt: new Date(end).toISOString(),
  });
  if (description) params.set('body', description);
  if (location) params.set('location', location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}
