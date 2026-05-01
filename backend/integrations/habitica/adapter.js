// Habitica adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'habitica',
  name: "Habitica",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'pat',
  description: "Gamified habits. Sync habits and dailies as recurring tasks.",
  docsUrl: "https://habitica.com/apidoc/",
  recommended: false,
  mode: 'sync',
});
