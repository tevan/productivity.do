// Roam Research adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'roam',
  name: "Roam Research",
  kind: 'notes',
  category: 'notes',
  status: 'coming_soon',
  authType: 'pat',
  description: "Sync notes with your Roam graph.",
  docsUrl: "https://roamresearch.com/",
  recommended: false,
  mode: 'sync',
});
