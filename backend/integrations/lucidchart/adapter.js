// Lucidchart adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'lucidchart',
  name: "Lucidchart",
  kind: 'whiteboards',
  category: 'whiteboards',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Link Lucidchart diagrams to events and notes.",
  docsUrl: "https://developer.lucid.co/",
  recommended: false,
});
