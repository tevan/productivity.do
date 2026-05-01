// Readwise adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'readwise',
  name: "Readwise",
  kind: 'notes',
  category: 'notes',
  status: 'coming_soon',
  authType: 'pat',
  description: "Import highlights from Readwise as notes.",
  docsUrl: "https://readwise.io/api_deets",
  recommended: true,
  mode: 'import',
});
