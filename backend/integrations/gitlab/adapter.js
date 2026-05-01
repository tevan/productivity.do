// GitLab adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'gitlab',
  name: "GitLab",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Sync GitLab issues as tasks.",
  docsUrl: "https://docs.gitlab.com/api/",
  recommended: false,
  mode: 'sync',
});
