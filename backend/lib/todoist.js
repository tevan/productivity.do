import { getDb } from '../db/init.js';

const BASE_URL = 'https://api.todoist.com/api/v1';

/**
 * Resolve a Todoist token. If userId is provided, look up the user's stored
 * token first; otherwise (and for legacy callers) fall back to the env var.
 */
function getToken(userId) {
  if (userId) {
    try {
      const row = getDb().prepare('SELECT todoist_token FROM users WHERE id = ?').get(userId);
      if (row?.todoist_token) return row.todoist_token;
    } catch {}
  }
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) throw new Error('Todoist not connected — add a token in Settings → Tasks.');
  return token;
}

async function todoistFetch(path, options = {}, userId = null) {
  const token = getToken(userId);
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Todoist API ${res.status}: ${text}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

/**
 * List all active tasks.
 * v1 API returns { results: [...], next_cursor: '...' } — pages of 50 by
 * default. Loop through cursors so we return everything (capped at 1000 to
 * guard against runaway accounts).
 */
export async function listTasks(userId = null) {
  const all = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const path = cursor ? `/tasks?limit=200&cursor=${encodeURIComponent(cursor)}` : '/tasks?limit=200';
    const data = await todoistFetch(path, {}, userId);
    const page = Array.isArray(data) ? data : (data?.results || []);
    all.push(...page);
    cursor = data && !Array.isArray(data) ? (data.next_cursor || null) : null;
    if (!cursor || page.length === 0) break;
  }
  return all;
}

export async function getTask(id, userId = null) {
  return todoistFetch(`/tasks/${encodeURIComponent(id)}`, {}, userId);
}

export async function listProjects(userId = null) {
  const data = await todoistFetch('/projects', {}, userId);
  return Array.isArray(data) ? data : (data?.results || []);
}

export async function createTask(task, userId = null) {
  return todoistFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify(task),
  }, userId);
}

export async function updateTask(id, updates, userId = null) {
  return todoistFetch(`/tasks/${id}`, {
    method: 'POST',
    body: JSON.stringify(updates),
  }, userId);
}

export async function completeTask(id, userId = null) {
  return todoistFetch(`/tasks/${id}/close`, { method: 'POST' }, userId);
}

export async function reopenTask(id, userId = null) {
  return todoistFetch(`/tasks/${id}/reopen`, { method: 'POST' }, userId);
}

export async function deleteTask(id, userId = null) {
  return todoistFetch(`/tasks/${id}`, { method: 'DELETE' }, userId);
}

export async function moveTask(id, { projectId, sectionId, parentId } = {}, userId = null) {
  const body = {};
  if (projectId) body.project_id = projectId;
  if (sectionId) body.section_id = sectionId;
  if (parentId) body.parent_id = parentId;
  return todoistFetch(`/tasks/${id}/move`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, userId);
}

// ---------------------------------------------------------------------------
// Projects (CRUD beyond list)
// ---------------------------------------------------------------------------

export async function createProject({ name, color, parentId, isFavorite } = {}, userId = null) {
  const body = { name };
  if (color) body.color = color;
  if (parentId) body.parent_id = parentId;
  if (typeof isFavorite === 'boolean') body.is_favorite = isFavorite;
  return todoistFetch('/projects', { method: 'POST', body: JSON.stringify(body) }, userId);
}

export async function updateProject(id, updates = {}, userId = null) {
  // Todoist v1 sync API uses POST to project_id endpoint for partial update.
  const body = {};
  if (updates.name !== undefined) body.name = updates.name;
  if (updates.color !== undefined) body.color = updates.color;
  if (typeof updates.isFavorite === 'boolean') body.is_favorite = updates.isFavorite;
  return todoistFetch(`/projects/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, userId);
}

export async function deleteProject(id, userId = null) {
  return todoistFetch(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }, userId);
}

// ---------------------------------------------------------------------------
// Sections — horizontal columns within a Todoist project. Many users
// organize this way (e.g. "Backlog / This week / Doing").
// ---------------------------------------------------------------------------

export async function listSections({ projectId } = {}, userId = null) {
  const path = projectId
    ? `/sections?project_id=${encodeURIComponent(projectId)}`
    : '/sections';
  const data = await todoistFetch(path, {}, userId);
  return Array.isArray(data) ? data : (data?.results || []);
}

export async function createSection({ name, projectId, order } = {}, userId = null) {
  const body = { name, project_id: projectId };
  if (typeof order === 'number') body.order = order;
  return todoistFetch('/sections', { method: 'POST', body: JSON.stringify(body) }, userId);
}

export async function updateSection(id, updates = {}, userId = null) {
  const body = {};
  if (updates.name !== undefined) body.name = updates.name;
  return todoistFetch(`/sections/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, userId);
}

