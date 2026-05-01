// Google Sheets adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'google_sheets',
  name: "Google Sheets",
  kind: 'docs',
  category: 'docs',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Push event/booking data to a Sheet, or pull tasks from one.",
  docsUrl: "https://developers.google.com/sheets",
  recommended: false,
});
