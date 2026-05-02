// Notion adapter — pulls tasks out of a user-selected Notion *database*.
// The Notion API doesn't have a "tasks" primitive; users build them as a
// database with title + status + due-date columns. We let the user pick a
// database via metadata.databaseId; the integration UI shows their
// available databases for selection.
//
// Auth: Notion's "internal integration token" (PAT). OAuth public app
// flow exists but requires a verified app review. PAT keeps things
// simple for v1 and works identically per-user.
//
// API docs: https://developers.notion.com/reference/intro

import { Client as Notion } from '@notionhq/client';
import { getDb, q } from '../../db/init.js';
import { getIntegration, upsertIntegration, deleteIntegration, markSynced, parseMetadata } from '../store.js';

function notionClient(userId) {
  const row = getIntegration(userId, 'notion');
  if (!row?.access_token) throw new Error('Notion: not connected');
  return new Notion({ auth: row.access_token });
}

// Best-effort property mapping. Notion databases vary wildly in column
// names — we sniff for the first title property, the first status/select
// property, and the first date property.
function pickProps(props = {}) {
  let title, status, due;
  for (const [name, p] of Object.entries(props)) {
    if (!title && p.type === 'title') title = name;
    if (!status && (p.type === 'status' || p.type === 'select' || p.type === 'checkbox')) status = name;
    if (!due && p.type === 'date') due = name;
  }
  return { title, status, due };
}

function isCompleted(prop) {
  if (!prop) return false;
  if (prop.type === 'checkbox') return !!prop.checkbox;
  if (prop.type === 'status') {
    const name = prop.status?.name?.toLowerCase() || '';
    return name === 'done' || name === 'complete' || name === 'completed';
  }
  if (prop.type === 'select') {
    const name = prop.select?.name?.toLowerCase() || '';
    return name === 'done' || name === 'complete' || name === 'completed';
  }
  return false;
}

