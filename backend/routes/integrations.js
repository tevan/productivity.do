// /api/integrations — single-surface admin for all third-party connections.
//
//   GET    /api/integrations              — what's available + the user's
//                                            current connection state
//   POST   /api/integrations/:provider/pat               — paste a PAT
//   POST   /api/integrations/:provider/caldav            — CalDAV creds
//   GET    /api/integrations/:provider/oauth/start       — redirect URL
//   GET    /api/integrations/:provider/oauth/callback    — handle code
//   POST   /api/integrations/:provider/sync              — trigger sync now
//   POST   /api/integrations/:provider/config            — set provider-specific
//                                                          config (database id,
//                                                          board ids, team ids)
//   GET    /api/integrations/:provider/databases         — Notion: list dbs
//   GET    /api/integrations/:provider/boards            — Trello: list boards
//   GET    /api/integrations/:provider/teams             — Linear: list teams
//   DELETE /api/integrations/:provider                   — disconnect

import { Router } from 'express';
import { getAdapter, listAdapters } from '../integrations/registry.js';
import { listUserIntegrations, getIntegration } from '../integrations/store.js';
import { captureError } from '../lib/sentry.js';

const router = Router();

router.get('/api/integrations', (req, res) => {
  const all = listAdapters();
  const mine = listUserIntegrations(req.user.id);
  const byProvider = new Map(mine.map(i => [i.provider, i]));
  res.json({
    ok: true,
    available: all.map(a => ({
      ...a,
      connected: !!byProvider.get(a.provider),
      status: byProvider.get(a.provider)?.status || null,
      account_email: byProvider.get(a.provider)?.account_email || null,
      last_synced_at: byProvider.get(a.provider)?.last_synced_at || null,
      last_error: byProvider.get(a.provider)?.last_error || null,
    })),
  });
});

router.post('/api/integrations/:provider/pat', async (req, res) => {
  const a = getAdapter(req.params.provider);
  if (!a) return res.status(404).json({ ok: false, error: 'Unknown provider' });
  if (a.authType !== 'pat') return res.status(400).json({ ok: false, error: 'Provider does not use PAT auth' });
  try {
    const result = await a.authValidatePat(req.user.id, req.body?.token || '');
    res.json({ ok: true, ...result });
  } catch (e) {
    captureError(e, { route: 'integrations/pat', provider: req.params.provider, userId: req.user.id });
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/api/integrations/:provider/caldav', async (req, res) => {
  const a = getAdapter(req.params.provider);
  if (!a || a.authType !== 'caldav') return res.status(400).json({ ok: false, error: 'Not a CalDAV provider' });
  try {
    const result = await a.authValidateCaldav(req.user.id, req.body || {});
    res.json({ ok: true, ...result });
  } catch (e) {
    captureError(e, { route: 'integrations/caldav', provider: req.params.provider, userId: req.user.id });
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/api/integrations/:provider/oauth/start', async (req, res) => {
  const a = getAdapter(req.params.provider);
  if (!a || a.authType !== 'oauth') return res.status(400).json({ ok: false, error: 'Not an OAuth provider' });
  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/api/integrations/${a.provider}/oauth/callback`;
    const url = await a.authStartUrl(req.user.id, redirectUri);
    res.json({ ok: true, url });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/integrations/:provider/oauth/callback', async (req, res) => {
  const a = getAdapter(req.params.provider);
  if (!a) return res.status(404).send('Unknown provider');
  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/api/integrations/${a.provider}/oauth/callback`;
    await a.authCallback(req.user.id, req.query.code, redirectUri);
    // Redirect back into the SPA — Settings → Integrations.
    res.redirect('/?settings=integrations&connected=' + encodeURIComponent(a.provider));
  } catch (e) {
    captureError(e, { route: 'integrations/oauth/callback', provider: req.params.provider, userId: req.user.id });
    res.status(500).send(`Connection failed: ${e.message}`);
  }
});

router.post('/api/integrations/:provider/sync', async (req, res) => {
  const a = getAdapter(req.params.provider);
  if (!a) return res.status(404).json({ ok: false, error: 'Unknown provider' });
  try {
    const out = {};
    if ((a.kind || '').includes('tasks') && a.syncTasks) out.tasks = await a.syncTasks(req.user.id);
    if ((a.kind || '').includes('calendar') && a.syncEvents) out.events = await a.syncEvents(req.user.id);
    res.json({ ok: true, ...out });
  } catch (e) {
    captureError(e, { route: 'integrations/sync', provider: req.params.provider, userId: req.user.id });
    res.status(500).json({ ok: false, error: e.message, code: e.code });
  }
});

// Generic config endpoint — body is provider-specific. We do per-provider
// dispatch here rather than separate routes since the shape varies.
router.post('/api/integrations/:provider/config', async (req, res) => {
  const a = getAdapter(req.params.provider);
  if (!a) return res.status(404).json({ ok: false, error: 'Unknown provider' });
  try {
    if (a.provider === 'notion' && req.body?.databaseId) {
      await a.setDatabase(req.user.id, req.body.databaseId);
    } else if (a.provider === 'trello' && Array.isArray(req.body?.boardIds)) {
      await a.setBoards(req.user.id, req.body.boardIds);
    } else if (a.provider === 'linear' && Array.isArray(req.body?.teamIds)) {
      await a.setTeams(req.user.id, req.body.teamIds);
    } else {
      return res.status(400).json({ ok: false, error: 'No recognized config for this provider' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Provider-specific lookup endpoints — the Settings UI uses these to populate
// the post-connect picker (which Notion db, which Trello boards, etc.).
router.get('/api/integrations/notion/databases', async (req, res) => {
  try {
    const a = getAdapter('notion');
    res.json({ ok: true, databases: await a.listDatabases(req.user.id) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
router.get('/api/integrations/trello/boards', async (req, res) => {
  try {
    const a = getAdapter('trello');
    res.json({ ok: true, boards: await a.listBoards(req.user.id) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
router.get('/api/integrations/linear/teams', async (req, res) => {
  try {
    const a = getAdapter('linear');
    res.json({ ok: true, teams: await a.listTeams(req.user.id) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete('/api/integrations/:provider', async (req, res) => {
  const a = getAdapter(req.params.provider);
  if (!a) return res.status(404).json({ ok: false, error: 'Unknown provider' });
  try {
    await a.disconnect(req.user.id, { wipeCache: req.query.wipe !== '0' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
