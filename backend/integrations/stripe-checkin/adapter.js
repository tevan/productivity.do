// Stripe (daily check-in) adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'stripe_checkin',
  name: "Stripe (daily check-in)",
  kind: 'time',
  category: 'time',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Show today's MRR, new customers, and disputes as a daily widget.",
  docsUrl: "https://stripe.com/docs/api",
  recommended: false,
  mode: 'read',
});
