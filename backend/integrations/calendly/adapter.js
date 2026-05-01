// Calendly adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'calendly',
  name: "Calendly",
  kind: 'meetings',
  category: 'meetings',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Import your Calendly event types and bookings to switch.",
  docsUrl: "https://developer.calendly.com/",
  recommended: false,
  mode: 'import',
});
