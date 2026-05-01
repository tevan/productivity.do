// Wrike adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'wrike',
  name: "Wrike",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Sync Wrike tasks.",
  docsUrl: "https://developers.wrike.com/",
  recommended: false,
  mode: 'sync',
});
