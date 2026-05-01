// Logseq adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'logseq',
  name: "Logseq",
  kind: 'notes',
  category: 'notes',
  status: 'coming_soon',
  authType: 'pat',
  description: "Open-source PKM. Sync notes from a Logseq graph.",
  docsUrl: "https://logseq.com/",
  recommended: false,
  mode: 'sync',
});
