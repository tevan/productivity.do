import { Router } from 'express';
import { getDb, q } from '../db/init.js';
import * as todoist from '../lib/todoist.js';
import { autoScheduleTask, DEFAULT_WORK_HOURS, expandFocusBlocks } from '../lib/autoSchedule.js';
import * as google from '../lib/google.js';
import { emitEvent } from '../lib/webhooks.js';
import { recordRevision, listRevisions } from '../lib/revisions.js';

// Per-user Todoist token lives on users.todoist_token; falls back to env for
// backward compat with the original single-tenant deploy.

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/tasks — list all active tasks (cached in tasks_cache)
// ---------------------------------------------------------------------------
// Native tasks + projects (always present), plus tasks/projects synced
// from non-Todoist providers (Google Tasks, Notion, Linear, Trello, Microsoft
// To Do). Returned as the same shape as Todoist tasks so the SPA renders
// them uniformly. Provider is preserved on each task for source badges.
function nativeAndProviderTasks(userId) {
  const tasks = q(`
    SELECT 'native' AS provider, id, content, description, project_id,
           priority, due_date, due_datetime, estimated_minutes,
           local_status, local_position, parent_id, is_completed, NULL AS labels_json
    FROM tasks_native WHERE user_id = ? AND is_completed = 0
    UNION ALL
    SELECT provider, todoist_id AS id, content, description, project_id,
           priority, due_date, due_datetime, estimated_minutes,
           local_status, local_position, parent_id, is_completed, NULL AS labels_json
    FROM tasks_cache WHERE user_id = ? AND is_completed = 0 AND provider != 'todoist'
  `).all(userId, userId);
  const projects = q(`
    SELECT 'native' AS provider, id, name, color, is_favorite, position
    FROM projects_native WHERE user_id = ?
  `).all(userId);
  return {
    tasks: tasks.map(r => ({
      id: r.id,
      provider: r.provider,
      content: r.content,
      description: r.description,
      projectId: r.project_id,
      priority: r.priority,
      dueDate: r.due_date,
      dueDatetime: r.due_datetime,
      estimatedMinutes: r.estimated_minutes,
      localStatus: r.local_status,
      localPosition: r.local_position,
      parentId: r.parent_id,
      isCompleted: !!r.is_completed,
      labels: [],
    })),
    projects: projects.map(p => ({
      id: p.id,
      provider: p.provider,
      name: p.name,
      color: p.color,
      isFavorite: !!p.is_favorite,
      order: p.position,
    })),
  };
}

