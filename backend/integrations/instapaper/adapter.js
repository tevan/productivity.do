// Instapaper adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'instapaper',
  name: "Instapaper",
  kind: 'notes',
  category: 'notes',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Save Instapaper articles as notes.",
  docsUrl: "https://www.instapaper.com/api",
  recommended: false,
  mode: 'import',
});
