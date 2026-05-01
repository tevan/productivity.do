/**
 * Authenticated routes that the SPA uses to manage API keys and webhook
 * subscriptions. These complement the public /api/v1/* surface.
 */

import { Router } from 'express';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  deleteApiKey,
  SCOPES,
} from '../lib/apiKeys.js';
import {
  listSubscriptions,
  createSubscription,
  updateSubscription,
  rotateSubscriptionSecret,
  deleteSubscription,
} from '../lib/webhooks.js';
import { isSafeWebhookUrl } from '../lib/notify.js';
import { getDb } from '../db/init.js';

const router = Router();

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------
router.get('/api/api-keys', (req, res) => {
  res.json({ ok: true, keys: listApiKeys(req.user.id), scopes: SCOPES });
});

router.post('/api/api-keys', (req, res) => {
  try {
    const b = req.body || {};
    if (!Array.isArray(b.scopes) || b.scopes.length === 0) {
      return res.status(400).json({ ok: false, error: 'scopes[] required' });
    }
    for (const s of b.scopes) {
      if (!SCOPES.includes(s)) return res.status(400).json({ ok: false, error: `unknown scope: ${s}` });
    }
    const created = createApiKey({ name: b.name, scopes: b.scopes, userId: req.user.id });
    res.json({ ok: true, key: created });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/api/api-keys/:id/revoke', (req, res) => {
  revokeApiKey(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.delete('/api/api-keys/:id', (req, res) => {
  deleteApiKey(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Webhook subscriptions (admin)
// ---------------------------------------------------------------------------
router.get('/api/webhooks', (req, res) => {
  res.json({ ok: true, subscriptions: listSubscriptions(req.user.id) });
});

router.post('/api/webhooks', (req, res) => {
  const b = req.body || {};
  if (!b.url) return res.status(400).json({ ok: false, error: 'url required' });
  if (!isSafeWebhookUrl(b.url)) {
    return res.status(400).json({ ok: false, error: 'url must be HTTPS to a public hostname' });
  }
  if (!Array.isArray(b.events) || b.events.length === 0) {
    return res.status(400).json({ ok: false, error: 'events[] required' });
  }
  res.json({ ok: true, subscription: createSubscription({ ...b, userId: req.user.id }) });
});

router.put('/api/webhooks/:id', (req, res) => {
  const b = req.body || {};
  if (b.url && !isSafeWebhookUrl(b.url)) {
    return res.status(400).json({ ok: false, error: 'url must be HTTPS to a public hostname' });
  }
  const sub = updateSubscription(req.params.id, b, req.user.id);
  if (!sub) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, subscription: sub });
});

router.post('/api/webhooks/:id/rotate-secret', (req, res) => {
  const r = rotateSubscriptionSecret(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, ...r });
});

router.delete('/api/webhooks/:id', (req, res) => {
  deleteSubscription(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.get('/api/webhooks/:id/deliveries', (req, res) => {
  const db = getDb();
  // Verify ownership of the subscription before exposing delivery records.
  const sub = db.prepare('SELECT user_id FROM webhook_subscriptions WHERE id = ?').get(req.params.id);
  if (!sub || sub.user_id !== req.user.id) {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }
  const rows = db.prepare(`
    SELECT id, event, status_code, attempt, delivered_at, next_retry_at, created_at
    FROM webhook_deliveries WHERE subscription_id = ?
    ORDER BY created_at DESC LIMIT 100
  `).all(req.params.id);
  res.json({ ok: true, deliveries: rows });
});

export default router;
