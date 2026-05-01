// Jotform adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'jotform',
  name: "Jotform",
  kind: 'forms',
  category: 'forms',
  status: 'coming_soon',
  authType: 'pat',
  description: "Capture Jotform responses.",
  docsUrl: "https://api.jotform.com/docs/",
  recommended: false,
});
