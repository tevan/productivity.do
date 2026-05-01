// Things 3 adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'things',
  name: "Things 3",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Send tasks to Things 3 via URL scheme. Requires the macOS or iOS app.",
  docsUrl: "https://culturedcode.com/things/support/articles/2803573/",
  recommended: false,
});
