// Gmail adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'gmail',
  name: "Gmail",
  kind: 'email',
  category: 'email',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Convert emails to tasks, attach threads to events.",
  docsUrl: "https://developers.google.com/gmail/api",
  recommended: true,
});
