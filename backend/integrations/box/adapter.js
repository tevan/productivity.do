// Box adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'box',
  name: "Box",
  kind: 'storage',
  category: 'storage',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Attach Box files to events, tasks, and notes.",
  docsUrl: "https://developer.box.com/",
  recommended: false,
});
