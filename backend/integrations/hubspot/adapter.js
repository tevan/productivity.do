// HubSpot adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'hubspot',
  name: "HubSpot",
  kind: 'crm',
  category: 'crm',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Sync contacts and log meetings to HubSpot.",
  docsUrl: "https://developers.hubspot.com/",
  recommended: false,
});
