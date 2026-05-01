// /api/ai — AI provider connection + use.
//
//   GET    /api/ai                    — list providers + connection state
//   POST   /api/ai/:provider/connect  — validate key, store
//   POST   /api/ai/:provider/model    — set the user's model for this provider
//   POST   /api/ai/default            — set the user's default provider
//   DELETE /api/ai/:provider          — disconnect

import { Router } from 'express';
import { listAiAdapters, getAiAdapter } from '../ai/registry.js';
import { upsertIntegration, deleteIntegration, getIntegration } from '../integrations/store.js';
import { q } from '../db/init.js';
import { captureError } from '../lib/sentry.js';

const router = Router();

router.get('/api/ai', (req, res) => {
  const all = listAiAdapters();
  const prefRow = q('SELECT value FROM preferences WHERE user_id = ? AND key = ?')
    .get(req.user.id, 'aiProvider');
  let preferred;
  try { preferred = prefRow ? JSON.parse(prefRow.value) : null; } catch { preferred = prefRow?.value || null; }
  res.json({
    ok: true,
    default: preferred,
    providers: all.map(p => {
      const integ = getIntegration(req.user.id, `ai_${p.provider}`);
      const modelRow = q('SELECT value FROM preferences WHERE user_id = ? AND key = ?')
        .get(req.user.id, `aiModel_${p.provider}`);
      let model;
      try { model = modelRow ? JSON.parse(modelRow.value) : null; } catch { model = modelRow?.value || null; }
      return {
        ...p,
        connected: !!integ?.access_token,
        model: model || p.defaultModel,
      };
    }),
  });
});

router.post('/api/ai/:provider/connect', async (req, res) => {
  const a = getAiAdapter(req.params.provider);
  if (!a) return res.status(404).json({ ok: false, error: 'Unknown provider' });
  const key = req.body?.key?.trim();
  if (!key) return res.status(400).json({ ok: false, error: 'API key required' });
  try {
    await a.validate(key);
    upsertIntegration(req.user.id, `ai_${a.provider}`, { access_token: key });
    res.json({ ok: true });
  } catch (e) {
    captureError(e, { route: '/api/ai/connect', provider: a.provider, userId: req.user.id });
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/api/ai/:provider/model', (req, res) => {
  const a = getAiAdapter(req.params.provider);
  if (!a) return res.status(404).json({ ok: false, error: 'Unknown provider' });
  const model = req.body?.model;
  q(`
    INSERT INTO preferences (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
  `).run(req.user.id, `aiModel_${a.provider}`, JSON.stringify(model));
  res.json({ ok: true });
});

router.post('/api/ai/default', (req, res) => {
  const provider = req.body?.provider;
  if (!provider || !getAiAdapter(provider)) {
    return res.status(400).json({ ok: false, error: 'Unknown provider' });
  }
  q(`
    INSERT INTO preferences (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
  `).run(req.user.id, 'aiProvider', JSON.stringify(provider));
  res.json({ ok: true });
});

router.delete('/api/ai/:provider', (req, res) => {
  const a = getAiAdapter(req.params.provider);
  if (!a) return res.status(404).json({ ok: false, error: 'Unknown provider' });
  deleteIntegration(req.user.id, `ai_${a.provider}`);
  res.json({ ok: true });
});

export default router;
