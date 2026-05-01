// CSV parser — handles the most common shapes for tasks and events.
//
// Expected columns (case-insensitive, alternative names accepted):
//   Tasks:  title|content|name, due|due_date, priority, status|completed,
//           description|notes
//   Events: summary|title, start|start_date|date, end|end_date,
//           location, description, all_day
//
// We pick the schema based on which column header appears. CSV with both
// "due" and "start" treats "due" as a hint for tasks but lets the caller
// disambiguate via &kind=tasks|events query param.

function parseCsv(text) {
  // Minimal RFC 4180 parser — handles quoted fields with embedded commas
  // and double-quote escapes. Newlines inside quoted fields are also fine.
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur);
        if (row.length > 1 || row[0]) rows.push(row);
        row = [];
        cur = '';
      } else cur += c;
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function pick(headers, ...names) {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
}

export function parseCsvFile(text, hint = null) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { events: [], tasks: [], notes: [] };
  const headers = rows[0];

  const tEventStart = pick(headers, 'start', 'start_date', 'date', 'starts');
  const tTaskTitle = pick(headers, 'title', 'content', 'name', 'task');

  const isEvents = hint === 'events' || (hint !== 'tasks' && tEventStart !== -1);
  const isTasks = hint === 'tasks' || (hint !== 'events' && tTaskTitle !== -1 && tEventStart === -1);

  const events = [], tasks = [];
  if (isEvents) {
    const idxSummary = pick(headers, 'summary', 'title', 'name', 'event');
    const idxStart = tEventStart;
    const idxEnd = pick(headers, 'end', 'end_date', 'ends');
    const idxLoc = pick(headers, 'location', 'where');
    const idxDesc = pick(headers, 'description', 'notes', 'details');
    const idxAll = pick(headers, 'all_day', 'allday');
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r.length) continue;
      const start = idxStart !== -1 ? r[idxStart]?.trim() : '';
      if (!start) continue;
      const end = idxEnd !== -1 ? r[idxEnd]?.trim() : '';
      const allDay = idxAll !== -1 ? truthy(r[idxAll]) : !start.includes('T') && !start.includes(':');
      events.push({
        summary: idxSummary !== -1 ? r[idxSummary]?.trim() || '(untitled)' : '(untitled)',
        description: idxDesc !== -1 ? r[idxDesc]?.trim() || null : null,
        location: idxLoc !== -1 ? r[idxLoc]?.trim() || null : null,
        start: normalizeDate(start, allDay),
        end: normalizeDate(end || start, allDay),
        allDay,
      });
    }
  } else if (isTasks) {
    const idxTitle = tTaskTitle;
    const idxDue = pick(headers, 'due', 'due_date', 'duedate');
    const idxPri = pick(headers, 'priority');
    const idxStatus = pick(headers, 'status', 'completed', 'done');
    const idxDesc = pick(headers, 'description', 'notes');
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r.length) continue;
      const title = idxTitle !== -1 ? r[idxTitle]?.trim() : '';
      if (!title) continue;
      tasks.push({
        content: title,
        description: idxDesc !== -1 ? r[idxDesc]?.trim() || null : null,
        dueDate: idxDue !== -1 ? normalizeDate(r[idxDue]?.trim() || '', true) : null,
        priority: idxPri !== -1 ? clampPri(r[idxPri]?.trim()) : 1,
        isCompleted: idxStatus !== -1 ? truthy(r[idxStatus]) : false,
      });
    }
  }
  return { events, tasks, notes: [] };
}

function truthy(v) {
  if (!v) return false;
  const s = String(v).toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'completed' || s === 'done';
}
function clampPri(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(4, n));
}
function normalizeDate(raw, allDay) {
  if (!raw) return null;
  // Accept ISO already; otherwise parse via Date and format.
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  if (allDay) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  return d.toISOString();
}
