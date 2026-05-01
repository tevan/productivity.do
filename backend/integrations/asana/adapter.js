import { makeStub } from '../_stub.js';
export const adapter = makeStub({
  provider: 'asana',
  name: 'Asana',
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  recommended: false,
  authType: 'oauth',
  description: 'Sync tasks from Asana projects.',
  docsUrl: 'https://developers.asana.com/docs/oauth',
  requiresEnv: ['ASANA_CLIENT_ID', 'ASANA_CLIENT_SECRET'],
});
