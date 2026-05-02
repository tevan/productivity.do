import { Router } from 'express';
import { q } from '../db/init.js';
import { getTaskRatio, getProjectRatios, getGlobalRatio } from '../lib/estimation.js';

const router = Router();

/**
 * GET /api/notes/:id/context — Notes pillar's "Live Context Panel".
 *
 * Returns the dynamic surrounding context for a note: linked event(s) with
 * countdown/elapsed, linked tasks with status, and (when Estimation Intelligence
 * has data) a per-project estimation callout. Zero AI by default — pure SQL +
 * existing in-memory caches. Cheap on every note open.
 *
 * Resolution model:
 *   - Look up `links` rows where (from_type='note', from_id=:id) and the
 *     reverse (to_type='note', to_id=:id) so links from EITHER direction
 *     count.
 *   - Linked events: hydrate from events_cache (Google) joining on
 *     "{calendarId}|{eventId}".
 *   - Linked tasks: hydrate from tasks_cache by Todoist id.
 *   - Project for the note: derived from the most-recent linked task's
 *     project_name (Notes don't have a project column today).
 *
 * Response shape:
 *   {
 *     ok: true,
 *     event: null | { calendarId, eventId, summary, start, end, location,
 *                     state: 'upcoming'|'inProgress'|'past',
 *                     countdownMs?, elapsedMs?, durationMin },
 *     tasks: [ { id, content, dueDate, dueDatetime, priority, isCompleted,
 *                isOverdue, projectName } ],
 *     project: null | { name, openTaskCount, overdueCount, completed7d,
 *                       estimation?: { ratio, samples, sentence } }
 *   }
 */
