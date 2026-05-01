// Google Slides adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'google_slides',
  name: "Google Slides",
  kind: 'docs',
  category: 'docs',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Link or create Slides decks from events.",
  docsUrl: "https://developers.google.com/slides",
  recommended: false,
});
