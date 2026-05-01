import { makeStub } from '../_stub.js';
export const adapter = makeStub({
  provider: 'jira',
  name: 'Jira',
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  recommended: false,
  authType: 'oauth',
  description: 'Sync issues from Jira projects.',
  docsUrl: 'https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/',
  requiresEnv: ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET'],
});