router.get('/api/notes/:id/context', async (req, res) => {
  try {
    const userId = req.user.id;
    const noteId = String(req.params.id);

    // ---- Validate the note belongs to this user ----
    const note = q('SELECT id FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
      .get(noteId, userId);
    if (!note) {
      return res.status(404).json({ ok: false, error: 'Note not found' });
    }

    // ---- Linked rows in either direction ----
    const fwd = q(`
      SELECT to_type AS t, to_id AS id FROM links
       WHERE user_id = ? AND from_type = 'note' AND from_id = ?
    `).all(userId, noteId);
    const rev = q(`
      SELECT from_type AS t, from_id AS id FROM links
       WHERE user_id = ? AND to_type = 'note' AND to_id = ?
    `).all(userId, noteId);
    const all = [...fwd, ...rev];

    const eventIds = [];
    const taskIds = [];
    for (const r of all) {
      if (r.t === 'event') eventIds.push(r.id);
      else if (r.t === 'task') taskIds.push(r.id);
    }

    // ---- Event hydration (most-relevant single event) ----
    const events = [];
    for (const ref of eventIds) {
      const idx = ref.indexOf('|');
      if (idx < 0) continue;
      const calId = ref.slice(0, idx);
      const eventId = ref.slice(idx + 1);
      const ev = q(`
        SELECT calendar_id, google_event_id, summary, location,
               start_time, end_time, all_day
          FROM events_cache
         WHERE user_id = ? AND google_event_id = ? AND calendar_id = ?
      `).get(userId, eventId, calId);
      if (ev) events.push(ev);
    }
    // Choose the most relevant event: in-progress > nearest upcoming > most-recent past.
    const now = Date.now();
    let pick = null;
    let pickScore = Infinity;
    for (const ev of events) {
      const s = new Date(ev.start_time).getTime();
      const e = new Date(ev.end_time).getTime();
      let score;
      if (s <= now && now < e) score = 0; // happening now
      else if (s > now) score = (s - now) + 1; // upcoming
      else score = (now - e) + 1e15;          // past — push back
      if (score < pickScore) { pickScore = score; pick = ev; }
    }

    let event = null;
    if (pick) {
      const s = new Date(pick.start_time).getTime();
      const e = new Date(pick.end_time).getTime();
      const durationMin = Math.max(1, Math.round((e - s) / 60_000));
      let state, countdownMs, elapsedMs;
      if (now < s) { state = 'upcoming'; countdownMs = s - now; }
      else if (now < e) { state = 'inProgress'; elapsedMs = now - s; countdownMs = e - now; }
      else { state = 'past'; elapsedMs = now - e; }
      event = {
        calendarId: pick.calendar_id,
        eventId: pick.google_event_id,
        summary: pick.summary,
        start: pick.start_time,
        end: pick.end_time,
        location: pick.location || null,
        state,
        countdownMs: countdownMs ?? null,
        elapsedMs: elapsedMs ?? null,
        durationMin,
      };
    }

    // ---- Task hydration ----
    let tasks = [];
    if (taskIds.length) {
      const placeholders = taskIds.map(() => '?').join(',');
      const rows = q(`
        SELECT todoist_id, content, due_date, due_datetime, priority,
               is_completed, project_name, estimated_minutes
          FROM tasks_cache
         WHERE user_id = ? AND todoist_id IN (${placeholders})
      `).all(userId, ...taskIds);
      const todayMs = startOfTodayLocal();
      for (const r of rows) {
        const dueMs = r.due_datetime
          ? new Date(r.due_datetime).getTime()
          : (r.due_date ? new Date(`${r.due_date}T00:00:00`).getTime() : null);
        const isOverdue = !r.is_completed && dueMs != null && dueMs < todayMs;
        tasks.push({
          id: r.todoist_id,
          content: r.content,
          dueDate: r.due_date,
          dueDatetime: r.due_datetime,
          priority: r.priority,
          isCompleted: !!r.is_completed,
          isOverdue,
          projectName: r.project_name,
          estimatedMinutes: r.estimated_minutes,
        });
      }
      // Order: overdue first, then incomplete by due, then completed last.
      tasks.sort((a, b) => {
        if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        const ad = a.dueDatetime || a.dueDate || '';
        const bd = b.dueDatetime || b.dueDate || '';
        return ad.localeCompare(bd);
      });
    }

    // ---- Project rollup ----
    // We use the most-common project_name across linked tasks as the note's
    // implicit project. This mirrors how users actually work — they link a
    // bunch of tasks from the same project to a note before they ever name
    // it explicitly.
    let project = null;
    const projCounts = new Map();
    for (const t of tasks) {
      if (!t.projectName) continue;
      projCounts.set(t.projectName, (projCounts.get(t.projectName) || 0) + 1);
    }
    let topProject = null;
    let topN = 0;
    for (const [name, n] of projCounts) {
      if (n > topN) { topProject = name; topN = n; }
    }
    if (topProject) {
      const stats = q(`
        SELECT
          SUM(CASE WHEN is_completed = 0 OR is_completed IS NULL THEN 1 ELSE 0 END) AS open_count,
          SUM(CASE WHEN (is_completed = 0 OR is_completed IS NULL) AND
                       ((due_datetime IS NOT NULL AND due_datetime < datetime('now')) OR
                        (due_date IS NOT NULL AND due_date < date('now')))
                   THEN 1 ELSE 0 END) AS overdue_count,
          SUM(CASE WHEN is_completed = 1 AND completed_at IS NOT NULL AND
                        completed_at >= datetime('now', '-7 days')
                   THEN 1 ELSE 0 END) AS completed_7d
          FROM tasks_cache
         WHERE user_id = ? AND project_name = ?
      `).get(userId, topProject) || {};
      project = {
        name: topProject,
        openTaskCount: Number(stats.open_count || 0),
        overdueCount: Number(stats.overdue_count || 0),
        completed7d: Number(stats.completed_7d || 0),
      };

      // Estimation callout: project ratio if available, else global, else null.
      const projectRatios = getProjectRatios(userId);
      const projR = projectRatios.get(topProject);
      const globR = projR ? null : getGlobalRatio(userId);
      const r = projR || globR;
      if (r && (r.ratio >= 1.3 || r.ratio <= 0.7)) {
        const verb = r.ratio >= 1.3 ? 'take longer than your estimate' : 'finish faster than your estimate';
        project.estimation = {
          ratio: Number(r.ratio.toFixed(2)),
          samples: r.samples,
          source: projR ? 'project' : 'global',
          sentence: projR
            ? `Tasks in "${topProject}" usually ${verb} (${r.ratio.toFixed(1)}× over ${r.samples} runs).`
            : `Across all tasks you usually ${verb} (${r.ratio.toFixed(1)}× over ${r.samples} runs).`,
        };
      }
    }

    res.json({ ok: true, event, tasks, project });
  } catch (err) {
    console.error('GET /api/notes/:id/context error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function startOfTodayLocal() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default router;
