// Google Drive adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'google_drive',
  name: "Google Drive",
  kind: 'storage',
  category: 'storage',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Attach Drive files to events, tasks, and notes.",
  docsUrl: "https://developers.google.com/drive",
  recommended: true,
});
