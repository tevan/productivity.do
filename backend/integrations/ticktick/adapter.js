// TickTick adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'ticktick',
  name: "TickTick",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Sync tasks with TickTick.",
  docsUrl: "https://developer.ticktick.com/",
  recommended: false,
});
