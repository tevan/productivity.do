// Apple Calendar (iCloud) adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'apple_calendar',
  name: "Apple Calendar (iCloud)",
  kind: 'calendar',
  category: 'calendar',
  status: 'coming_soon',
  authType: 'caldav',
  description: "Sync iCloud Calendar via CalDAV. Uses an app-specific password.",
  docsUrl: "https://support.apple.com/en-us/HT204397",
  recommended: true,
});
