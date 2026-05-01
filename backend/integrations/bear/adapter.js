// Bear adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'bear',
  name: "Bear",
  kind: 'notes',
  category: 'notes',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Send notes to Bear via x-callback-url. Requires the macOS or iOS app.",
  docsUrl: "https://bear.app/faq/X-callback-url%20Scheme%20documentation/",
  recommended: false,
  mode: 'sync',
});
