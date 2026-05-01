// Telegram adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'telegram',
  name: 'Telegram',
  kind: 'communication',
  category: 'communication',
  status: 'coming_soon',
  authType: 'pat',
  description: 'Send notifications to a Telegram chat via your bot token.',
  docsUrl: 'https://core.telegram.org/bots',
  recommended: false,
});
