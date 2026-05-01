// Typeform adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'typeform',
  name: "Typeform",
  kind: 'forms',
  category: 'forms',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Capture Typeform responses as tasks or bookings.",
  docsUrl: "https://www.typeform.com/developers/",
  recommended: false,
});
