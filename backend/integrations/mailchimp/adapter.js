// Mailchimp adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'mailchimp',
  name: "Mailchimp",
  kind: 'communication',
  category: 'communication',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Show scheduled email campaigns on your calendar.",
  docsUrl: "https://mailchimp.com/developer/",
  recommended: false,
  mode: 'read',
});