export async function deleteSection(id, userId = null) {
  return todoistFetch(`/sections/${encodeURIComponent(id)}`, { method: 'DELETE' }, userId);
}

// ---------------------------------------------------------------------------
// Labels — Todoist's label registry. Tasks reference labels by name; this
// is the management API for renaming/recoloring/deleting labels themselves.
// ---------------------------------------------------------------------------

export async function listLabels(userId = null) {
  const data = await todoistFetch('/labels', {}, userId);
  return Array.isArray(data) ? data : (data?.results || []);
}

export async function createLabel({ name, color, isFavorite } = {}, userId = null) {
  const body = { name };
  if (color) body.color = color;
  if (typeof isFavorite === 'boolean') body.is_favorite = isFavorite;
  return todoistFetch('/labels', { method: 'POST', body: JSON.stringify(body) }, userId);
}

export async function updateLabel(id, updates = {}, userId = null) {
  const body = {};
  if (updates.name !== undefined) body.name = updates.name;
  if (updates.color !== undefined) body.color = updates.color;
  if (typeof updates.isFavorite === 'boolean') body.is_favorite = updates.isFavorite;
  return todoistFetch(`/labels/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, userId);
}

export async function deleteLabel(id, userId = null) {
  return todoistFetch(`/labels/${encodeURIComponent(id)}`, { method: 'DELETE' }, userId);
}

// ---------------------------------------------------------------------------
// Filters — Todoist saved filters ("today | overdue", "p1 & @work").
// Read-only here; users create/edit filters in Todoist itself. We use them
// as alternate group-by sources in the sidebar.
// On free Todoist accounts the endpoint may return an empty list or 403;
// callers should treat any error as "no filters available".
// ---------------------------------------------------------------------------

export async function listFilters(userId = null) {
  try {
    const data = await todoistFetch('/filters', {}, userId);
    return Array.isArray(data) ? data : (data?.results || []);
  } catch (err) {
    // Pro-only — silently degrade.
    if (/Todoist API 4\d{2}/.test(err.message)) return [];
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Comments — per-task threaded notes. Used by the in-app TaskEditor's
// comments panel.
// ---------------------------------------------------------------------------

export async function listTaskComments(taskId, userId = null) {
  const data = await todoistFetch(
    `/comments?task_id=${encodeURIComponent(taskId)}`,
    {},
    userId,
  );
  return Array.isArray(data) ? data : (data?.results || []);
}

export async function createTaskComment({ taskId, content } = {}, userId = null) {
  return todoistFetch('/comments', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId, content }),
  }, userId);
}

export async function updateComment(id, content, userId = null) {
  return todoistFetch(`/comments/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  }, userId);
}

export async function deleteComment(id, userId = null) {
  return todoistFetch(`/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }, userId);
}

// ---------------------------------------------------------------------------
// Quick add — Todoist's natural-language parser. "Buy milk tomorrow at 5pm
// @errands p1" → fully-structured task with date, label, priority. We use
// it for the toolbar's quick-add bar.
// ---------------------------------------------------------------------------

export async function quickAddTask(text, userId = null) {
  return todoistFetch('/tasks/quick', {
    method: 'POST',
    body: JSON.stringify({ text }),
  }, userId);
}

// ---------------------------------------------------------------------------
// Reminders — Todoist Pro feature (paid). Free accounts get 4xx; treat
// errors as "not available" rather than surfacing to the user.
// ---------------------------------------------------------------------------

export async function listReminders(userId = null) {
  try {
    const data = await todoistFetch('/reminders', {}, userId);
    return Array.isArray(data) ? data : (data?.results || []);
  } catch (err) {
    if (/Todoist API 4\d{2}/.test(err.message)) return [];
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Bulk update — Todoist's API has no native batch-update endpoint, so this
// just iterates one-at-a-time on our side. We expose it as a single helper
// so callers don't reimplement the loop. Returns per-id results.
// ---------------------------------------------------------------------------

export async function bulkUpdateTasks(updates, userId = null) {
  // updates: [{ id, ...patch }]
  const results = [];
  for (const u of updates) {
    const { id, projectId, ...rest } = u;
    try {
      let task = null;
      if (Object.keys(rest).length > 0) {
        task = await updateTask(id, rest, userId);
      }
      if (projectId !== undefined) {
        task = await moveTask(id, { projectId }, userId);
      }
      results.push({ id, ok: true, task });
    } catch (err) {
      results.push({ id, ok: false, error: err.message });
    }
  }
  return results;
}

/**
 * Quick "is the token valid?" probe. Used by the Settings UI to validate a
 * pasted PAT before saving. Returns true on a successful 200; false on auth failure.
 */
export async function validateToken(token) {
  if (!token) return false;
  try {
    const res = await fetch(`${BASE_URL}/projects`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
