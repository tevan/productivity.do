// Sentry adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'sentry',
  name: "Sentry",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'pat',
  description: "Convert Sentry issues into tasks.",
  docsUrl: "https://docs.sentry.io/api/",
  recommended: false,
  mode: 'sync',
});
