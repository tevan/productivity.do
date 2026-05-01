// Basecamp adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'basecamp',
  name: "Basecamp",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Sync Basecamp to-dos as tasks.",
  docsUrl: "https://github.com/basecamp/bc3-api",
  recommended: false,
  mode: 'sync',
});
