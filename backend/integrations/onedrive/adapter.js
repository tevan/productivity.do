// OneDrive adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'onedrive',
  name: "OneDrive",
  kind: 'storage',
  category: 'storage',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Attach OneDrive files. Uses your Microsoft account.",
  docsUrl: "https://learn.microsoft.com/onedrive/developer/",
  recommended: false,
});
