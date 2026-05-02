/**
 * Plan-based feature limits + helpers.
 *
 * Single source of truth: `backend/config/plans.json`. The marketing
 * /pricing.html page should also pull from there (via /api/plans) so
 * the price + feature copy never drifts from what the server enforces.
 *
 * Pragmatic Programmer Tip 37 (DRY) + Tip 38 (orthogonality): plan data
 * is one concept; it lives in one file. Code that *acts* on plans (this
 * module + the upgrade-modal hook in api.js) consumes it.
 *
 * `null` in plans.json's limits means "unlimited"; we materialize that
 * to JS Infinity so downstream `count >= max` comparisons short-circuit.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getDb } from '../db/init.js';
import { getUserById } from './users.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadConfig() {
  const path = join(__dirname, '..', 'config', 'plans.json');
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  // Materialize null → Infinity for numeric "unlimited" limits so the
  // existing PLAN_LIMITS shape stays the same.
  const out = {};
  for (const [planId, plan] of Object.entries(raw.plans || {})) {
    const limits = {};
    for (const [k, v] of Object.entries(plan.limits || {})) {
      limits[k] = v === null ? Infinity : v;
    }
    out[planId] = limits;
  }
  return { limits: out, raw };
}

const _config = loadConfig();
export const PLAN_LIMITS = _config.limits;

// Expose the raw plan metadata (label, prices, marketingFeatures) so
// the marketing site / a /api/plans endpoint can serve it. Never
// imports it back into JS — JSON is the contract.
export function getPlanCatalog() { return _config.raw.plans; }

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
