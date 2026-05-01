// Health Connect (Android) adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'health_connect',
  name: "Health Connect (Android)",
  kind: 'time',
  category: 'time',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Show workouts and sleep data on Android. Replaces Google Fit.",
  docsUrl: "https://developer.android.com/health-and-fitness/guides/health-connect",
  recommended: false,
  mode: 'read',
});
