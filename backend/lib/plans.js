/**
 * Plan-based feature limits + helpers.
 *
 * Defined here once so they're consistent across the app, the marketing
 * page, and the API.
 */

import { getDb } from '../db/init.js';
import { getUserById } from './users.js';

export const PLAN_LIMITS = {
  free: {
    bookingPagesMax: 1,
    bookingsPerMonthMax: 50,
    apiKeysMax: 1,
    apiRateLimitPerMin: 60,
    webhookSubscriptionsMax: 1,
    apiWriteAccess: false,
    aiScheduling: false,
    customBranding: false,
    customDomains: false,
    roundRobin: false,
    multipleEventTypes: false,
    customQuestions: false,
    groupEvents: false,
    workflows: false,
    routingForms: false,
    singleUseInvites: false,
    timePolls: false,
    teamFeatures: false,
    stripePayments: false,
  },
  pro: {
    bookingPagesMax: Infinity,
    bookingsPerMonthMax: Infinity,
    apiKeysMax: 25,
    apiRateLimitPerMin: 120,
    webhookSubscriptionsMax: 25,
    apiWriteAccess: true,
    aiScheduling: true,
    customBranding: true,
    customDomains: false,
    roundRobin: false,
    multipleEventTypes: true,
    customQuestions: true,
    groupEvents: true,
    workflows: true,
    routingForms: true,
    singleUseInvites: true,
    timePolls: true,
    teamFeatures: false,
    stripePayments: true,
  },
  team: {
    bookingPagesMax: Infinity,
    bookingsPerMonthMax: Infinity,
    apiKeysMax: 100,
    apiRateLimitPerMin: 600,
    webhookSubscriptionsMax: 100,
    apiWriteAccess: true,
    aiScheduling: true,
    customBranding: true,
    customDomains: true,
    roundRobin: true,
    multipleEventTypes: true,
    customQuestions: true,
    groupEvents: true,
    workflows: true,
    routingForms: true,
    singleUseInvites: true,
    timePolls: true,
    teamFeatures: true,
    stripePayments: true,
  },
};

/**
 * Get the user's effective plan (e.g. as a member of a team, inherit team's plan).
 */
export function getEffectivePlan(userId) {
  const user = getUserById(userId);
  if (!user) return 'free';
  // If the user belongs to a team, inherit the team admin's plan.
  if (user.team_id) {
    const team = getUserById(user.team_id);
    if (team) return team.plan;
  }
  return user.plan || 'free';
}

export function getLimits(userId) {
  const plan = getEffectivePlan(userId);
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

/**
 * Express middleware factory. Use to gate a route by a plan feature flag.
 *
 *   router.post('/api/booking-pages', requireFeature('multipleEventTypes'), handler);
 */
export function requireFeature(flag, opts = {}) {
  return (req, res, next) => {
    if (!req.user?.id) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    const limits = getLimits(req.user.id);
    if (!limits[flag]) {
      const upsell = opts.upsellTo || 'pro';
      return res.status(402).json({
        ok: false,
        code: 'plan_required',
        error: `This feature requires the ${upsell} plan.`,
        feature: opts.label || flag,
        requiredPlan: upsell,
        upsellTo: upsell,
        upgradeUrl: '/pricing.html',
      });
    }
    next();
  };
}

/**
 * Hard count guard — e.g. "can't create another booking page on Free."
 * Returns null if allowed, or an error object if blocked.
 */
export function checkCountLimit(userId, key, currentCount) {
  const limits = getLimits(userId);
  const max = limits[key];
  if (max === undefined || max === Infinity) return null;
  if (currentCount >= max) {
    return {
      ok: false,
      code: 'plan_required',
      error: `You've reached the limit for your plan (${max}). Upgrade to add more.`,
      feature: key,
      requiredPlan: limits === PLAN_LIMITS.free ? 'pro' : 'team',
      limit: max,
      currentCount,
      upgradeUrl: '/pricing.html',
    };
  }
  return null;
}

/**
 * Bookings-this-month counter for a user (counts across all their pages).
 * Returns the count, used by checkCountLimit('bookingsPerMonthMax', count).
 */
export function countBookingsThisMonth(userId) {
  const db = getDb();
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const row = db.prepare(`
    SELECT COUNT(*) as n
    FROM bookings b
    JOIN booking_pages p ON p.id = b.page_id
    WHERE p.user_id = ? AND b.created_at >= ?
  `).get(userId, start.toISOString());
  return row?.n || 0;
}
