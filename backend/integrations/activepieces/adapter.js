// Activepieces adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'activepieces',
  name: "Activepieces",
  kind: 'automation',
  category: 'automation',
  status: 'coming_soon',
  authType: 'pat',
  description: "Open-source automation, MIT-licensed. Self-host or use cloud.",
  docsUrl: "https://www.activepieces.com/",
  recommended: false,
});
