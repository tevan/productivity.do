// Google Forms adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'google_forms',
  name: "Google Forms",
  kind: 'forms',
  category: 'forms',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Pull Google Forms responses as tasks.",
  docsUrl: "https://developers.google.com/forms",
  recommended: false,
});
