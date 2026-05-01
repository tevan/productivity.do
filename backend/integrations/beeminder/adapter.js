// Beeminder adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'beeminder',
  name: "Beeminder",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'pat',
  description: "Track Beeminder goals as recurring tasks.",
  docsUrl: "https://www.beeminder.com/api",
  recommended: false,
  mode: 'sync',
});
