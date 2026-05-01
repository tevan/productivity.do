import { makeStub } from '../_stub.js';
export const adapter = makeStub({
  provider: 'clickup',
  name: 'ClickUp',
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  recommended: false,
  authType: 'oauth',
  description: 'Sync tasks from ClickUp lists.',
  docsUrl: 'https://clickup.com/api/developer-portal/authentication/',
  requiresEnv: ['CLICKUP_CLIENT_ID', 'CLICKUP_CLIENT_SECRET'],
});
