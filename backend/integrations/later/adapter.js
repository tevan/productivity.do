// Later adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'later',
  name: "Later",
  kind: 'communication',
  category: 'communication',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Show Later scheduled posts on your calendar.",
  docsUrl: "https://help.later.com/",
  recommended: false,
  mode: 'read',
});
