// Google Tasks adapter — leverages the same Google OAuth tokens as
// Google Calendar (we add the tasks scope to the consent screen). Sync
// pulls all task lists for the user, then their tasks, and upserts into
// tasks_cache with provider='google_tasks'.
//
// Google Tasks API: https://developers.google.com/tasks/reference/rest
// Endpoint base: https://tasks.googleapis.com/tasks/v1

import { google } from 'googleapis';
import * as g from '../../lib/google.js';
import { getDb, q } from '../../db/init.js';
import { upsertIntegration, deleteIntegration, markSynced } from '../store.js';

function tasksClient(userId) {
  const auth = g.getAuthClient(userId);
  if (!auth) throw new Error('Google Tasks: not connected');
  return google.tasks({ version: 'v1', auth });
}

export const adapter = {
  provider: 'google_tasks',
  name: 'Google Tasks',
  kind: 'tasks',
  category: 'tasks',
  status: 'stable',
  recommended: false,
  authType: 'oauth',
  description: 'Sync tasks with Google Tasks. Uses the same Google account as Calendar.',
  docsUrl: 'https://developers.google.com/tasks',
  syncEnabled: true,
  requiresEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],

  // Auth piggybacks on Google Calendar's OAuth flow — the user reconnects
  // Google Calendar with the additional `tasks` scope and Google Tasks
  // becomes available automatically. We just record the connection here.
  async authCallback(userId) {
    upsertIntegration(userId, 'google_tasks', { status: 'connected' });
    return { ok: true };
  },

  async syncTasks(userId) {
    let added = 0, updated = 0, errored = null;
    try {
      const tasks = tasksClient(userId);
      const lists = await tasks.tasklists.list({ maxResults: 100 });
      const allLists = lists.data.items || [];
      const upsert = q(`
        INSERT INTO tasks_cache
          (user_id, provider, todoist_id, content, description, project_id, project_name,
           priority, due_date, due_datetime, is_completed, updated_at)
        VALUES (?, 'google_tasks', ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, todoist_id) DO UPDATE SET
          content = excluded.content,
          description = excluded.description,
          project_id = excluded.project_id,
          project_name = excluded.project_name,
          priority = excluded.priority,
          due_date = excluded.due_date,
          due_datetime = excluded.due_datetime,
          is_completed = excluded.is_completed,
          updated_at = datetime('now')
      `);
      for (const list of allLists) {
        let pageToken;
        do {
          const res = await tasks.tasks.list({
            tasklist: list.id,
            maxResults: 100,
            showCompleted: true,
            showHidden: false,
            pageToken,
          });
          for (const t of (res.data.items || [])) {
            const completed = t.status === 'completed';
            const dueIso = t.due || null;
            const dueDate = dueIso ? dueIso.slice(0, 10) : null;
            const r = upsert.run(
              userId,
              `gt_${list.id}_${t.id}`,             // namespaced source id
              t.title || '',
              t.notes || null,
              list.id,                              // project_id = task list id
              list.title || null,
              1,                                    // Google Tasks has no priority
              dueDate,
              null,                                 // dueDatetime not supported
              completed ? 1 : 0,
            );
            if (r.changes === 1) added++; else updated++;
          }
          pageToken = res.data.nextPageToken;
        } while (pageToken);
      }
      markSynced(userId, 'google_tasks');
      return { added, updated, deleted: 0 };
    } catch (e) {
      errored = e.message;
      markSynced(userId, 'google_tasks', errored);
      throw e;
    }
  },

  async createTask(userId, task) {
    const tasks = tasksClient(userId);
    const list = task.projectId || (await tasks.tasklists.list({ maxResults: 1 })).data.items?.[0]?.id || '@default';
    const res = await tasks.tasks.insert({
      tasklist: list,
      requestBody: {
        title: task.content,
        notes: task.description || undefined,
        due: task.dueDate ? `${task.dueDate}T00:00:00.000Z` : undefined,
      },
    });
    return res.data;
  },
  async updateTask(userId, sourceId, patch) {
    const tasks = tasksClient(userId);
    const [, list, taskId] = sourceId.split('_'); // gt_<list>_<task>
    const res = await tasks.tasks.patch({
      tasklist: list,
      task: taskId,
      requestBody: {
        ...(patch.content != null ? { title: patch.content } : {}),
        ...(patch.description != null ? { notes: patch.description } : {}),
        ...(patch.dueDate != null ? { due: `${patch.dueDate}T00:00:00.000Z` } : {}),
        ...(patch.isCompleted != null ? { status: patch.isCompleted ? 'completed' : 'needsAction' } : {}),
      },
    });
    return res.data;
  },
  async deleteTask(userId, sourceId) {
    const tasks = tasksClient(userId);
    const [, list, taskId] = sourceId.split('_');
    await tasks.tasks.delete({ tasklist: list, task: taskId });
    return { ok: true };
  },
  async completeTask(userId, sourceId) {
    return this.updateTask(userId, sourceId, { isCompleted: true });
  },

  async disconnect(userId, { wipeCache = true } = {}) {
    if (wipeCache) {
      q("DELETE FROM tasks_cache WHERE user_id = ? AND provider = 'google_tasks'").run(userId);
    }
    deleteIntegration(userId, 'google_tasks');
    return { ok: true };
  },
};
