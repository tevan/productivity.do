// Mem adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'mem',
  name: "Mem",
  kind: 'notes',
  category: 'notes',
  status: 'coming_soon',
  authType: 'pat',
  description: "AI-powered notes. Sync with Mem.ai.",
  docsUrl: "https://docs.mem.ai/",
  recommended: false,
  mode: 'sync',
});
