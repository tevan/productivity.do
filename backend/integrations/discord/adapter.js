// Discord adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'discord',
  name: "Discord",
  kind: 'communication',
  category: 'communication',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Send notifications to a Discord channel.",
  docsUrl: "https://discord.com/developers/docs",
  recommended: false,
});
