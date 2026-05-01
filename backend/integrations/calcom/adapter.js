// Cal.com adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'calcom',
  name: "Cal.com",
  kind: 'meetings',
  category: 'meetings',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Import Cal.com event types and bookings.",
  docsUrl: "https://cal.com/docs/api-reference",
  recommended: false,
  mode: 'import',
});
