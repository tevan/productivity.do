// Proton Calendar adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'proton_calendar',
  name: "Proton Calendar",
  kind: 'calendar',
  category: 'calendar',
  status: 'coming_soon',
  authType: 'caldav',
  description: "Encrypted calendar via Proton CalDAV.",
  docsUrl: "https://proton.me/support/proton-calendar-caldav",
  recommended: false,
});
