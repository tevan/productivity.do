// Obsidian adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'obsidian',
  name: "Obsidian",
  kind: 'notes',
  category: 'notes',
  status: 'coming_soon',
  authType: 'pat',
  description: "Sync notes to your Obsidian vault. Requires the Local REST API plugin.",
  docsUrl: "https://obsidian.md/",
  recommended: false,
});
