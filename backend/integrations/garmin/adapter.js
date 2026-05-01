// Garmin Connect adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'garmin',
  name: "Garmin Connect",
  kind: 'time',
  category: 'time',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Show Garmin workouts and sleep on your calendar.",
  docsUrl: "https://developer.garmin.com/connect-iq/",
  recommended: false,
  mode: 'read',
});
