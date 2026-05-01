/**
 * Billing routes — Stripe Checkout, Customer Portal, webhooks.
 *
 * Webhook signature verification needs the RAW request body, so the webhook
 * route uses express.raw() instead of express.json(). It must be mounted
 * BEFORE the global JSON body parser (handled in server.js).
 */

import { Router } from 'express';
import express from 'express';
import {
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
  isStripeConfigured,
} from '../lib/stripe.js';
import { getUserById } from '../lib/users.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/billing/checkout?plan=pro&period=monthly — redirect to Stripe Checkout
// ---------------------------------------------------------------------------
router.get('/api/billing/checkout', async (req, res) => {
  try {
    const userId = req.session?.userId || req.user?.id;
    if (!userId) return res.status(401).redirect('/login');
    if (!isStripeConfigured()) {
      return res.status(503).type('html').send('Billing is not configured yet. Please try again later.');
    }
    const plan = req.query.plan;
    const period = req.query.period === 'annual' ? 'annual' : 'monthly';
    if (!['pro', 'team'].includes(plan)) {
      return res.status(400).type('html').send('Invalid plan.');
    }
    const session = await createCheckoutSession({ userId, plan, period });
    res.redirect(303, session.url);
  } catch (err) {
    console.error('checkout error:', err.message);
    res.status(500).type('html').send(`Checkout failed: ${err.message}`);
  }
});

// POST variant for SPA / API callers
router.post('/api/billing/checkout', express.json(), async (req, res) => {
  try {
    const userId = req.session?.userId || req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    if (!isStripeConfigured()) {
      return res.status(503).json({ ok: false, error: 'Billing not configured' });
    }
    const { plan, period } = req.body || {};
    if (!['pro', 'team'].includes(plan)) {
      return res.status(400).json({ ok: false, error: 'Invalid plan' });
    }
    const session = await createCheckoutSession({
      userId,
      plan,
      period: period === 'annual' ? 'annual' : 'monthly',
    });
    res.json({ ok: true, url: session.url, id: session.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/billing/portal — redirect to Stripe Customer Portal
// ---------------------------------------------------------------------------
router.get('/api/billing/portal', async (req, res) => {
  try {
    const userId = req.session?.userId || req.user?.id;
    if (!userId) return res.status(401).redirect('/login');
    const session = await createPortalSession({ userId });
    res.redirect(303, session.url);
  } catch (err) {
    res.status(500).type('html').send(err.message);
  }
});

// ---------------------------------------------------------------------------
// GET /api/billing/me — current plan / subscription state for the SPA
// ---------------------------------------------------------------------------
router.get('/api/billing/me', (req, res) => {
  const userId = req.session?.userId || req.user?.id;
  if (!userId) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const user = getUserById(userId);
  if (!user) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      plan: user.plan,
      hasSubscription: !!user.stripe_subscription_id,
      currentPeriodEnd: user.current_period_end,
      emailVerified: !!user.email_verified,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/stripe/webhook — Stripe-signed events. RAW body required.
//
// Mount this with express.raw() at the server level BEFORE global express.json()
// or its signature check will fail. We export the raw-handler factory below.
// ---------------------------------------------------------------------------
export const stripeWebhookHandler = [
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.get('stripe-signature');
    if (!sig) return res.status(400).send('Missing stripe-signature');
    try {
      const result = await handleWebhook(req.body, sig);
      res.json({ received: true, type: result.type });
    } catch (err) {
      console.warn('Stripe webhook error:', err.message);
      res.status(400).send(err.message);
    }
  },
];

export default router;
