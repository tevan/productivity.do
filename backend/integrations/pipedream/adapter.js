// Pipedream adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'pipedream',
  name: "Pipedream",
  kind: 'automation',
  category: 'automation',
  status: 'coming_soon',
  authType: 'pat',
  description: "Code-level automation workflows. Free tier available.",
  docsUrl: "https://pipedream.com/apps/productivity-do",
  recommended: false,
});
