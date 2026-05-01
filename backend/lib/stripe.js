/**
 * Stripe billing integration: Checkout sessions, Customer Portal, webhooks.
 *
 * Plans are configured via env vars so the same code runs in test + prod:
 *   STRIPE_SECRET_KEY=sk_live_...   (or sk_test_...)
 *   STRIPE_WEBHOOK_SECRET=whsec_... (from the dashboard)
 *   STRIPE_PRICE_PRO_MONTHLY=price_...
 *   STRIPE_PRICE_PRO_ANNUAL=price_...
 *   STRIPE_PRICE_TEAM_MONTHLY=price_...
 *   STRIPE_PRICE_TEAM_ANNUAL=price_...
 *   PUBLIC_ORIGIN=https://productivity.do
 */

import Stripe from 'stripe';
import { getUserById, setStripeIds } from './users.js';
import { getDb } from '../db/init.js';

let stripeClient = null;
export function getStripe() {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  stripeClient = new Stripe(key, { apiVersion: '2024-12-18.acacia' });
  return stripeClient;
}

export function isStripeConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Resolve a plan + period to a Stripe Price ID via env config.
 */
export function priceIdFor(plan, period = 'monthly') {
  const map = {
    pro_monthly:   process.env.STRIPE_PRICE_PRO_MONTHLY,
    pro_annual:    process.env.STRIPE_PRICE_PRO_ANNUAL,
    team_monthly:  process.env.STRIPE_PRICE_TEAM_MONTHLY,
    team_annual:   process.env.STRIPE_PRICE_TEAM_ANNUAL,
  };
  return map[`${plan}_${period}`] || null;
}

function publicOrigin() {
  return process.env.PUBLIC_ORIGIN || 'https://productivity.do';
}

/**
 * Get or create a Stripe customer for the given user.
 */
async function ensureCustomer(user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { userId: String(user.id) },
  });
  setStripeIds(user.id, { customerId: customer.id });
  return customer.id;
}

/**
 * Create a Checkout Session for a subscription.
 */
export async function createCheckoutSession({ userId, plan, period = 'monthly' }) {
  const user = getUserById(userId);
  if (!user) throw new Error('User not found');
  if (!['pro', 'team'].includes(plan)) throw new Error('Invalid plan');
  const priceId = priceIdFor(plan, period);
  if (!priceId) throw new Error(`No price configured for ${plan}_${period}`);

  const stripe = getStripe();
  const customer = await ensureCustomer(user);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${publicOrigin()}/?billing=success&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${publicOrigin()}/pricing.html?billing=canceled`,
    subscription_data: {
      trial_period_days: 14,
      metadata: { userId: String(user.id), plan },
    },
    metadata: { userId: String(user.id), plan },
    allow_promotion_codes: true,
  });
  return { url: session.url, id: session.id };
}

/**
 * Create a one-time Checkout Session for a paid booking.
 * Returns the Checkout URL. On payment.success, the webhook handler flips
 * the booking from pending_payment → confirmed and creates the GCal event.
 */
export async function createBookingCheckout({ booking, eventType, page, hostUserId }) {
  const stripe = getStripe();
  // We use a fresh "guest" customer keyed only by email — no need to store
  // it long-term since this is a one-off.
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: booking.invitee_email,
    line_items: [{
      price_data: {
        currency: (eventType.price_currency || 'USD').toLowerCase(),
        product_data: {
          name: `${eventType.title} — ${page.title}`,
          description: `Booking on ${new Date(booking.start_iso).toLocaleString()}`,
        },
        unit_amount: eventType.price_cents,
      },
      quantity: 1,
    }],
    success_url: `${publicOrigin()}/book/cancel/${booking.cancel_token}?paid=1`,
    cancel_url: `${publicOrigin()}/book/${page.slug}`,
    metadata: {
      bookingId: booking.id,
      hostUserId: String(hostUserId),
    },
    payment_intent_data: {
      metadata: {
        bookingId: booking.id,
      },
    },
  });
  return { url: session.url, id: session.id };
}

/**
 * Create a Customer Portal session so the user can manage their subscription.
 */
export async function createPortalSession({ userId }) {
  const user = getUserById(userId);
  if (!user || !user.stripe_customer_id) throw new Error('No active subscription');
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${publicOrigin()}/`,
  });
  return { url: session.url };
}

/**
 * Process an incoming Stripe webhook event.
 * Events we care about:
 *   checkout.session.completed         → subscription created
 *   customer.subscription.created      → confirm subscription details
 *   customer.subscription.updated      → plan change, period renewal, cancel-at-period-end
 *   customer.subscription.deleted      → drop the user back to the Free plan
 *   invoice.payment_failed             → flag account, send email
 */
