// Office 365 (Word, Excel, PowerPoint) adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'office365',
  name: "Office 365 (Word, Excel, PowerPoint)",
  kind: 'docs',
  category: 'docs',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Link or create Office 365 documents.",
  docsUrl: "https://learn.microsoft.com/graph/",
  recommended: false,
});
