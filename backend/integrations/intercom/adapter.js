// Intercom adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'intercom',
  name: "Intercom",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Convert Intercom conversations to tasks.",
  docsUrl: "https://developers.intercom.com/",
  recommended: false,
  mode: 'sync',
});
