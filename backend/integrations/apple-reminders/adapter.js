// Apple Reminders adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'apple_reminders',
  name: "Apple Reminders",
  kind: 'tasks',
  category: 'tasks',
  status: 'coming_soon',
  authType: 'caldav',
  description: "Sync Apple Reminders via CalDAV (iCloud).",
  docsUrl: "https://support.apple.com/guide/icloud/",
  recommended: false,
});
