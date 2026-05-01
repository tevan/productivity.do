// Canva adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'canva',
  name: "Canva",
  kind: 'design',
  category: 'design',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Create Canva designs from events.",
  docsUrl: "https://www.canva.dev/docs/connect/",
  recommended: false,
});
