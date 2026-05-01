// Strava adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'strava',
  name: "Strava",
  kind: 'time',
  category: 'time',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Show your Strava activities as busy time on the calendar.",
  docsUrl: "https://developers.strava.com/",
  recommended: false,
  mode: 'read',
});
