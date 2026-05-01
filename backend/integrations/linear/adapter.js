// Linear adapter — pulls Linear issues as tasks. GraphQL API at
// https://api.linear.app/graphql. Auth via Personal API key for v1 (the
// OAuth flow exists but requires app review). Users can scope sync to one
// or more team ids via metadata.teamIds.
//
// Linear is issue-tracker-shaped, but for our purposes each issue maps
// cleanly to a task: title→content, description→description,
// dueDate→dueDate, state.name→completion.

import { getDb, q } from '../../db/init.js';
import { getIntegration, upsertIntegration, deleteIntegration, markSynced, parseMetadata } from '../store.js';

async function gql(token, query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token, // Linear uses bare token for PAT
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    const msg = json.errors.map(e => e.message).join('; ');
    throw new Error(`Linear: ${msg}`);
  }
  return json.data;
}

export const adapter = {
  provider: 'linear',
  name: 'Linear',
  kind: 'tasks',
  category: 'tasks',
  status: 'stable',
  recommended: false,
  authType: 'pat',
  description: 'Sync issues from Linear teams as tasks.',
  docsUrl: 'https://linear.app/settings/api',
  syncEnabled: true,

  async authValidatePat(userId, token) {
    const data = await gql(token, '{ viewer { id email name } }');
    if (!data?.viewer?.id) throw new Error('Linear rejected this token');
    upsertIntegration(userId, 'linear', {
      access_token: token,
      account_email: data.viewer.email,
    });
    return { ok: true, email: data.viewer.email };
  },

  async listTeams(userId) {
    const row = getIntegration(userId, 'linear');
    if (!row?.access_token) throw new Error('Linear: not connected');
    const data = await gql(row.access_token, '{ teams(first: 100) { nodes { id name key } } }');
    return data.teams.nodes;
  },

  async setTeams(userId, teamIds) {
    const existing = getIntegration(userId, 'linear');
    const meta = parseMetadata(existing);
    upsertIntegration(userId, 'linear', {
      ...existing,
      metadata_json: { ...meta, teamIds: Array.isArray(teamIds) ? teamIds : [] },
    });
    return { ok: true };
  },

  async syncTasks(userId) {
    const row = getIntegration(userId, 'linear');
    if (!row?.access_token) throw new Error('Linear: not connected');
    const meta = parseMetadata(row);
    const teamIds = meta.teamIds || [];
    if (!teamIds.length) {
      // No team selected → sync issues assigned to viewer across all teams.
    }
    const upsert = q(`
      INSERT INTO tasks_cache
        (user_id, provider, todoist_id, content, description, project_id, project_name,
         priority, due_date, is_completed, updated_at)
      VALUES (?, 'linear', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
    let added = 0, updated = 0;
    try {
      const filter = teamIds.length
        ? `filter: { team: { id: { in: ${JSON.stringify(teamIds)} } } }`
        : `filter: { assignee: { isMe: { eq: true } } }`;
      let endCursor = null, hasMore = true;
      while (hasMore) {
        const after = endCursor ? `, after: "${endCursor}"` : '';
        const data = await gql(row.access_token, `
          { issues(first: 100${after}, ${filter}) {
            nodes { id title description dueDate priority team { id name }
                    state { name type } }
            pageInfo { hasNextPage endCursor } } }
        `);
        for (const it of data.issues.nodes) {
          const completed = it.state?.type === 'completed' || it.state?.type === 'canceled';
          const r = upsert.run(
            userId,
            `linear_${it.id}`,
            it.title || '',
            it.description || null,
            it.team?.id || null,
            it.team?.name || null,
            // Linear priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low.
            // Map roughly to Todoist's 1-4 (1=lowest in Todoist UI, 4=highest).
            it.priority === 1 ? 4 : it.priority === 2 ? 3 : it.priority === 3 ? 2 : 1,
            it.dueDate || null,
            completed ? 1 : 0
          );
          if (r.changes === 1) added++; else updated++;
        }
        hasMore = data.issues.pageInfo.hasNextPage;
        endCursor = data.issues.pageInfo.endCursor;
      }
      markSynced(userId, 'linear');
      return { added, updated, deleted: 0 };
    } catch (e) {
      markSynced(userId, 'linear', e.message);
      throw e;
    }
  },

  async createTask(userId, task) {
    const row = getIntegration(userId, 'linear');
    const meta = parseMetadata(row);
    const teamId = meta.teamIds?.[0];
    if (!teamId) throw new Error('Linear: no team selected');
    const data = await gql(row.access_token, `
      mutation Create($input: IssueCreateInput!) {
        issueCreate(input: $input) { success issue { id title } }
      }
    `, {
      input: {
        teamId,
        title: task.content || '',
        description: task.description || undefined,
        dueDate: task.dueDate || undefined,
      },
    });
    return data.issueCreate.issue;
  },
  async updateTask(userId, sourceId, patch) {
    const row = getIntegration(userId, 'linear');
    const id = sourceId.replace(/^linear_/, '');
    const input = {
      ...(patch.content != null ? { title: patch.content } : {}),
      ...(patch.description != null ? { description: patch.description } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate || null } : {}),
    };
    if (patch.isCompleted != null) {
      // To complete in Linear we need to fetch the team's "completed" state id.
      // Simpler: leave out — Linear's UI is the source of truth for state.
    }
    const data = await gql(row.access_token, `
      mutation Update($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success issue { id title } }
      }
    `, { id, input });
    return data.issueUpdate.issue;
  },
  async deleteTask(userId, sourceId) {
    const row = getIntegration(userId, 'linear');
    const id = sourceId.replace(/^linear_/, '');
    await gql(row.access_token, `
      mutation Archive($id: String!) { issueArchive(id: $id) { success } }
    `, { id });
    return { ok: true };
  },
  async completeTask(userId, sourceId) {
    // No-op — Linear completion needs a state id we don't track. Surface
    // a clear error so the UI can fall back to opening Linear directly.
    throw Object.assign(new Error('Complete in Linear directly — workflow states vary by team'), { code: 'unsupported' });
  },

  async disconnect(userId, { wipeCache = true } = {}) {
    if (wipeCache) q("DELETE FROM tasks_cache WHERE user_id = ? AND provider = 'linear'").run(userId);
    deleteIntegration(userId, 'linear');
    return { ok: true };
  },
};
