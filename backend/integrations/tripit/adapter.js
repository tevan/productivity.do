// TripIt adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'tripit',
  name: "TripIt",
  kind: 'calendar',
  category: 'calendar',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Auto-import flights, hotels, and reservations to your calendar.",
  docsUrl: "https://www.tripit.com/developer",
  recommended: false,
  mode: 'read',
});