export const adapter = {
  provider: 'notion',
  name: 'Notion',
  kind: 'tasks',
  category: 'tasks',
  status: 'stable',
  recommended: true,
  authType: 'pat',
  description: 'Sync tasks from a Notion database. Pick the database in Settings after connecting.',
  docsUrl: 'https://www.notion.so/my-integrations',
  syncEnabled: true,

  async authValidatePat(userId, token) {
    // Probe with a minimal call — listing the user's accessible databases.
    const client = new Notion({ auth: token });
    try {
      await client.users.me();
    } catch (e) {
      throw new Error('Notion rejected this token');
    }
    upsertIntegration(userId, 'notion', { access_token: token });
    return { ok: true };
  },

  // Lists Notion databases the user's integration token has access to.
  // Stored in metadata so the user can pick one for syncing.
  async listDatabases(userId) {
    const client = notionClient(userId);
    const res = await client.search({
      filter: { property: 'object', value: 'database' },
      page_size: 50,
    });
    return (res.results || []).map(d => ({
      id: d.id,
      title: d.title?.[0]?.plain_text || '(untitled)',
      url: d.url,
    }));
  },

  async setDatabase(userId, databaseId) {
    const existing = getIntegration(userId, 'notion');
    const meta = parseMetadata(existing);
    upsertIntegration(userId, 'notion', {
      ...existing,
      metadata_json: { ...meta, databaseId },
    });
    return { ok: true };
  },

  async syncTasks(userId) {
    const row = getIntegration(userId, 'notion');
    const meta = parseMetadata(row);
    if (!meta.databaseId) {
      const e = new Error('Notion: no database selected');
      e.code = 'config_required';
      throw e;
    }
    const client = notionClient(userId);
    let added = 0, updated = 0;
    try {
      const upsert = q(`
        INSERT INTO tasks_cache
          (user_id, provider, todoist_id, content, description, project_id,
           priority, due_date, is_completed, created_at, updated_at)
        VALUES (?, 'notion', ?, ?, NULL, ?, 1, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(user_id, todoist_id) DO UPDATE SET
          content = excluded.content,
          due_date = excluded.due_date,
          is_completed = excluded.is_completed,
          updated_at = datetime('now')
      `);
      let cursor;
      do {
        const res = await client.databases.query({
          database_id: meta.databaseId,
          start_cursor: cursor,
          page_size: 100,
        });
        for (const page of (res.results || [])) {
          const props = page.properties || {};
          const picked = pickProps(props);
          const titleProp = picked.title ? props[picked.title] : null;
          const title = titleProp?.title?.map(t => t.plain_text).join('') || '(untitled)';
          const due = picked.due ? props[picked.due]?.date?.start : null;
          const completed = picked.status ? isCompleted(props[picked.status]) : false;
          const r = upsert.run(
            userId,
            `notion_${page.id}`,
            title,
            meta.databaseId,
            due ? due.slice(0, 10) : null,
            completed ? 1 : 0
          );
          if (r.changes === 1) added++; else updated++;
        }
        cursor = res.has_more ? res.next_cursor : null;
      } while (cursor);
      markSynced(userId, 'notion');
      return { added, updated, deleted: 0 };
    } catch (e) {
      markSynced(userId, 'notion', e.message);
      throw e;
    }
  },

  async createTask(userId, task) {
    const row = getIntegration(userId, 'notion');
    const meta = parseMetadata(row);
    if (!meta.databaseId) throw new Error('Notion: no database selected');
    const client = notionClient(userId);
    // We need to find the title property name in the target database.
    const dbInfo = await client.databases.retrieve({ database_id: meta.databaseId });
    const { title: titleProp, due: dueProp } = pickProps(dbInfo.properties || {});
    if (!titleProp) throw new Error('Notion: target database has no title property');
    const properties = {
      [titleProp]: { title: [{ text: { content: task.content || '' } }] },
    };
    if (task.dueDate && dueProp) {
      properties[dueProp] = { date: { start: task.dueDate } };
    }
    const res = await client.pages.create({
      parent: { database_id: meta.databaseId },
      properties,
    });
    return res;
  },

  async updateTask(userId, sourceId, patch) {
    const client = notionClient(userId);
    const pageId = sourceId.replace(/^notion_/, '');
    const page = await client.pages.retrieve({ page_id: pageId });
    const props = page.properties || {};
    const picked = pickProps(props);
    const properties = {};
    if (patch.content != null && picked.title) {
      properties[picked.title] = { title: [{ text: { content: patch.content } }] };
    }
    if (patch.dueDate !== undefined && picked.due) {
      properties[picked.due] = patch.dueDate ? { date: { start: patch.dueDate } } : { date: null };
    }
    if (patch.isCompleted != null && picked.status) {
      const t = props[picked.status].type;
      if (t === 'checkbox') properties[picked.status] = { checkbox: !!patch.isCompleted };
      else if (t === 'status') properties[picked.status] = { status: { name: patch.isCompleted ? 'Done' : 'Not started' } };
      else if (t === 'select') properties[picked.status] = { select: { name: patch.isCompleted ? 'Done' : 'To do' } };
    }
    return client.pages.update({ page_id: pageId, properties });
  },

  async deleteTask(userId, sourceId) {
    // Notion API doesn't expose hard-delete; archive instead.
    const client = notionClient(userId);
    const pageId = sourceId.replace(/^notion_/, '');
    return client.pages.update({ page_id: pageId, archived: true });
  },
  async completeTask(userId, sourceId) {
    return this.updateTask(userId, sourceId, { isCompleted: true });
  },

  async disconnect(userId, { wipeCache = true } = {}) {
    if (wipeCache) q("DELETE FROM tasks_cache WHERE user_id = ? AND provider = 'notion'").run(userId);
    deleteIntegration(userId, 'notion');
    return { ok: true };
  },
};
