// Gitea adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'gitea',
  name: "Gitea",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'pat',
  description: "Self-hosted Git. Sync Gitea issues as tasks.",
  docsUrl: "https://docs.gitea.com/api/",
  recommended: false,
  mode: 'sync',
});
