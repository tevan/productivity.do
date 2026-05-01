// SavvyCal adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'savvycal',
  name: "SavvyCal",
  kind: 'meetings',
  category: 'meetings',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Import SavvyCal scheduling links.",
  docsUrl: "https://savvycal.com/developers",
  recommended: false,
  mode: 'import',
});
