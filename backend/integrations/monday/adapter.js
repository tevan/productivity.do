import { makeStub } from '../_stub.js';
export const adapter = makeStub({
  provider: 'monday',
  name: 'monday.com',
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  recommended: false,
  authType: 'oauth',
  description: 'Sync items from monday.com boards.',
  docsUrl: 'https://developer.monday.com/apps/docs/oauth',
  requiresEnv: ['MONDAY_CLIENT_ID', 'MONDAY_CLIENT_SECRET'],
});
