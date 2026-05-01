// Salesforce adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'salesforce',
  name: "Salesforce",
  kind: 'crm',
  category: 'crm',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Sync contacts and log meetings to Salesforce.",
  docsUrl: "https://developer.salesforce.com/docs/",
  recommended: false,
});
