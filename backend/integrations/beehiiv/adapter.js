// Beehiiv adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'beehiiv',
  name: "Beehiiv",
  kind: 'communication',
  category: 'communication',
  status: 'coming_soon',
  authType: 'pat',
  description: "Show scheduled newsletter sends on your calendar.",
  docsUrl: "https://developers.beehiiv.com/",
  recommended: false,
  mode: 'read',
});
