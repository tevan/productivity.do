// Front adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'front',
  name: "Front",
  kind: 'email',
  category: 'email',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Convert Front conversations to tasks.",
  docsUrl: "https://dev.frontapp.com/",
  recommended: false,
  mode: 'sync',
});
