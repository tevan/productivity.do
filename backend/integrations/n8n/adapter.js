// n8n adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'n8n',
  name: "n8n",
  kind: 'automation',
  category: 'automation',
  status: 'coming_soon',
  authType: 'pat',
  description: "Open-source automation. Self-host or use n8n.cloud.",
  docsUrl: "https://n8n.io/integrations/productivity-do",
  recommended: false,
});
