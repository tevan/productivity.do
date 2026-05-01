// Apple Notes adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'apple_notes',
  name: "Apple Notes",
  kind: 'notes',
  category: 'notes',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Sync notes with Apple Notes via iCloud. Requires the iOS / macOS companion app.",
  docsUrl: "https://www.apple.com/icloud/",
  recommended: false,
  mode: 'sync',
});
