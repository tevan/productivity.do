import { makeStub } from '../_stub.js';
export const adapter = makeStub({
  provider: 'evernote',
  name: 'Evernote',
  kind: 'notes',
  category: 'notes',
  status: 'coming_soon',
  recommended: false,
  authType: 'oauth',
  description: 'Import notes from Evernote.',
  docsUrl: 'https://dev.evernote.com/doc/articles/authentication.php',
  requiresEnv: ['EVERNOTE_CONSUMER_KEY', 'EVERNOTE_CONSUMER_SECRET'],
});
