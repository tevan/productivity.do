// HEY Email adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'hey_email',
  name: "HEY Email",
  kind: 'email',
  category: 'email',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Convert HEY emails to tasks.",
  docsUrl: "https://www.hey.com/",
  recommended: false,
  mode: 'import',
});
