// Make adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'make',
  name: "Make",
  kind: 'automation',
  category: 'automation',
  status: 'coming_soon',
  authType: 'pat',
  description: "Build visual scenarios connecting productivity.do to thousands of apps.",
  docsUrl: "https://www.make.com/en/integrations/productivity-do",
  recommended: false,
});
