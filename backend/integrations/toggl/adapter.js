// Toggl Track adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'toggl',
  name: "Toggl Track",
  kind: 'time',
  category: 'time',
  status: 'coming_soon',
  authType: 'pat',
  description: "Track time against tasks via Toggl.",
  docsUrl: "https://github.com/toggl/toggl_api_docs",
  recommended: false,
});
