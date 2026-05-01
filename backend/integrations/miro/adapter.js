// Miro adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'miro',
  name: "Miro",
  kind: 'whiteboards',
  category: 'whiteboards',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Embed Miro boards in events and notes.",
  docsUrl: "https://developers.miro.com/",
  recommended: false,
});
