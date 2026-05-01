// Yahoo Calendar adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'yahoo_calendar',
  name: "Yahoo Calendar",
  kind: 'calendar',
  category: 'calendar',
  status: 'coming_soon',
  authType: 'caldav',
  description: "Sync Yahoo Calendar via CalDAV.",
  docsUrl: "https://help.yahoo.com/kb/SLN3681.html",
  recommended: false,
});