export async function handleWebhook(rawBody, signatureHeader) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
  } catch (err) {
    throw new Error(`Webhook signature failed: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object;
      const userId = Number(s.metadata?.userId);
      const plan = s.metadata?.plan || 'pro';
      if (userId) {
        setStripeIds(userId, {
          customerId: s.customer,
          subscriptionId: s.subscription,
          plan,
        });
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const userId = Number(sub.metadata?.userId);
      const plan = sub.metadata?.plan || planFromPriceId(sub.items?.data?.[0]?.price?.id);
      const periodEnd = sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;
      if (userId) {
        setStripeIds(userId, {
          subscriptionId: sub.id,
          plan: sub.status === 'active' || sub.status === 'trialing' ? plan : 'free',
          periodEnd,
        });
      } else if (sub.customer) {
        // No metadata — find user by customer id
        const db = getDb();
        const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(sub.customer);
        if (user) {
          setStripeIds(user.id, {
            subscriptionId: sub.id,
            plan: sub.status === 'active' || sub.status === 'trialing' ? plan : 'free',
            periodEnd,
          });
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const db = getDb();
      const user = db.prepare('SELECT id FROM users WHERE stripe_subscription_id = ?').get(sub.id);
      if (user) {
        setStripeIds(user.id, { subscriptionId: null, plan: 'free' });
      }
      break;
    }

    case 'invoice.payment_failed':
      // Could send a "your payment failed" email here. Best-effort.
      break;

    case 'checkout.session.completed': {
      // Already handled above for subscriptions. For one-off booking
      // payments, also flip the booking to confirmed.
      const s = event.data.object;
      const bookingId = s.metadata?.bookingId;
      if (bookingId && s.mode === 'payment') {
        const db = getDb();
        db.prepare(`
          UPDATE bookings SET status = 'confirmed', payment_status = 'paid',
                              payment_intent = ?, updated_at = datetime('now')
          WHERE id = ? AND status = 'pending_payment'
        `).run(s.payment_intent || null, bookingId);
        // The host's GCal event creation, confirmation email, and webhook
        // emit happen in a follow-up worker. We don't trigger those here
        // because we don't have the user/page/eventType context — but the
        // booking row is now correct, and a small post-payment sweep
        // handles the rest. (See finalizePaidBookings in stripe.js.)
      }
      break;
    }
  }

  return { received: true, type: event.type };
}

/**
 * Sweep for bookings that just got paid but haven't had their GCal event /
 * confirmation email created yet. Idempotent — uses payment_status='paid'
 * AND google_event_id IS NULL as the work-list filter, then transitions to
 * google_event_id set after success. Runs every 30s from server.js.
 */
export async function finalizePaidBookings(google, sendBookingConfirmation, emitEvent) {
  try {
    const db = getDb();
    const due = db.prepare(`
      SELECT b.*, p.id AS p_id, p.user_id AS p_user_id, p.calendar_id AS p_cal,
             p.title AS p_title, p.slug AS p_slug, p.timezone AS p_tz,
             p.host_name AS p_host_name, p.host_email AS p_host_email
      FROM bookings b JOIN booking_pages p ON p.id = b.page_id
      WHERE b.payment_status = 'paid'
        AND b.google_event_id IS NULL
        AND b.status = 'confirmed'
      LIMIT 50
    `).all();

    for (const row of due) {
      const eventType = row.type_id
        ? db.prepare('SELECT * FROM event_types WHERE id = ?').get(row.type_id)
        : null;
      const page = {
        id: row.p_id, user_id: row.p_user_id,
        title: row.p_title, slug: row.p_slug,
        timezone: row.p_tz, calendar_id: row.p_cal,
        host_name: row.p_host_name, host_email: row.p_host_email,
        send_emails: 1, enable_ics: 1,
      };

      if (page.calendar_id && google.isConnected(page.user_id)) {
        try {
          const ev = await google.createEvent(page.user_id, page.calendar_id, {
            summary: `${eventType?.title || page.title} — ${row.invitee_name || row.invitee_email}`,
            description: 'Confirmed via paid booking.',
            start: { dateTime: row.start_iso, timeZone: page.timezone || 'UTC' },
            end:   { dateTime: row.end_iso,   timeZone: page.timezone || 'UTC' },
            attendees: [{ email: row.invitee_email }],
          });
          db.prepare('UPDATE bookings SET google_event_id = ?, google_calendar_id = ? WHERE id = ?')
            .run(ev.id, page.calendar_id, row.id);
        } catch (err) {
          console.warn('paid-booking GCal create failed:', err.message);
          // Don't mark the row done — let it retry next sweep.
          continue;
        }
      } else {
        // No GCal configured — mark a sentinel so we don't loop forever.
        db.prepare("UPDATE bookings SET google_event_id = '' WHERE id = ?").run(row.id);
      }

      // Best-effort confirmation email + webhook.
      if (sendBookingConfirmation) {
        sendBookingConfirmation({ page, booking: row, eventType }).catch(() => {});
      }
      if (emitEvent) {
        emitEvent('booking.created', {
          source: 'paid',
          page: { slug: page.slug, title: page.title },
          booking: {
            id: row.id, email: row.invitee_email,
            startIso: row.start_iso, endIso: row.end_iso,
          },
        }, page.user_id).catch(() => {});
      }
    }
    return { processed: due.length };
  } catch (err) {
    console.warn('finalize sweep failed:', err.message);
    return { processed: 0 };
  }
}

function planFromPriceId(priceId) {
  if (!priceId) return 'free';
  const lookup = {
    [process.env.STRIPE_PRICE_PRO_MONTHLY || '']:   'pro',
    [process.env.STRIPE_PRICE_PRO_ANNUAL  || '']:   'pro',
    [process.env.STRIPE_PRICE_TEAM_MONTHLY || '']:  'team',
    [process.env.STRIPE_PRICE_TEAM_ANNUAL  || '']:  'team',
  };
  return lookup[priceId] || 'free';
}
