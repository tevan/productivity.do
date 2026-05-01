import { api } from '../api.js';
import { isSameDay, startOfDay, parseTaskDue, parseAllDayDate } from '../utils/dates.js';

// localStorage hydration. Without this, refreshing the page shows an empty
// task list for ~500ms (the API round-trip) which looks like every task got
// deleted. We mirror the last successful response and pre-populate $state on
// boot so the first paint shows last-known data. Background refetch updates
// the live values once the API responds.
const TASKS_CACHE_KEY = 'productivity_tasks_cache';
const TASKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — tasks are durable enough

function readTasksCache() {
  try {
    const raw = localStorage.getItem(TASKS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() - (parsed.savedAt || 0) > TASKS_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}
function writeTasksCache(items, projs) {
  try {
    localStorage.setItem(TASKS_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      tasks: items,
      projects: projs,
    }));
  } catch {}
}

const _hydrated = readTasksCache();
let tasks = $state(_hydrated?.tasks || []);
let projects = $state(_hydrated?.projects || []);
let loading = $state(false);

export function getTasks() {
  const tasksByDate = $derived.by(() => {
    const grouped = {};
    for (const t of tasks) {
      const due = parseTaskDue(t);
      if (due) {
        const key = startOfDay(due).toISOString();
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(t);
      }
    }
    return grouped;
  });

  const undatedTasks = $derived(tasks.filter(t => !t.dueDate && !t.isCompleted));

  const overdueTasks = $derived(
    tasks.filter(t => {
      if (t.isCompleted) return false;
      const due = parseTaskDue(t);
      if (!due) return false;
      if (t.dueDatetime) return due < new Date();
      return due < new Date() && !isSameDay(due, new Date());
    })
  );

  return {
    get items() { return tasks; },
    get projects() { return projects; },
    get loading() { return loading; },
    get tasksByDate() { return tasksByDate; },
    get undatedTasks() { return undatedTasks; },
    get overdueTasks() { return overdueTasks; },
  };
}

export async function fetchTasks() {
  loading = true;
  try {
    const res = await api('/api/tasks');
    if (res.ok) {
      tasks = res.tasks || [];
      projects = res.projects || [];
      writeTasksCache(tasks, projects);
    }
  } catch (e) {
    console.error('Failed to fetch tasks:', e);
  } finally {
    loading = false;
  }
}

// Mutation helper — keeps the localStorage cache mirrored to the live
// `tasks` array so a refresh paints the post-mutation state without
// waiting for the API roundtrip. Call after any reassignment of `tasks`.
function commitTasks(next) {
  tasks = next;
  writeTasksCache(tasks, projects);
}

// Multi-source routing: pick the right backend route based on the task's
// provider. Native tasks live at /api/native/tasks/:id, everything else
// (Todoist + integration providers) goes through /api/tasks/:id which the
// server-side adapter dispatches by provider.
function taskUrl(id, suffix = '') {
  const t = tasks.find(x => String(x.id) === String(id));
  const base = t?.provider === 'native'
    ? `/api/native/tasks/${id}`
    : `/api/tasks/${id}`;
  return base + suffix;
}

export async function completeTask(id) {
  try {
    const res = await api(taskUrl(id, '/complete'), { method: 'POST' });
    if (res.ok) {
      commitTasks(tasks.map(t => t.id === id ? { ...t, isCompleted: true } : t));
      return true;
    }
    return false;
  } catch (e) {
    console.error('Failed to complete task:', e);
    return false;
  }
}

export async function reopenTask(id) {
  try {
    const res = await api(taskUrl(id, '/reopen'), { method: 'POST' });
    if (res.ok) {
      commitTasks(tasks.map(t => t.id === id ? { ...t, isCompleted: false } : t));
      return true;
    }
    return false;
  } catch (e) {
    console.error('Failed to reopen task:', e);
    return false;
  }
}

export async function createTask(data) {
  try {
    // Default to native if caller didn't specify a provider. Today, an
    // existing Todoist connection still pushes through /api/tasks for
    // back-compat — opt-in by passing { provider: 'todoist' }.
    const url = (data.provider && data.provider !== 'native')
      ? '/api/tasks'
      : '/api/native/tasks';
    const res = await api(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (res.ok && res.task) {
      commitTasks([...tasks, res.task]);
      return res.task;
    }
    return null;
  } catch (e) {
    console.error('Failed to create task:', e);
    return null;
  }
}

export async function updateTask(id, data) {
  // Optimistic: apply the patch locally so the UI reflects the change
  // immediately. If the server call fails, roll back to the pre-patch
  // snapshot. Same shape as moveTaskToColumn / completeTask / reopenTask.
  const before = tasks;
  const optimistic = tasks.map(t => t.id === id ? { ...t, ...data } : t);
  commitTasks(optimistic);
  try {
    const res = await api(taskUrl(id), {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (res.ok && res.task) {
      // Reconcile with the server's authoritative copy.
      commitTasks(tasks.map(t => t.id === id ? { ...t, ...res.task } : t));
      return res.task;
    }
    // Server reported failure — roll back so the user can retry from a
    // truthful state instead of a phantom-applied edit.
    commitTasks(before);
    return null;
  } catch (e) {
    console.error('Failed to update task:', e);
    commitTasks(before);
    return null;
  }
}

// Move a task to a board column. statusKey is 'todo' | 'in_progress' | 'done'
// (or a custom_<n> key). Done is special: it triggers Todoist completion
// rather than writing local_status, because Done = Todoist completed (see
// docs/internal/tasks-board.md). Optimistic — flips local state first, then
// reconciles with the server.
export async function moveTaskToColumn(id, statusKey) {
  if (statusKey === 'done') {
    commitTasks(tasks.map(t => t.id === id ? { ...t, isCompleted: true, localStatus: null } : t));
    try {
      await api(taskUrl(id, '/complete'), { method: 'POST' });
    } catch (e) {
      console.error('Failed to complete task:', e);
    }
    return;
  }
  commitTasks(tasks.map(t => t.id === id ? { ...t, localStatus: statusKey } : t));
  try {
    await api(taskUrl(id), {
      method: 'PUT',
      body: JSON.stringify({ localStatus: statusKey }),
    });
  } catch (e) {
    console.error('Failed to move task to column:', e);
  }
}

export async function reorderTasksInColumn(positions) {
  const idxMap = new Map(positions.map((id, i) => [id, i]));
  commitTasks(tasks.map(t => idxMap.has(t.id) ? { ...t, localPosition: idxMap.get(t.id) } : t));
  await Promise.all(positions.map((id, i) =>
    api(taskUrl(id), {
      method: 'PUT',
      body: JSON.stringify({ localPosition: i }),
    }).catch(() => {})
  ));
}

export async function deleteTask(id) {
  try {
    const res = await api(taskUrl(id), { method: 'DELETE' });
    if (res.ok) {
      commitTasks(tasks.filter(t => t.id !== id));
      return true;
    }
    return false;
  } catch (e) {
    console.error('Failed to delete task:', e);
    return false;
  }
}
