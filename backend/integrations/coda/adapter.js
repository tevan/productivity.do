// Coda adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'coda',
  name: "Coda",
  kind: 'docs',
  category: 'docs',
  status: 'coming_soon',
  authType: 'pat',
  description: "Read tasks and events from Coda docs.",
  docsUrl: "https://coda.io/developers/apis/v1",
  recommended: false,
});
