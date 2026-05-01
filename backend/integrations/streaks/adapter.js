// Streaks adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'streaks',
  name: "Streaks",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Sync Streaks habits via the iOS app.",
  docsUrl: "https://streaksapp.com/",
  recommended: false,
  mode: 'sync',
});