router.get('/api/tasks', async (req, res) => {
  try {
    const userId = req.user.id;
    const extras = nativeAndProviderTasks(userId);
    let tasks = [], projects = [];
    try {
      [tasks, projects] = await Promise.all([
        todoist.listTasks(userId),
        todoist.listProjects(userId).catch(() => []),
      ]);
    } catch (todoistErr) {
      // Todoist not configured — fine, native + other providers still work.
      console.warn('Todoist fetch failed:', todoistErr.message);
    }
    const projectMap = new Map(projects.map(p => [p.id, p]));
    const db = getDb();

    // Update cache
    const upsert = db.prepare(`
      INSERT INTO tasks_cache (user_id, todoist_id, content, description, project_id, priority, due_date, due_datetime, parent_id, is_completed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
      ON CONFLICT(user_id, todoist_id) DO UPDATE SET
        content = excluded.content,
        description = excluded.description,
        project_id = excluded.project_id,
        priority = excluded.priority,
        due_date = excluded.due_date,
        due_datetime = excluded.due_datetime,
        parent_id = excluded.parent_id,
        is_completed = 0,
        updated_at = datetime('now')
    `);

    const upsertMany = db.transaction((items) => {
      for (const t of items) {
        upsert.run(
          userId,
          t.id,
          t.content,
          t.description || null,
          t.project_id || null,
          t.priority || 1,
          t.due?.date || null,
          t.due?.datetime || null,
          t.parent_id || null
        );
      }
    });
    upsertMany(tasks);

    // Pull local-only fields (estimated_minutes, board status/position) to
    // merge into the live response. These never round-trip through Todoist.
    const localRows = q(
      'SELECT todoist_id, estimated_minutes, local_status, local_position FROM tasks_cache WHERE user_id = ?'
    ).all(userId);
    const localMap = new Map(localRows.map(r => [r.todoist_id, r]));

    const todoistTasks = tasks.map(t => ({
      id: t.id,
      provider: 'todoist',
      content: t.content,
      description: t.description,
      projectId: t.project_id,
      projectName: projectMap.get(t.project_id)?.name || null,
      priority: t.priority,
      dueDate: t.due?.date || null,
      dueDatetime: t.due?.datetime || null,
      dueString: t.due?.string || null,
      isRecurring: !!t.due?.is_recurring,
      estimatedMinutes: localMap.get(t.id)?.estimated_minutes || null,
      localStatus: localMap.get(t.id)?.local_status || null,
      localPosition: localMap.get(t.id)?.local_position ?? null,
      parentId: t.parent_id || null,
      labels: t.labels || [],
      url: t.url,
    }));
    const todoistProjects = projects.map(p => ({
      id: p.id,
      provider: 'todoist',
      name: p.name,
      color: p.color,
      parentId: p.parent_id,
      order: p.order,
      isFavorite: p.is_favorite,
    }));
    res.json({
      ok: true,
      tasks: [...todoistTasks, ...extras.tasks],
      projects: [...todoistProjects, ...extras.projects],
    });
  } catch (err) {
    console.error('GET /api/tasks error:', err.message);
    // Fall back to cache. Includes ALL providers (Todoist + others) since
    // they all live in tasks_cache. Native rows merge in via the helper.
    try {
      const rows = q('SELECT * FROM tasks_cache WHERE user_id = ? AND is_completed = 0 ORDER BY priority DESC, due_date').all(req.user.id);
      const extras = nativeAndProviderTasks(req.user.id);
      const cached = rows.map(r => ({
        id: r.todoist_id,
        provider: r.provider || 'todoist',
        content: r.content,
        description: r.description,
        projectId: r.project_id,
        projectName: r.project_name,
        priority: r.priority,
        dueDate: r.due_date,
        dueDatetime: r.due_datetime,
        estimatedMinutes: r.estimated_minutes || null,
        localStatus: r.local_status || null,
        localPosition: r.local_position ?? null,
        parentId: r.parent_id || null,
      }));
      // Filter native tasks out of the cached list so they aren't
      // duplicated — they come from extras.tasks.
      const cachedNonNative = cached.filter(t => t.provider !== 'native');
      res.json({
        ok: true,
        tasks: [...cachedNonNative, ...extras.tasks],
        projects: extras.projects,
      });
    } catch {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
});

// ---------------------------------------------------------------------------
// POST /api/tasks — create task
// ---------------------------------------------------------------------------
router.post('/api/tasks', async (req, res) => {
  try {
    const { content, description, projectId, priority, dueDate, dueDatetime, labels } = req.body;
    if (!content) {
      return res.status(400).json({ ok: false, error: 'content required' });
    }

    const taskBody = { content };
    if (description) taskBody.description = description;
    if (projectId) taskBody.project_id = projectId;
    if (priority) taskBody.priority = priority;
    if (dueDatetime) taskBody.due_datetime = dueDatetime;
    else if (dueDate) taskBody.due_date = dueDate;
    if (labels?.length) taskBody.labels = labels;

    const task = await todoist.createTask(taskBody, req.user.id);

    res.json({
      ok: true,
      task: {
        id: task.id,
        content: task.content,
        description: task.description,
        projectId: task.project_id,
        priority: task.priority,
        dueDate: task.due?.date || null,
        dueDatetime: task.due?.datetime || null,
        labels: task.labels || [],
        url: task.url,
      },
    });
  } catch (err) {
    console.error('POST /api/tasks error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/tasks/:id — update task
// ---------------------------------------------------------------------------
router.put('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      content, description, priority, dueDate, dueDatetime, labels, projectId,
      estimatedMinutes, localStatus, localPosition,
    } = req.body;

    // Snapshot the pre-update task for revision history. We pull from the
    // local cache (fast; doesn't double the Todoist round-trips). If the
    // cache row is missing (race after a fresh sync), we skip the
    // before-snapshot — the next update will record one. Recording is
    // best-effort; never blocks the user's edit.
    let _revBefore = null;
    try {
      const cached = q(
        'SELECT * FROM tasks_cache WHERE user_id = ? AND todoist_id = ?'
      ).get(req.user.id, id);
      if (cached) {
        _revBefore = {
          content: cached.content,
          priority: cached.priority,
          dueDate: cached.due_date || null,
          dueDatetime: cached.due_datetime || null,
          estimatedMinutes: cached.estimated_minutes || null,
          localStatus: cached.local_status || null,
        };
      }
    } catch {}

    // estimated_minutes lives only locally — persist directly without hitting Todoist.
    if (estimatedMinutes !== undefined) {
      const v = Number(estimatedMinutes);
      q(
        "UPDATE tasks_cache SET estimated_minutes = ?, updated_at = datetime('now') WHERE user_id = ? AND todoist_id = ?"
      ).run(Number.isFinite(v) && v > 0 ? Math.round(v) : null, req.user.id, id);
    }

    // Local board status: 'todo' | 'in_progress' | null. Done is NOT a valid
    // local status — completion is Todoist's domain (POST /api/tasks/:id/complete).
    if (localStatus !== undefined) {
      const allowed = new Set(['todo', 'in_progress', null]);
      const v = localStatus === '' ? null : localStatus;
      if (!allowed.has(v) && !/^custom_[A-Za-z0-9_-]{1,32}$/.test(v)) {
        return res.status(400).json({ ok: false, error: 'Invalid localStatus' });
      }
      const prev = q(
        'SELECT local_status FROM tasks_cache WHERE user_id = ? AND todoist_id = ?'
      ).get(req.user.id, id)?.local_status || null;
      q(
        "UPDATE tasks_cache SET local_status = ?, updated_at = datetime('now') WHERE user_id = ? AND todoist_id = ?"
      ).run(v, req.user.id, id);
      if (prev !== v) {
        // Fire-and-forget. Webhook subscribers can react to board moves
        // without polling. See docs/internal/tasks-board.md.
        emitEvent('task.moved', { id, fromStatus: prev, toStatus: v }, req.user.id).catch(() => {});
      }
    }
    if (localPosition !== undefined) {
      const v = Number(localPosition);
      q(
        "UPDATE tasks_cache SET local_position = ?, updated_at = datetime('now') WHERE user_id = ? AND todoist_id = ?"
      ).run(Number.isFinite(v) ? Math.round(v) : null, req.user.id, id);
    }

    const updates = {};
    if (content !== undefined) updates.content = content;
    if (description !== undefined) updates.description = description;
    if (priority !== undefined) updates.priority = priority;
    // Allow explicit clearing of due date with null
    if (dueDatetime !== undefined) updates.due_datetime = dueDatetime;
    else if (dueDate !== undefined) updates.due_date = dueDate;
    if (labels !== undefined) updates.labels = labels;

    let task = null;
    if (Object.keys(updates).length > 0) {
      task = await todoist.updateTask(id, updates, req.user.id);
    }

    // Estimation Intelligence: a "move to today" is intent-to-start. Record
    // started_at if the request set dueDate to today's local YMD AND no
    // started_at is recorded yet. We compute "today's YMD" with the user's
    // primary timezone (falls back to server tz) so a 11pm "move to today"
    // doesn't accidentally key off UTC and miss.
    if (dueDate !== undefined && dueDate) {
      try {
        const tzRow = q(
          "SELECT value FROM preferences WHERE user_id = ? AND key = 'primaryTimezone'"
        ).get(req.user.id);
        let tz = null;
        try { tz = tzRow?.value ? JSON.parse(tzRow.value) : null; } catch {}
        if (!tz || typeof tz !== 'string') {
          try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
          catch { tz = 'UTC'; }
        }
        const todayYmd = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date());
        if (dueDate === todayYmd) {
          q(`
            UPDATE tasks_cache
               SET started_at = COALESCE(started_at, datetime('now'))
             WHERE user_id = ? AND todoist_id = ?
          `).run(req.user.id, id);
        }
      } catch {} // estimation data is best-effort; never block the user's edit
    }

    // Project change is a separate Todoist endpoint
    if (projectId !== undefined && projectId !== null) {
      task = await todoist.moveTask(id, { projectId }, req.user.id);
    }

    // Read back local-only fields so the response is complete even when
    // only localStatus/localPosition changed (no Todoist call to merge from).
    const local = q(
      'SELECT estimated_minutes, local_status, local_position FROM tasks_cache WHERE user_id = ? AND todoist_id = ?'
    ).get(req.user.id, id);

    const responseTask = task ? {
      id: task.id,
      content: task.content,
      description: task.description,
      projectId: task.project_id,
      priority: task.priority,
      dueDate: task.due?.date || null,
      dueDatetime: task.due?.datetime || null,
      labels: task.labels || [],
      estimatedMinutes: local?.estimated_minutes || null,
      localStatus: local?.local_status || null,
      localPosition: local?.local_position ?? null,
    } : {
      id,
      estimatedMinutes: local?.estimated_minutes || null,
      localStatus: local?.local_status || null,
      localPosition: local?.local_position ?? null,
    };

    // Record the revision after the write. Snapshot is the projection
    // we just sent to the client so 'restore' can replay it verbatim.
    if (_revBefore) {
      try {
        recordRevision({
          userId: req.user.id, resource: 'tasks', resourceId: id, op: 'update',
          before: _revBefore,
          after: {
            content: responseTask.content ?? _revBefore.content,
            priority: responseTask.priority ?? _revBefore.priority,
            dueDate: responseTask.dueDate ?? null,
            dueDatetime: responseTask.dueDatetime ?? null,
            estimatedMinutes: responseTask.estimatedMinutes,
            localStatus: responseTask.localStatus,
          },
        });
      } catch {}
    }

    res.json({ ok: true, task: responseTask });
  } catch (err) {
    console.error('PUT /api/tasks error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/complete — complete task
// ---------------------------------------------------------------------------
router.post('/api/tasks/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    // Snapshot before flipping so the revision (and the synthesis layer's
    // age-at-completion query) has the prior shape.
    const before = q(
      'SELECT content, priority, due_date, due_datetime, estimated_minutes, created_at, started_at FROM tasks_cache WHERE user_id = ? AND todoist_id = ?'
    ).get(req.user.id, id);

    await todoist.completeTask(id, req.user.id);

    // Compute actual_minutes from started_at if we have it. Clamp 1..480
    // (8 hours) so a task left "started" overnight doesn't poison the
    // historical ratio. Tasks completed without a started_at remain NULL,
    // which the accuracy-badge SQL filters on.
    let actualMinutes = null;
    if (before?.started_at) {
      const startMs = new Date(before.started_at).getTime();
      if (Number.isFinite(startMs)) {
        const minutes = Math.round((Date.now() - startMs) / 60_000);
        if (minutes > 0) actualMinutes = Math.min(480, minutes);
      }
    }

    q(
      "UPDATE tasks_cache SET is_completed = 1, completed_at = datetime('now'), actual_minutes = ?, updated_at = datetime('now') WHERE user_id = ? AND todoist_id = ?"
    ).run(actualMinutes, req.user.id, id);

    // Record the completion in revisions so the activity feed + weekly review
    // see it. Idempotent failure-tolerant — the task is already completed.
    if (before) {
      try {
        recordRevision({
          userId: req.user.id,
          resource: 'tasks',
          resourceId: id,
          op: 'complete',
          before: { isCompleted: false },
          after: {
            isCompleted: true,
            content: before.content,
            priority: before.priority,
            dueDate: before.due_date,
            dueDatetime: before.due_datetime,
            estimatedMinutes: before.estimated_minutes,
          },
        });
      } catch {}
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/tasks/:id/complete error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/reopen — reopen task
// ---------------------------------------------------------------------------
router.post('/api/tasks/:id/reopen', async (req, res) => {
  try {
    const { id } = req.params;
    await todoist.reopenTask(id, req.user.id);

    q(
      "UPDATE tasks_cache SET is_completed = 0, completed_at = NULL, actual_minutes = NULL, updated_at = datetime('now') WHERE user_id = ? AND todoist_id = ?"
    ).run(req.user.id, id);

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/tasks/:id/reopen error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/tasks/:id — delete task
// ---------------------------------------------------------------------------
router.delete('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await todoist.deleteTask(id, req.user.id);

    q('DELETE FROM tasks_cache WHERE user_id = ? AND todoist_id = ?').run(req.user.id, id);

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/tasks/:id error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/tasks/projects — list Todoist projects
// ---------------------------------------------------------------------------
router.get('/api/tasks/projects', async (req, res) => {
  try {
    const projects = await todoist.listProjects(req.user.id);
    res.json({
      ok: true,
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        parentId: p.parent_id,
        order: p.order,
        isFavorite: p.is_favorite,
      })),
    });
  } catch (err) {
    console.error('GET /api/tasks/projects error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/auto-schedule — find next free slot in work hours and
// create a Google Calendar event for the task. Best-effort: if Google isn't
// connected we just block the task to its work-hours window in the response.
// Body: { estimatedMinutes?, calendarId?, calendarIds?: string[], bufferMin? }
// ---------------------------------------------------------------------------
router.post('/api/tasks/:id/auto-schedule', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { estimatedMinutes, calendarId, calendarIds, bufferMin, timezone: bodyTz } = req.body || {};

    if (!google.isConnected(userId)) {
      return res.status(400).json({ ok: false, error: 'Google Calendar not connected' });
    }

    // Find the task in cache (we don't trust the body alone — the task must
    // belong to this user). Fall back to Todoist API if not cached yet.
    let row = q('SELECT * FROM tasks_cache WHERE user_id = ? AND todoist_id = ?').get(userId, id);
    if (!row) {
      try {
        const t = await todoist.getTask(id, req.user.id);
        if (t) {
          row = {
            todoist_id: t.id,
            content: t.content,
            description: t.description || null,
            due_date: t.due?.date || null,
            due_datetime: t.due?.datetime || null,
          };
        }
      } catch {}
    }
    if (!row) return res.status(404).json({ ok: false, error: 'Task not found' });

    // Pick target calendar: explicit, then user's primary.
    let targetCal = calendarId;
    if (!targetCal) {
      const primary = q(
        'SELECT id FROM calendars WHERE user_id = ? AND primary_cal = 1 LIMIT 1'
      ).get(userId);
      targetCal = primary?.id || 'primary';
    }
    // Calendars to treat as "busy" — default to all visible calendars for the
    // user, so we don't double-book against any of them.
    let busyCalIds = calendarIds;
    if (!busyCalIds || !busyCalIds.length) {
      busyCalIds = q(
        'SELECT id FROM calendars WHERE user_id = ? AND visible = 1'
      ).all(userId).map(r => r.id);
      if (!busyCalIds.length) busyCalIds = [targetCal];
    }

    // Pull work hours + timezone from preferences (per-user, JSON-encoded).
    const prefRows = q(
      'SELECT key, value FROM preferences WHERE user_id = ? AND key IN (?, ?)'
    ).all(userId, 'workHours', 'primaryTimezone');
    const prefs = Object.fromEntries(prefRows.map(r => [r.key, safeJson(r.value)]));
    const workHours = prefs.workHours || DEFAULT_WORK_HOURS;
    // Timezone fallback chain: request body (browser-detected) → user pref →
    // server's actual tz → UTC. Falling back to UTC alone misaligned 9-5 work
    // hours by the server-tz offset, causing "no free slot" errors.
    // Validate every candidate — a malformed tz string would crash wallToUtc
    // (Intl.DateTimeFormat throws RangeError on bad input).
    const isValidTz = (tz) => {
      if (!tz || typeof tz !== 'string') return false;
      try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
      catch { return false; }
    };
    let timezone =
      (isValidTz(bodyTz) && bodyTz) ||
      (isValidTz(prefs.primaryTimezone) && prefs.primaryTimezone) ||
      null;
    if (!timezone) {
      try {
        const serverTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        timezone = isValidTz(serverTz) ? serverTz : 'UTC';
      } catch { timezone = 'UTC'; }
    }

    // Treat focus blocks as busy so we don't schedule on top of them.
    const focusRows = q(
      'SELECT weekday, start_time, end_time FROM focus_blocks WHERE user_id = ?'
    ).all(userId);
    const extraBusy = expandFocusBlocks(focusRows, timezone, 14);

    const result = await autoScheduleTask({
      userId,
      task: {
        id: row.todoist_id,
        content: row.content,
        description: row.description,
        estimatedMinutes: Number(estimatedMinutes) || row.estimated_minutes || 30,
        dueDate: row.due_date,
      },
      calendarId: targetCal,
      calendarIds: busyCalIds,
      workHours,
      timezone,
      bufferMin: Number(bufferMin) || 10,
      extraBusy,
    });

    if (!result.ok) return res.status(409).json(result);

    // Update Todoist due_datetime to match the scheduled time so the task
    // shows up at the right moment in the sidebar/views without a re-sync.
    // Also record started_at = the event's scheduled start; actual_minutes
    // gets computed at completion as (completed_at - started_at).
    try {
      await todoist.updateTask(id, { due_datetime: result.startIso }, req.user.id);
      q(
        "UPDATE tasks_cache SET due_datetime = ?, started_at = ?, updated_at = datetime('now') WHERE user_id = ? AND todoist_id = ?"
      ).run(result.startIso, result.startIso, userId, id);
    } catch (err) {
      // Non-fatal: the calendar event was created successfully even if
      // Todoist push failed (e.g. token expired). Surface the warning.
      console.warn('auto-schedule: Todoist update failed:', err.message);
      // Still record started_at locally even if Todoist push failed —
      // the GCal event exists and that's what determines intent-to-start.
      q(
        "UPDATE tasks_cache SET started_at = ?, updated_at = datetime('now') WHERE user_id = ? AND todoist_id = ?"
      ).run(result.startIso, userId, id);
    }

    res.json({
      ok: true,
      startIso: result.startIso,
      endIso: result.endIso,
      eventId: result.event?.id,
      calendarId: targetCal,
    });
  } catch (err) {
    console.error('POST /api/tasks/:id/auto-schedule error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Per-user Todoist token management
// ---------------------------------------------------------------------------
router.get('/api/tasks/integration', (req, res) => {
  const row = q('SELECT todoist_token FROM users WHERE id = ?').get(req.user.id);
  const hasToken = !!row?.todoist_token;
  const envFallback = !hasToken && !!process.env.TODOIST_API_TOKEN;
  res.json({
    ok: true,
    todoist: {
      connected: hasToken || envFallback,
      perUser: hasToken,
      // Never reveal the token itself.
    },
  });
});

router.post('/api/tasks/integration', async (req, res) => {
  try {
    const { todoistToken } = req.body || {};
    if (typeof todoistToken !== 'string' || todoistToken.length < 10) {
      return res.status(400).json({ ok: false, error: 'Token looks invalid' });
    }
    const valid = await todoist.validateToken(todoistToken);
    if (!valid) return res.status(400).json({ ok: false, error: 'Todoist rejected this token' });
    q('UPDATE users SET todoist_token = ? WHERE id = ?').run(todoistToken, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/api/tasks/integration', (req, res) => {
  q('UPDATE users SET todoist_token = NULL WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Projects — full CRUD on top of the existing GET /api/tasks/projects.
// ---------------------------------------------------------------------------
router.post('/api/tasks/projects', async (req, res) => {
  try {
    const { name, color, parentId, isFavorite } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ ok: false, error: 'name required' });
    const project = await todoist.createProject({ name: name.trim(), color, parentId, isFavorite }, req.user.id);
    res.json({ ok: true, project });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.put('/api/tasks/projects/:id', async (req, res) => {
  try {
    const project = await todoist.updateProject(req.params.id, req.body || {}, req.user.id);
    res.json({ ok: true, project });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.delete('/api/tasks/projects/:id', async (req, res) => {
  try {
    await todoist.deleteProject(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Sections — Todoist columns within a project.
// ---------------------------------------------------------------------------
router.get('/api/tasks/sections', async (req, res) => {
  try {
    const sections = await todoist.listSections({ projectId: req.query.projectId }, req.user.id);
    res.json({
      ok: true,
      sections: sections.map(s => ({
        id: s.id,
        name: s.name,
        projectId: s.project_id,
        order: s.order,
      })),
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/api/tasks/sections', async (req, res) => {
  try {
    const { name, projectId, order } = req.body || {};
    if (!name?.trim() || !projectId) return res.status(400).json({ ok: false, error: 'name + projectId required' });
    const section = await todoist.createSection({ name: name.trim(), projectId, order }, req.user.id);
    res.json({ ok: true, section });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.put('/api/tasks/sections/:id', async (req, res) => {
  try {
    const section = await todoist.updateSection(req.params.id, req.body || {}, req.user.id);
    res.json({ ok: true, section });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.delete('/api/tasks/sections/:id', async (req, res) => {
  try {
    await todoist.deleteSection(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Labels — full CRUD. Tasks reference labels by string name; this manages
// the registry (rename, recolor, delete).
// ---------------------------------------------------------------------------
router.get('/api/tasks/labels', async (req, res) => {
  try {
    const labels = await todoist.listLabels(req.user.id);
    res.json({
      ok: true,
      labels: labels.map(l => ({
        id: l.id,
        name: l.name,
        color: l.color,
        order: l.order,
        isFavorite: l.is_favorite,
      })),
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/api/tasks/labels', async (req, res) => {
  try {
    const { name, color, isFavorite } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ ok: false, error: 'name required' });
    const label = await todoist.createLabel({ name: name.trim(), color, isFavorite }, req.user.id);
    res.json({ ok: true, label });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.put('/api/tasks/labels/:id', async (req, res) => {
  try {
    const label = await todoist.updateLabel(req.params.id, req.body || {}, req.user.id);
    res.json({ ok: true, label });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.delete('/api/tasks/labels/:id', async (req, res) => {
  try {
    await todoist.deleteLabel(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Filters (read-only, Todoist Pro). Returns [] silently on free accounts.
// ---------------------------------------------------------------------------
router.get('/api/tasks/filters', async (req, res) => {
  try {
    const filters = await todoist.listFilters(req.user.id);
    res.json({ ok: true, filters });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Comments — per-task threaded comments.
// ---------------------------------------------------------------------------
router.get('/api/tasks/:id/comments', async (req, res) => {
  try {
    const comments = await todoist.listTaskComments(req.params.id, req.user.id);
    res.json({
      ok: true,
      comments: comments.map(c => ({
        id: c.id,
        content: c.content,
        postedAt: c.posted_at,
        attachment: c.attachment || null,
      })),
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/api/tasks/:id/comments', async (req, res) => {
  try {
    const { content } = req.body || {};
    if (!content?.trim()) return res.status(400).json({ ok: false, error: 'content required' });
    const comment = await todoist.createTaskComment({ taskId: req.params.id, content: content.trim() }, req.user.id);
    res.json({ ok: true, comment });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.put('/api/tasks/comments/:id', async (req, res) => {
  try {
    const { content } = req.body || {};
    if (!content?.trim()) return res.status(400).json({ ok: false, error: 'content required' });
    const comment = await todoist.updateComment(req.params.id, content.trim(), req.user.id);
    res.json({ ok: true, comment });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.delete('/api/tasks/comments/:id', async (req, res) => {
  try {
    await todoist.deleteComment(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Quick-add — natural-language task creation. "Buy milk tomorrow @errands p1"
// → fully-structured task with parsed due date, label, priority.
// ---------------------------------------------------------------------------
router.post('/api/tasks/quick', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ ok: false, error: 'text required' });
    const task = await todoist.quickAddTask(text.trim(), req.user.id);
    res.json({
      ok: true,
      task: {
        id: task.id,
        content: task.content,
        description: task.description,
        projectId: task.project_id,
        priority: task.priority,
        dueDate: task.due?.date || null,
        dueDatetime: task.due?.datetime || null,
        labels: task.labels || [],
      },
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Reminders (Pro). Returns [] silently on free accounts.
// ---------------------------------------------------------------------------
router.get('/api/tasks/reminders', async (req, res) => {
  try {
    const reminders = await todoist.listReminders(req.user.id);
    res.json({ ok: true, reminders });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Bulk update — apply the same patch (or per-item patches) to many tasks.
// Body: { items: [{ id, ...patch }] }. Returns per-id results.
// ---------------------------------------------------------------------------
router.put('/api/tasks/bulk', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items) return res.status(400).json({ ok: false, error: 'items array required' });
    if (items.length > 100) return res.status(400).json({ ok: false, error: 'max 100 items per request' });
    const results = await todoist.bulkUpdateTasks(items, req.user.id);
    res.json({ ok: true, results });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

function safeJson(s) {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
}

// ---- Revision history ----------------------------------------------------
// GET a single task by id. Reads from tasks_cache (the local mirror); the
// activity feed uses this to hydrate the editor when the user clicks a
// row. Returns 404 if the task no longer exists locally — the caller
// falls back to the read-only deleted-record viewer in that case.
router.get('/api/tasks/:id', (req, res) => {
  const row = q(`
    SELECT todoist_id AS id, content, description, due_date AS dueDate,
           due_datetime AS dueDatetime, priority, project_id AS projectId,
           project_name AS projectName, parent_id AS parentId,
           is_completed AS isCompleted, estimated_minutes AS estimatedMinutes,
           local_status AS localStatus, local_position AS localPosition,
           color
      FROM tasks_cache
     WHERE user_id = ? AND todoist_id = ?
  `).get(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Task not found' });
  res.json({ ok: true, task: { ...row, isCompleted: !!row.isCompleted, labels: [] } });
});

router.get('/api/tasks/:id/revisions', (req, res) => {
  const revisions = listRevisions({
    userId: req.user.id, resource: 'tasks', resourceId: req.params.id,
  });
  res.json({ ok: true, revisions });
});

router.post('/api/tasks/:id/revisions/:revId/restore', async (req, res) => {
  try {
    const db = getDb();
    const rev = db.prepare(`
      SELECT after_json FROM revisions
       WHERE id = ? AND user_id = ? AND resource = 'tasks' AND resource_id = ?
    `).get(req.params.revId, req.user.id, req.params.id);
    if (!rev || !rev.after_json) return res.status(404).json({ ok: false, error: 'Revision not found' });
    let snap;
    try { snap = JSON.parse(rev.after_json); } catch { return res.status(500).json({ ok: false, error: 'Bad revision' }); }

    // Replay through the same Todoist update path so the upstream is
    // reverted alongside the local cache.
    const updates = {};
    if (snap.content !== undefined) updates.content = snap.content;
    if (snap.priority !== undefined) updates.priority = snap.priority;
    if (snap.dueDatetime !== undefined && snap.dueDatetime !== null) updates.due_datetime = snap.dueDatetime;
    else if (snap.dueDate !== undefined) updates.due_date = snap.dueDate;
    let task = null;
    if (Object.keys(updates).length > 0) {
      task = await todoist.updateTask(req.params.id, updates, req.user.id);
    }
    if (snap.estimatedMinutes !== undefined) {
      const v = Number(snap.estimatedMinutes);
      q("UPDATE tasks_cache SET estimated_minutes = ?, updated_at = datetime('now') WHERE user_id = ? AND todoist_id = ?")
        .run(Number.isFinite(v) && v > 0 ? Math.round(v) : null, req.user.id, req.params.id);
    }
    if (snap.localStatus !== undefined) {
      q("UPDATE tasks_cache SET local_status = ?, updated_at = datetime('now') WHERE user_id = ? AND todoist_id = ?")
        .run(snap.localStatus, req.user.id, req.params.id);
    }

    recordRevision({
      userId: req.user.id, resource: 'tasks', resourceId: req.params.id,
      op: 'restore', before: null, after: snap,
    });
    res.json({ ok: true, task });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
