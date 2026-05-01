// Pocket adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'pocket',
  name: "Pocket",
  kind: 'notes',
  category: 'notes',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Save articles from Pocket as notes.",
  docsUrl: "https://getpocket.com/developer/",
  recommended: false,
  mode: 'import',
});
