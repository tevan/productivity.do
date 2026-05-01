// Substack adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'substack',
  name: "Substack",
  kind: 'communication',
  category: 'communication',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Show scheduled Substack posts on your calendar.",
  docsUrl: "https://substack.com/",
  recommended: false,
  mode: 'read',
});
