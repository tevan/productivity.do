// Harvest adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'harvest',
  name: "Harvest",
  kind: 'time',
  category: 'time',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Log Harvest time entries from tasks and events.",
  docsUrl: "https://help.getharvest.com/api-v2/",
  recommended: false,
});
