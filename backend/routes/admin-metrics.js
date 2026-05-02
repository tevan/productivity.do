/**
 * Admin-only product-health metrics.
 *
 * Surfaces a small set of outcome metrics computed from existing tables —
 * no analytics-events table; we don't have one yet and won't until the
 * volume warrants it. These are the six numbers we actually steer by:
 *
 *   1. New signups (last 30 days, plus prior-30 comparison)
 *   2. Activation rate — % of signups who hit "≥3 captures in 7 days"
 *   3. Weekly active users (last 4 buckets, distinct user_id per week)
 *   4. Plan distribution (free/pro/team counts)
 *   5. Retention — D1/D7/D30 from a signup cohort
 *   6. Booking-page conversion — views → confirmed bookings (last 30d)
 *
 * Inspired by Cagan's "outcomes not outputs" framing. Numbers that don't
 * change behavior are noise; these are the ones we'd act on (e.g. low
 * activation → onboarding work; low D7 retention → habit / value gap;
 * low booking conversion → page-design or availability problem).
 *
 * Auth: session-only, gated to user_id=1 (the seed/owner) plus any user
 * with is_team_admin=1. This is internal — no API-key access.
 */

import { Router } from 'express';
import { getDb } from '../db/init.js';

const router = Router();

function isAdmin(req) {
  if (!req.session?.userId) return false;
  if (req.session.userId === 1) return true; // seed user
  const row = getDb().prepare('SELECT is_team_admin FROM users WHERE id = ?').get(req.session.userId);
  return !!row?.is_team_admin;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
  next();
}

