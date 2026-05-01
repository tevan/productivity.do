// Zoom adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'zoom',
  name: "Zoom",
  kind: 'meetings',
  category: 'meetings',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Generate Zoom meeting links automatically when scheduling events.",
  docsUrl: "https://marketplace.zoom.us/docs/guides/build/oauth-app/",
  recommended: true,
});
