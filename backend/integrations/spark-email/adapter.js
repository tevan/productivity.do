// Spark Email adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'spark_email',
  name: "Spark Email",
  kind: 'email',
  category: 'email',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Convert Spark emails to tasks.",
  docsUrl: "https://sparkmailapp.com/",
  recommended: false,
  mode: 'import',
});
