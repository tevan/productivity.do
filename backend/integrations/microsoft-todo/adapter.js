// Microsoft To Do adapter — Graph API. OAuth via Microsoft Identity
// Platform (single-tenant or multi-tenant). Scopes: Tasks.ReadWrite.
//
// Auth shares the same OAuth flow as Microsoft Calendar — only one
// "microsoft" connection per user, but it covers both surfaces.
//
// Graph: https://graph.microsoft.com/v1.0/me/todo/lists/{listId}/tasks

import { getDb, q } from '../../db/init.js';
import { getIntegration, upsertIntegration, deleteIntegration, markSynced } from '../store.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';

async function token(userId) {
  const row = getIntegration(userId, 'microsoft_todo')
    || getIntegration(userId, 'microsoft_calendar'); // shared
  if (!row?.access_token) throw new Error('Microsoft: not connected');
  // TODO: refresh-on-expiry. v1 trusts the token until 401.
  return row.access_token;
}

async function graph(userId, method, path, body) {
  const t = await token(userId);
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Microsoft Graph: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

export const adapter = {
  provider: 'microsoft_todo',
  name: 'Microsoft To Do',
  kind: 'tasks',
  category: 'tasks',
  status: 'stable',
  recommended: false,
  authType: 'oauth',
  description: 'Sync tasks from Microsoft To Do (uses your Microsoft account).',
  docsUrl: 'https://learn.microsoft.com/graph/api/resources/todo-overview',
  syncEnabled: true,
  requiresEnv: ['MS_CLIENT_ID', 'MS_CLIENT_SECRET'],

  async authStartUrl(userId, redirectUri) {
    const clientId = process.env.MS_CLIENT_ID;
    if (!clientId) throw new Error('Microsoft: MS_CLIENT_ID not configured');
    const url = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'offline_access Tasks.ReadWrite Calendars.ReadWrite User.Read');
    url.searchParams.set('state', String(userId));
    return url.toString();
  },

  async authCallback(userId, code, redirectUri) {
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MS_CLIENT_ID,
        client_secret: process.env.MS_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) throw new Error(`Microsoft token exchange: ${await res.text()}`);
    const tokens = await res.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    upsertIntegration(userId, 'microsoft_todo', {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
    });
    return { ok: true };
  },

  async syncTasks(userId) {
    let added = 0, updated = 0;
    const upsert = q(`
      INSERT INTO tasks_cache
        (user_id, provider, todoist_id, content, description, project_id, project_name,
         priority, due_date, is_completed, created_at, updated_at)
      VALUES (?, 'microsoft_todo', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(user_id, todoist_id) DO UPDATE SET
        content = excluded.content,
        description = excluded.description,
        project_id = excluded.project_id,
        project_name = excluded.project_name,
        priority = excluded.priority,
        due_date = excluded.due_date,
        is_completed = excluded.is_completed,
        updated_at = datetime('now')
    `);
    try {
      const lists = await graph(userId, 'GET', '/me/todo/lists');
      for (const list of (lists.value || [])) {
        const tasks = await graph(userId, 'GET', `/me/todo/lists/${list.id}/tasks?$top=100`);
        for (const t of (tasks.value || [])) {
          const completed = t.status === 'completed';
          const due = t.dueDateTime?.dateTime ? t.dueDateTime.dateTime.slice(0, 10) : null;
          const r = upsert.run(
            userId,
            `mstodo_${list.id}_${t.id}`,
            t.title || '',
            t.body?.content || null,
            list.id,
            list.displayName || null,
            t.importance === 'high' ? 4 : t.importance === 'low' ? 2 : 3,
            due,
            completed ? 1 : 0
          );
          if (r.changes === 1) added++; else updated++;
        }
      }
      markSynced(userId, 'microsoft_todo');
      return { added, updated, deleted: 0 };
    } catch (e) {
      markSynced(userId, 'microsoft_todo', e.message);
      throw e;
    }
  },

  async createTask(userId, task) {
    const lists = await graph(userId, 'GET', '/me/todo/lists?$top=1');
    const listId = task.projectId || lists.value?.[0]?.id;
    if (!listId) throw new Error('Microsoft To Do: no list available');
    return graph(userId, 'POST', `/me/todo/lists/${listId}/tasks`, {
      title: task.content,
      body: task.description ? { content: task.description, contentType: 'text' } : undefined,
      dueDateTime: task.dueDate ? { dateTime: `${task.dueDate}T00:00:00`, timeZone: 'UTC' } : undefined,
    });
  },
  async updateTask(userId, sourceId, patch) {
    const [, listId, taskId] = sourceId.split('_');
    const body = {};
    if (patch.content != null) body.title = patch.content;
    if (patch.description != null) body.body = { content: patch.description, contentType: 'text' };
    if (patch.dueDate !== undefined) body.dueDateTime = patch.dueDate ? { dateTime: `${patch.dueDate}T00:00:00`, timeZone: 'UTC' } : null;
    if (patch.isCompleted != null) body.status = patch.isCompleted ? 'completed' : 'notStarted';
    return graph(userId, 'PATCH', `/me/todo/lists/${listId}/tasks/${taskId}`, body);
  },
  async deleteTask(userId, sourceId) {
    const [, listId, taskId] = sourceId.split('_');
    await graph(userId, 'DELETE', `/me/todo/lists/${listId}/tasks/${taskId}`);
    return { ok: true };
  },
  async completeTask(userId, sourceId) {
    return this.updateTask(userId, sourceId, { isCompleted: true });
  },

  async disconnect(userId, { wipeCache = true } = {}) {
    if (wipeCache) q("DELETE FROM tasks_cache WHERE user_id = ? AND provider = 'microsoft_todo'").run(userId);
    deleteIntegration(userId, 'microsoft_todo');
    return { ok: true };
  },
};
