// Fastmail Calendar adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'fastmail',
  name: "Fastmail Calendar",
  kind: 'calendar',
  category: 'calendar',
  status: 'coming_soon',
  authType: 'caldav',
  description: "Privacy-focused calendar via CalDAV. Uses an app-specific password.",
  docsUrl: "https://www.fastmail.com/help/clients/caldavcarddav.html",
  recommended: false,
});
