// Trello adapter — pulls cards from selected boards as tasks.
//
// Trello auth uses an app-level API key (env TRELLO_API_KEY) plus a
// per-user token the user generates via Trello's authorize URL. We store
// the user token in integrations.access_token. Sync iterates the
// metadata.boardIds the user opted into.
//
// API: https://developer.atlassian.com/cloud/trello/rest/

import { getDb, q } from '../../db/init.js';
import { getIntegration, upsertIntegration, deleteIntegration, markSynced, parseMetadata } from '../store.js';

function key() { return process.env.TRELLO_API_KEY; }

async function trelloGet(token, path, params = {}) {
  const k = key();
  if (!k) throw new Error('Trello: TRELLO_API_KEY not configured');
  const url = new URL(`https://api.trello.com/1${path}`);
  url.searchParams.set('key', k);
  url.searchParams.set('token', token);
  for (const [k2, v] of Object.entries(params)) url.searchParams.set(k2, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Trello: ${res.status} ${await res.text()}`);
  return res.json();
}

async function trelloMutate(token, method, path, body = {}) {
  const k = key();
  if (!k) throw new Error('Trello: TRELLO_API_KEY not configured');
  const url = new URL(`https://api.trello.com/1${path}`);
  url.searchParams.set('key', k);
  url.searchParams.set('token', token);
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Trello: ${res.status} ${await res.text()}`);
  return method === 'DELETE' ? { ok: true } : res.json();
}

export const adapter = {
  provider: 'trello',
  name: 'Trello',
  kind: 'tasks',
  category: 'tasks',
  status: 'stable',
  recommended: false,
  authType: 'pat',
  description: 'Sync cards from selected Trello boards.',
  docsUrl: 'https://trello.com/app-key',
  syncEnabled: true,
  requiresEnv: ['TRELLO_API_KEY'],

  async authValidatePat(userId, token) {
    const me = await trelloGet(token, '/members/me', { fields: 'username,email' });
    if (!me?.id) throw new Error('Trello rejected this token');
    upsertIntegration(userId, 'trello', { access_token: token, account_email: me.email || null });
    return { ok: true, username: me.username };
  },

  async listBoards(userId) {
    const row = getIntegration(userId, 'trello');
    if (!row?.access_token) throw new Error('Trello: not connected');
    return trelloGet(row.access_token, '/members/me/boards', { fields: 'name,closed' })
      .then(boards => boards.filter(b => !b.closed));
  },

  async setBoards(userId, boardIds) {
    const existing = getIntegration(userId, 'trello');
    const meta = parseMetadata(existing);
    upsertIntegration(userId, 'trello', { ...existing, metadata_json: { ...meta, boardIds } });
    return { ok: true };
  },

  async syncTasks(userId) {
    const row = getIntegration(userId, 'trello');
    if (!row?.access_token) throw new Error('Trello: not connected');
    const meta = parseMetadata(row);
    const boardIds = meta.boardIds || [];
    if (!boardIds.length) return { added: 0, updated: 0, deleted: 0, note: 'No boards selected' };
    const upsert = q(`
      INSERT INTO tasks_cache
        (user_id, provider, todoist_id, content, description, project_id, project_name,
         priority, due_date, due_datetime, is_completed, created_at, updated_at)
      VALUES (?, 'trello', ?, ?, ?, ?, ?, 1, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(user_id, todoist_id) DO UPDATE SET
        content = excluded.content,
        description = excluded.description,
        project_id = excluded.project_id,
        project_name = excluded.project_name,
        due_date = excluded.due_date,
        due_datetime = excluded.due_datetime,
        is_completed = excluded.is_completed,
        updated_at = datetime('now')
    `);
    let added = 0, updated = 0;
    try {
      for (const boardId of boardIds) {
        const board = await trelloGet(row.access_token, `/boards/${boardId}`, { fields: 'name' });
        const cards = await trelloGet(row.access_token, `/boards/${boardId}/cards`, {
          fields: 'name,desc,due,dueComplete,closed',
        });
        for (const c of cards) {
          if (c.closed) continue;
          const dueIso = c.due || null;
          const dueDate = dueIso ? dueIso.slice(0, 10) : null;
          const dueDt = dueIso || null;
          const r = upsert.run(
            userId,
            `trello_${c.id}`,
            c.name || '',
            c.desc || null,
            boardId,
            board.name,
            dueDate,
            dueDt,
            c.dueComplete ? 1 : 0
          );
          if (r.changes === 1) added++; else updated++;
        }
      }
      markSynced(userId, 'trello');
      return { added, updated, deleted: 0 };
    } catch (e) {
      markSynced(userId, 'trello', e.message);
      throw e;
    }
  },

  async createTask(userId, task) {
    const row = getIntegration(userId, 'trello');
    const meta = parseMetadata(row);
    const boardId = meta.boardIds?.[0];
    if (!boardId) throw new Error('Trello: no board selected');
    const lists = await trelloGet(row.access_token, `/boards/${boardId}/lists`, { fields: 'name' });
    if (!lists.length) throw new Error('Trello: target board has no lists');
    return trelloMutate(row.access_token, 'POST', '/cards', {
      idList: lists[0].id,
      name: task.content,
      desc: task.description || '',
      due: task.dueDatetime || (task.dueDate ? `${task.dueDate}T12:00:00.000Z` : undefined),
    });
  },
  async updateTask(userId, sourceId, patch) {
    const row = getIntegration(userId, 'trello');
    const id = sourceId.replace(/^trello_/, '');
    const body = {};
    if (patch.content != null) body.name = patch.content;
    if (patch.description != null) body.desc = patch.description;
    if (patch.dueDate !== undefined) body.due = patch.dueDate ? `${patch.dueDate}T12:00:00.000Z` : null;
    if (patch.dueDatetime !== undefined) body.due = patch.dueDatetime || null;
    if (patch.isCompleted != null) body.dueComplete = !!patch.isCompleted;
    return trelloMutate(row.access_token, 'PUT', `/cards/${id}`, body);
  },
  async deleteTask(userId, sourceId) {
    const row = getIntegration(userId, 'trello');
    const id = sourceId.replace(/^trello_/, '');
    return trelloMutate(row.access_token, 'DELETE', `/cards/${id}`);
  },
  async completeTask(userId, sourceId) {
    return this.updateTask(userId, sourceId, { isCompleted: true });
  },

  async disconnect(userId, { wipeCache = true } = {}) {
    if (wipeCache) q("DELETE FROM tasks_cache WHERE user_id = ? AND provider = 'trello'").run(userId);
    deleteIntegration(userId, 'trello');
    return { ok: true };
  },
};
