// ntfy adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'ntfy',
  name: 'ntfy',
  kind: 'communication',
  category: 'communication',
  status: 'coming_soon',
  authType: 'pat',
  description: 'Open-source push notifications. Self-host or use ntfy.sh.',
  docsUrl: 'https://ntfy.sh/docs/',
  recommended: false,
});
