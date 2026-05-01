// Google Docs adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'google_docs',
  name: "Google Docs",
  kind: 'docs',
  category: 'docs',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Link or create Google Docs from events and notes.",
  docsUrl: "https://developers.google.com/docs",
  recommended: false,
});
