// Pushover adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'pushover',
  name: 'Pushover',
  kind: 'communication',
  category: 'communication',
  status: 'coming_soon',
  authType: 'pat',
  description: 'Push notifications to your phone or desktop via Pushover.',
  docsUrl: 'https://pushover.net/api',
  recommended: false,
});
