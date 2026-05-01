// Google Meet adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'google_meet',
  name: "Google Meet",
  kind: 'meetings',
  category: 'meetings',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Add Google Meet links to events. Uses your Google account.",
  docsUrl: "https://developers.google.com/meet",
  recommended: false,
});
