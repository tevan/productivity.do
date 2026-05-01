// Zendesk adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'zendesk',
  name: "Zendesk",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Convert Zendesk tickets to tasks.",
  docsUrl: "https://developer.zendesk.com/",
  recommended: false,
  mode: 'sync',
});
