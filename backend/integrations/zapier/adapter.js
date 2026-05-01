// Zapier adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'zapier',
  name: "Zapier",
  kind: 'automation',
  category: 'automation',
  status: 'coming_soon',
  authType: 'pat',
  description: "Connect productivity.do to 6,000+ apps via Zapier.",
  docsUrl: "https://zapier.com/apps/productivity-do",
  recommended: true,
});
