// Dropbox adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'dropbox',
  name: "Dropbox",
  kind: 'storage',
  category: 'storage',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Attach Dropbox files to events, tasks, and notes.",
  docsUrl: "https://www.dropbox.com/developers",
  recommended: false,
});
