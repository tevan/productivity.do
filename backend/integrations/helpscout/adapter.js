// Help Scout adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'helpscout',
  name: "Help Scout",
  kind: 'email',
  category: 'email',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Convert Help Scout conversations to tasks.",
  docsUrl: "https://developer.helpscout.com/",
  recommended: false,
  mode: 'sync',
});
