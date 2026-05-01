// Bitbucket adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'bitbucket',
  name: "Bitbucket",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Sync Bitbucket issues as tasks.",
  docsUrl: "https://developer.atlassian.com/cloud/bitbucket/",
  recommended: false,
  mode: 'sync',
});
