// Slack adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'slack',
  name: "Slack",
  kind: 'communication',
  category: 'communication',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Post booking confirmations and reminders to a Slack channel.",
  docsUrl: "https://api.slack.com/apps",
  recommended: true,
});
