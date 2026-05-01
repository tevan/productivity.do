// Buffer adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'buffer',
  name: "Buffer",
  kind: 'communication',
  category: 'communication',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Show scheduled social posts on your calendar.",
  docsUrl: "https://buffer.com/developers/api",
  recommended: false,
  mode: 'read',
});
