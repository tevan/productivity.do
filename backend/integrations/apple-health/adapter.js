// Apple Health adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'apple_health',
  name: "Apple Health",
  kind: 'time',
  category: 'time',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Show workouts and sleep data alongside your day. Requires the iOS app.",
  docsUrl: "https://developer.apple.com/health-fitness/",
  recommended: false,
  mode: 'read',
});
