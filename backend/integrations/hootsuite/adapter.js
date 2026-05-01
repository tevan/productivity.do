// Hootsuite adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'hootsuite',
  name: "Hootsuite",
  kind: 'communication',
  category: 'communication',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Show Hootsuite scheduled posts on your calendar.",
  docsUrl: "https://developer.hootsuite.com/",
  recommended: false,
  mode: 'read',
});
