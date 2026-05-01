// Todoist adapter — wraps the existing backend/lib/todoist.js helpers in
// the standard adapter shape. This keeps existing Todoist call sites working
// while letting the new abstraction treat Todoist as just another provider.
//
// Auth model: PAT (personal access token). The user pastes their token,
// we validate via /projects, store it on integrations.access_token. The
// legacy users.todoist_token column is still read by lib/todoist.js as a
// fallback so live data isn't lost during the transition.

import * as todoist from '../../lib/todoist.js';
import { upsertIntegration, deleteIntegration } from '../store.js';

export const adapter = {
  provider: 'todoist',
  name: 'Todoist',
  kind: 'tasks',
  category: 'tasks',
  status: 'stable',
  recommended: true,
  authType: 'pat',
  description: 'Sync tasks, projects, sections, labels, and comments with Todoist.',
  docsUrl: 'https://app.todoist.com/app/settings/integrations/developer',
  syncEnabled: true,

  async authValidatePat(userId, token) {
    const ok = await todoist.validateToken(token);
    if (!ok) throw new Error('Todoist rejected this token');
    upsertIntegration(userId, 'todoist', {
      access_token: token,
      status: 'connected',
    });
    return { ok: true };
  },

  // Sync is a no-op for now — the rest of the app reads tasks live via
  // lib/todoist.js. Once we move task storage fully to tasks_native +
  // provider columns, this hook will pull and upsert.
  async syncTasks(userId) {
    return { added: 0, updated: 0, deleted: 0, note: 'Todoist still uses legacy live-fetch path' };
  },

  // Mutations route through the existing helpers so the legacy /api/tasks
  // routes keep working without modification.
  async createTask(userId, task) {
    return todoist.createTask(task, userId);
  },
  async updateTask(userId, sourceId, patch) {
    return todoist.updateTask(sourceId, patch, userId);
  },
  async deleteTask(userId, sourceId) {
    return todoist.deleteTask(sourceId, userId);
  },
  async completeTask(userId, sourceId) {
    return todoist.completeTask(sourceId, userId);
  },

  async disconnect(userId) {
    deleteIntegration(userId, 'todoist');
    return { ok: true };
  },
};
