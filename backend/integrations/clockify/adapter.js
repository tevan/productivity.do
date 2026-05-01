// Clockify adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'clockify',
  name: "Clockify",
  kind: 'time',
  category: 'time',
  status: 'coming_soon',
  authType: 'pat',
  description: "Track time entries in Clockify.",
  docsUrl: "https://docs.clockify.me/",
  recommended: false,
});
