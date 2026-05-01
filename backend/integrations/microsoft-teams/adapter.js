// Microsoft Teams adapter — stub. Surfaced in the marketplace as "coming soon".
// Replace with a real implementation when this provider gets prioritized.

import { makeStub } from '../_stub.js';

export const adapter = makeStub({
  provider: 'microsoft_teams',
  name: "Microsoft Teams",
  kind: 'communication',
  category: 'communication',
  status: 'coming_soon',
  authType: 'oauth',
  description: "Post messages and create meeting links in Teams.",
  docsUrl: "https://learn.microsoft.com/microsoftteams/platform/",
  recommended: false,
});
