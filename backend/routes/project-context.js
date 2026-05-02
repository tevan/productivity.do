// Project page's data endpoint. Mirrors /api/notes/:id/context in spirit:
// one call hydrates everything the project page needs to render — tasks,
// linked events, linked notes, time-spent slice, momentum, and the
// project's metadata (due date, intent line, rhythm, pin state).
//
// Project IDs accepted in two forms:
//   - Todoist string id (the common case)
//   - 'native:<int>' for native projects in projects_native
//
// We don't proxy through Todoist for the project name itself — we trust
// the local mirror via tasks_cache.project_name (cheap and avoids a
// roundtrip just for a string).

import { Router } from 'express';
import { q } from '../db/init.js';
import { getProjectMomentum } from '../lib/projects.js';
import * as todoist from '../lib/todoist.js';

const router = Router();

router.get('/api/projects/:id/context', async (req, res) => {
  try {
    const userId = req.user.id;
    const projectId = String(req.params.id);
    if (!projectId) return res.status(400).json({ ok: false, error: 'projectId required' });

    // ---- Resolve project identity ----
    // Try Todoist first (live; gives name + color + favorite + order + parent).
    // Fall back to native, then to local cache string lookup.
    let name = null, color = null, isFavorite = false, order = null, parentId = null;
    let source = null;

    if (projectId.startsWith('native:')) {
      const nid = parseInt(projectId.slice('native:'.length), 10);
      const row = q(`
        SELECT name, color, is_favorite, position
          FROM projects_native
         WHERE user_id = ? AND id = ?
      `).get(userId, nid);
      if (row) {
        name = row.name; color = row.color;
        isFavorite = !!row.is_favorite; order = row.position;
        source = 'native';
      }
    } else {
      try {
        const projects = await todoist.listProjects(userId);
        const p = projects.find(x => String(x.id) === projectId);
        if (p) {
          name = p.name; color = p.color;
          isFavorite = !!p.is_favorite; order = p.order; parentId = p.parent_id;
          source = 'todoist';
        }
      } catch {}
    }
    // Fallback: just use the cached project_name from any task in this project.
    if (!name) {
      const row = q(`
        SELECT project_name FROM tasks_cache
         WHERE user_id = ? AND project_id = ?
         LIMIT 1
      `).get(userId, projectId);
      if (row?.project_name) {
        name = row.project_name;
        source = 'cache';
      }
    }
    if (!name) return res.status(404).json({ ok: false, error: 'Project not found' });

    // ---- Project metadata (productivity.do-owned) ----
    const metaRow = q(`
      SELECT due_date, intent_line, rhythm_json, pinned_at
        FROM project_meta
       WHERE user_id = ? AND project_id = ?
    `).get(userId, projectId);
    const meta = {
      dueDate: metaRow?.due_date || null,
      intentLine: metaRow?.intent_line || null,
      rhythm: parseJson(metaRow?.rhythm_json),
      pinnedAt: metaRow?.pinned_at || null,
    };

    // ---- Tasks in this project ----
    const taskRows = q(`
      SELECT todoist_id AS id, content, description, due_date AS dueDate,
             due_datetime AS dueDatetime, priority, is_completed AS isCompleted,
             estimated_minutes AS estimatedMinutes, local_status AS localStatus,
             completed_at AS completedAt, created_at AS createdAt,
             parent_id AS parentId
        FROM tasks_cache
       WHERE user_id = ? AND project_id = ?
       ORDER BY is_completed ASC, priority DESC, due_date ASC
    `).all(userId, projectId);
    const tasks = taskRows.map(t => ({
      ...t,
      isCompleted: !!t.isCompleted,
    }));

    // ---- Momentum ----
    const momentumMap = getProjectMomentum(userId);
    const momentum = momentumMap.get(projectId) || {
      momentum: tasks.length === 0 ? 'idle' : 'stalled',
      lastCompletedAt: null,
      openCount: tasks.filter(t => !t.isCompleted).length,
      completed7d: 0,
    };

    // ---- Linked events (via the bidirectional links table) ----
    // Tasks aren't typically linked to events; events ARE typically
    // associated with a calendar (not a project). For the project page
    // we surface events that match the project name in summary OR have
    // an explicit links row. Heuristic match keeps the page useful when
    // users haven't manually linked anything yet.
    const events = listLinkedEvents(userId, projectId, name);

    // ---- Linked notes (via links table) ----
    const notes = listLinkedNotes(userId, projectId);

    // ---- Time spent (rough) ----
    // Sum of actual_minutes on completed tasks in this project, plus
    // event durations whose summary matches the project name (very rough,
    // optional). We don't aggregate from the calendars — that's the
    // Time Ledger surface; here we just want a quick total.
    const sumRow = q(`
      SELECT
        SUM(CASE WHEN is_completed = 1 AND actual_minutes IS NOT NULL
                 THEN actual_minutes ELSE 0 END) AS task_minutes,
        SUM(CASE WHEN is_completed = 1 AND actual_minutes IS NOT NULL
                 AND completed_at >= datetime('now', '-7 days')
                 THEN actual_minutes ELSE 0 END) AS task_minutes_7d
        FROM tasks_cache
       WHERE user_id = ? AND project_id = ?
    `).get(userId, projectId);
    const timeSpent = {
      taskMinutesTotal: Number(sumRow?.task_minutes || 0),
      taskMinutes7d: Number(sumRow?.task_minutes_7d || 0),
    };

    res.json({
      ok: true,
      project: {
        id: projectId,
        name, color, isFavorite, order, parentId, source,
      },
      meta,
      momentum,
      tasks,
      events,
      notes,
      timeSpent,
    });
  } catch (err) {
    console.error('GET /api/projects/:id/context error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function parseJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function listLinkedEvents(userId, projectId, projectName) {
  // Explicit links: any (note|task in this project)→event link, or an
  // event→project link if we ever add one. For the v1 we surface events
  // explicitly linked to a TASK in this project.
  const rows = q(`
    SELECT DISTINCT ec.calendar_id, ec.google_event_id, ec.summary,
           ec.start_time AS startTime, ec.end_time AS endTime, ec.location
      FROM events_cache ec
      JOIN links l ON (
        l.user_id = ec.user_id
        AND ((l.from_type = 'event' AND l.from_id = ec.calendar_id || '|' || ec.google_event_id)
          OR (l.to_type   = 'event' AND l.to_id   = ec.calendar_id || '|' || ec.google_event_id))
      )
      JOIN tasks_cache tc ON tc.user_id = ec.user_id AND (
            (l.from_type = 'task' AND l.from_id = tc.todoist_id)
         OR (l.to_type   = 'task' AND l.to_id   = tc.todoist_id)
      )
     WHERE ec.user_id = ? AND tc.project_id = ?
     ORDER BY ec.start_time DESC
     LIMIT 20
  `).all(userId, projectId);
  return rows.map(r => ({
    calendarId: r.calendar_id,
    eventId: r.google_event_id,
    summary: r.summary,
    start: r.startTime,
    end: r.endTime,
    location: r.location,
  }));
}

function listLinkedNotes(userId, projectId) {
  // Notes linked to tasks in this project, via the links table.
  const rows = q(`
    SELECT DISTINCT n.id, n.title, n.body, n.updated_at AS updatedAt
      FROM notes n
      JOIN links l ON (
        l.user_id = n.user_id
        AND ((l.from_type = 'note' AND l.from_id = CAST(n.id AS TEXT))
          OR (l.to_type   = 'note' AND l.to_id   = CAST(n.id AS TEXT)))
      )
      JOIN tasks_cache tc ON tc.user_id = n.user_id AND (
            (l.from_type = 'task' AND l.from_id = tc.todoist_id)
         OR (l.to_type   = 'task' AND l.to_id   = tc.todoist_id)
      )
     WHERE n.user_id = ? AND tc.project_id = ?
       AND n.deleted_at IS NULL
     ORDER BY n.updated_at DESC
     LIMIT 20
  `).all(userId, projectId);
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    bodyPreview: (r.body || '').slice(0, 140),
    updatedAt: r.updatedAt,
  }));
}

export default router;
