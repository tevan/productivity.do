// Shortcut adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'shortcut',
  name: "Shortcut",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'pat',
  description: "Sync stories from Shortcut workspaces.",
  docsUrl: "https://developer.shortcut.com/",
  recommended: false,
  mode: 'sync',
});
