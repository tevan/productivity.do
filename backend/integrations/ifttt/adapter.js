// IFTTT adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'ifttt',
  name: "IFTTT",
  kind: 'automation',
  category: 'automation',
  status: 'coming_soon',
  authType: 'pat',
  description: "Trigger applets when things happen in productivity.do.",
  docsUrl: "https://ifttt.com/productivity-do",
  recommended: false,
});
