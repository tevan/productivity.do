// Matter adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'matter',
  name: "Matter",
  kind: 'notes',
  category: 'notes',
  status: 'coming_soon',
  authType: 'pat',
  description: "Import Matter highlights and articles as notes.",
  docsUrl: "https://hq.getmatter.com/",
  recommended: false,
  mode: 'import',
});
