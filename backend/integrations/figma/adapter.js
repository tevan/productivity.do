// Figma adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'figma',
  name: "Figma",
  kind: 'design',
  category: 'design',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Link Figma files to events and notes.",
  docsUrl: "https://www.figma.com/developers/api",
  recommended: false,
});
