// QuickBooks adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'quickbooks',
  name: "QuickBooks",
  kind: 'time',
  category: 'time',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Surface invoiceable time and unpaid invoices on your daily check-in.",
  docsUrl: "https://developer.intuit.com/app/developer/qbo/docs/get-started",
  recommended: false,
  mode: 'read',
});