// One-shot computation; small enough that we don't need to cache — single
// DB hit per metric, no joins beyond user_id.
function computeMetrics() {
  const db = getDb();

  // --- 1. signups: trailing 30d vs prior 30d ---
  // Exclude soft-deleted users — we only want real signups in the funnel.
  const signupsCurrent = db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', '-30 days') AND deleted_at IS NULL"
  ).get().n;
  const signupsPrior = db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', '-60 days') AND created_at < datetime('now', '-30 days') AND deleted_at IS NULL"
  ).get().n;

  // Signups by day for sparkline (30-day trailing window).
  const signupsByDay = db.prepare(`
    SELECT DATE(created_at) AS day, COUNT(*) AS n
    FROM users
    WHERE created_at >= datetime('now', '-30 days') AND deleted_at IS NULL
    GROUP BY DATE(created_at)
    ORDER BY day
  `).all();

  // --- 2. activation: signups in the last 60d where the user came back
  //     for a SECOND day within the first 7 days. The "aha" for a day-
  //     surface tool is just "did they open it again tomorrow" — if they
  //     never come back, no amount of capture-counting matters.
  //     Source: distinct DATE(last_seen_at) per user from user_sessions,
  //     within the user's first-7-day window. Activated = ≥2 distinct
  //     days touched (signup day + at least one return).
  // Cohort floor at 7 days ago so each user has had a full window.
  const activationCohort = db.prepare(`
    SELECT id, created_at FROM users
    WHERE created_at >= datetime('now', '-60 days') AND created_at < datetime('now', '-7 days')
  `).all();
  let activated = 0;
  const activationStmt = db.prepare(`
    SELECT COUNT(DISTINCT DATE(last_seen_at)) AS days
    FROM user_sessions
    WHERE user_id = ?
      AND last_seen_at >= ?
      AND last_seen_at <  datetime(?, '+7 days')
  `);
  for (const u of activationCohort) {
    const r = activationStmt.get(u.id, u.created_at, u.created_at);
    if ((r?.days || 0) >= 2) activated++;
  }
  const activationRate = activationCohort.length > 0
    ? Math.round((activated / activationCohort.length) * 1000) / 10
    : null;

  // --- 3. WAU — distinct user_ids active in each of last 4 weekly buckets ---
  // user_sessions.last_seen_at is touched on every authenticated request
  // via session middleware; that's our source of truth for "active".
  const wauBuckets = [];
  for (let w = 0; w < 4; w++) {
    const start = `-${(w + 1) * 7} days`;
    const end = `-${w * 7} days`;
    const r = db.prepare(`
      SELECT COUNT(DISTINCT user_id) AS n FROM user_sessions
      WHERE last_seen_at >= datetime('now', ?) AND last_seen_at < datetime('now', ?)
    `).get(start, end);
    wauBuckets.push({ weekAgo: w, n: r?.n || 0 });
  }
  // Most-recent-first ordering for sparkline; reverse for chart.
  const wau = wauBuckets[0]?.n || 0;
  const wauPrev = wauBuckets[1]?.n || 0;

  // --- 4. plan distribution ---
  const planRows = db.prepare(`
    SELECT plan, COUNT(*) AS n FROM users
    WHERE deleted_at IS NULL
    GROUP BY plan
  `).all();
  const plans = { free: 0, pro: 0, team: 0 };
  for (const r of planRows) plans[r.plan] = r.n;

  // --- 5. retention curve (D1 / D7 / D30) ---
  // Cohort: users who signed up between 60d and 30d ago (need a 30-day
  // tail to evaluate D30). For each, did they have a session at D1, D7,
  // D30 ± 1 day from their signup?
  const retCohort = db.prepare(`
    SELECT id, created_at FROM users
    WHERE created_at >= datetime('now', '-60 days') AND created_at < datetime('now', '-30 days')
  `).all();
  const retentionStmt = db.prepare(`
    SELECT 1 FROM user_sessions
    WHERE user_id = ?
      AND last_seen_at >= datetime(?, ? || ' days')
      AND last_seen_at <  datetime(?, ? || ' days')
    LIMIT 1
  `);
  function retainedAtDay(userId, signupAt, day) {
    // ±1 day window so weekend lurkers count.
    const lo = String(day - 1);
    const hi = String(day + 1);
    return !!retentionStmt.get(userId, signupAt, lo, signupAt, hi);
  }
  let d1 = 0, d7 = 0, d30 = 0;
  for (const u of retCohort) {
    if (retainedAtDay(u.id, u.created_at, 1)) d1++;
    if (retainedAtDay(u.id, u.created_at, 7)) d7++;
    if (retainedAtDay(u.id, u.created_at, 30)) d30++;
  }
  const retention = retCohort.length > 0 ? {
    cohortSize: retCohort.length,
    d1: Math.round((d1 / retCohort.length) * 1000) / 10,
    d7: Math.round((d7 / retCohort.length) * 1000) / 10,
    d30: Math.round((d30 / retCohort.length) * 1000) / 10,
  } : null;

  // --- 6. booking conversion ---
  // booking_page_views aggregates by day. Confirmed bookings = bookings
  // table where status='confirmed' and created in last 30d.
  const viewsRow = db.prepare(`
    SELECT COALESCE(SUM(views), 0) AS n FROM booking_page_views
    WHERE day >= DATE('now', '-30 days')
  `).get();
  const bookingsRow = db.prepare(`
    SELECT COUNT(*) AS n FROM bookings
    WHERE status = 'confirmed' AND created_at >= datetime('now', '-30 days')
  `).get();
  const views = viewsRow?.n || 0;
  const confirmed = bookingsRow?.n || 0;
  const conversion = views > 0 ? Math.round((confirmed / views) * 1000) / 10 : null;

  return {
    generatedAt: new Date().toISOString(),
    signups: {
      last30: signupsCurrent,
      prior30: signupsPrior,
      delta: signupsPrior > 0
        ? Math.round(((signupsCurrent - signupsPrior) / signupsPrior) * 1000) / 10
        : null,
      byDay: signupsByDay,
    },
    activation: {
      cohortSize: activationCohort.length,
      activated,
      ratePct: activationRate,
      definition: 'returned for a 2nd day within 7 days of signup',
    },
    wau: {
      current: wau,
      previous: wauPrev,
      buckets: wauBuckets.slice().reverse(), // oldest → newest for chart
    },
    plans,
    retention,
    bookings: {
      views,
      confirmed,
      conversionPct: conversion,
      window: 'last 30 days',
    },
  };
}

router.get('/api/admin/metrics', requireAdmin, (req, res) => {
  try {
    res.set('Cache-Control', 'private, max-age=60');
    res.json({ ok: true, metrics: computeMetrics() });
  } catch (err) {
    console.error('[admin-metrics] compute failed:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
