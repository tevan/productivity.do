// Airtable adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'airtable',
  name: "Airtable",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'pat',
  description: "Sync rows from an Airtable base as tasks.",
  docsUrl: "https://airtable.com/developers/web/api",
  recommended: true,
});
