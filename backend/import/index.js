// Import dispatch — picks the parser by filename + content sniffing,
// then writes the parsed records to the user's native tables.

import { randomUUID } from 'crypto';
import { q } from '../db/init.js';
import { parseIcs } from './ics/parser.js';
import { parseCsvFile } from './csv/parser.js';
import { parseTodoistBackup } from './todoist-backup/parser.js';
import { parseMarkdown } from './markdown/parser.js';

export function detectFormat(filename, contentSample) {
  const lower = filename.toLowerCase();
  const head = (contentSample || '').slice(0, 200).trim();
  if (lower.endsWith('.ics') || head.startsWith('BEGIN:VCALENDAR')) return 'ics';
  if (lower.endsWith('.csv') || /^[^,\n]+,[^,\n]+/.test(head)) return 'csv';
  if (lower.endsWith('.json') && head.includes('"items"') && head.includes('"projects"')) return 'todoist-backup';
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) return 'markdown';
  return null;
}

export function parseAny(filename, text, hint = null) {
  const format = detectFormat(filename, text);
  if (!format) throw Object.assign(new Error('Could not detect file format'), { code: 'unknown_format' });
  if (format === 'ics') return { format, ...parseIcs(text) };
  if (format === 'csv') return { format, ...parseCsvFile(text, hint) };
  if (format === 'todoist-backup') return { format, ...parseTodoistBackup(text) };
  if (format === 'markdown') return { format, ...parseMarkdown(text, filename) };
  return { format, events: [], tasks: [], notes: [] };
}

// Write parsed records to the user's native tables. Returns counts.
// Wrapped in a single transaction so a partial failure doesn't leave
// half-imported data.
import { getDb } from '../db/init.js';
export function writeNative(userId, parsed) {
  const db = getDb();
  let counts = { events: 0, tasks: 0, projects: 0, notes: 0 };
  const tx = db.transaction(() => {
    // Projects first so tasks can reference them. Map old->new ids.
    const projectIdMap = new Map();
    if (parsed.projects?.length) {
      const ins = db.prepare(`
        INSERT INTO projects_native (id, user_id, name, color, is_favorite, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      let pos = q('SELECT COALESCE(MAX(position), 0) AS m FROM projects_native WHERE user_id = ?')
        .get(userId)?.m || 0;
      for (const p of parsed.projects) {
        const id = randomUUID();
        ins.run(id, userId, String(p.name || 'Untitled'),
                p.color || null, p.isFavorite ? 1 : 0, ++pos);
        if (p.sourceId) projectIdMap.set(p.sourceId, id);
        counts.projects++;
      }
    }
    if (parsed.events?.length) {
      const ins = db.prepare(`
        INSERT INTO events_native
          (id, user_id, summary, description, location, start_at, end_at, all_day)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const e of parsed.events) {
        if (!e.start) continue;
        ins.run(randomUUID(), userId,
                String(e.summary || '(untitled)'),
                e.description || null,
                e.location || null,
                e.start, e.end || e.start, e.allDay ? 1 : 0);
        counts.events++;
      }
    }
    if (parsed.tasks?.length) {
      const ins = db.prepare(`
        INSERT INTO tasks_native
          (id, user_id, content, description, project_id, priority,
           due_date, due_datetime, labels_json, is_completed, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const t of parsed.tasks) {
        const projId = t.sourceProjectId ? projectIdMap.get(t.sourceProjectId) : null;
        ins.run(randomUUID(), userId,
                String(t.content || ''),
                t.description || null,
                projId,
                Number(t.priority) || 1,
                t.dueDate || null,
                t.dueDatetime || null,
                Array.isArray(t.labels) ? JSON.stringify(t.labels) : null,
                t.isCompleted ? 1 : 0,
                t.isCompleted ? new Date().toISOString() : null);
        counts.tasks++;
      }
    }
    if (parsed.notes?.length) {
      const ins = db.prepare(`
        INSERT INTO notes (user_id, title, body, pinned)
        VALUES (?, ?, ?, ?)
      `);
      for (const n of parsed.notes) {
        ins.run(userId,
                String(n.title || 'Untitled'),
                String(n.body || ''),
                n.pinned ? 1 : 0);
        counts.notes++;
      }
    }
  });
  tx();
  return counts;
}
