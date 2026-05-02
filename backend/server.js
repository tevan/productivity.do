// Sentry must be imported and initialized before any other module that we
// want to capture errors from — its instrumentation patches global handlers.
import { initSentry, sentryErrorHandler } from './lib/sentry.js';
initSentry();

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import compression from 'compression';
import cookieSession from 'cookie-session';
import authRoutes from './routes/auth.js';
import siteGateRoutes from './routes/site-gate.js';
import accountRoutes from './routes/account.js';
import supportChatRoutes from './routes/support-chat.js';
import calendarRoutes from './routes/calendar.js';
import taskRoutes from './routes/tasks.js';
import taskColumnsRoutes from './routes/task-columns.js';
import integrationsRoutes from './routes/integrations.js';
import iconsRoutes from './routes/icons.js';
import helpRoutes from './routes/help.js';
import mcpRoutes from './routes/mcp.js';
import slackRoutes from './routes/slack.js';
import nativeRoutes from './routes/native.js';
import importRoutes from './routes/import.js';
import aiRoutes from './routes/ai.js';
import preferencesRoutes from './routes/preferences.js';
import calendarSetRoutes from './routes/calendar-sets.js';
import bookingPagesRoutes from './routes/booking-pages.js';
import bookingPublicRoutes from './routes/booking-public.js';
import apiV1Routes from './routes/api-v1.js';
import adminDeveloperRoutes from './routes/admin-developer.js';
import adminMetricsRoutes from './routes/admin-metrics.js';
import billingRoutes, { stripeWebhookHandler } from './routes/billing.js';
import { icsPublic, icsAdmin } from './routes/ics.js';
import notificationsRoutes from './routes/notifications.js';
import focusBlocksRoutes from './routes/focus-blocks.js';
import notesRoutes from './routes/notes.js';
import linksRoutes from './routes/links.js';
import { inboxPublic, inboxAdmin } from './routes/email-inbox.js';
import templatesRoutes from './routes/templates.js';
import subscriptionsRoutes, { startSubscriptionRefresher } from './routes/subscriptions.js';
import hiddenEventsRoutes from './routes/hidden-events.js';
import { quickSlotsAdmin, quickSlotsPublic } from './routes/quick-slots.js';
import operationsRoutes from './routes/operations.js';
import { startOperationsSweeper } from './lib/operations.js';
import trashRoutes from './routes/trash.js';
import { startTrashSweeper } from './lib/trash.js';
import activityRoutes from './routes/activity.js';
import feedbackRoutes from './routes/feedback.js';
import todayRoutes from './routes/today.js';
import weeklyReviewRoutes from './routes/weekly-review.js';
import observationsRoutes from './routes/observations.js';
import { startRevisionsSweeper } from './lib/revisions.js';
import { sweepRotatedKeys } from './lib/apiKeys.js';
import { startLateTaskSweeper } from './lib/lateTaskSweeper.js';
import { startWeeklyDigest } from './lib/digest.js';
import { startRetryLoop } from './lib/webhooks.js';
import { startCalendarSyncRetry } from './lib/calendarSyncRetry.js';
import { startIdempotencySweeper } from './middleware/idempotency.js';
import { startSyncRunner } from './integrations/syncRunner.js';
import { processReminderSweep, fireWorkflows, sendBookingConfirmation } from './lib/notify.js';
import { finalizePaidBookings } from './lib/stripe.js';
import { emitEvent } from './lib/webhooks.js';
import * as google from './lib/google.js';
import { getDb } from './db/init.js';

// ---------------------------------------------------------------------------
// Manual .env loading (no dotenv dependency)
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

try {
  const envPath = join(__dirname, '..', '.env');
  const envContents = readFileSync(envPath, 'utf8');
  for (const line of envContents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  console.warn('Warning: could not read .env file');
}

// ---------------------------------------------------------------------------
// Ensure data directories exist
// ---------------------------------------------------------------------------
for (const dir of ['db']) {
  const full = join(__dirname, dir);
  if (!existsSync(full)) mkdirSync(full, { recursive: true });
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3020;
const isProd = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);

// Stripe webhook MUST be mounted BEFORE express.json() — signature
// verification requires the raw body, not a parsed object.
app.post('/api/stripe/webhook', ...stripeWebhookHandler);

// Slack slash-command endpoint also needs the raw body for HMAC verification.
// The router itself mounts a streaming-body middleware on the affected paths;
// it's safe to register the whole router here.
app.use(slackRoutes);

// gzip compression for API responses + static assets served by Express.
// nginx in front of us also has gzip enabled, but adding it here keeps
// internal/origin requests (and any non-nginx callers) fast. The threshold
// skips tiny responses where compression overhead exceeds the win.
app.use(compression({ threshold: 512 }));

app.use(express.json());

app.use(cookieSession({
  name: 'productivity',
  keys: [process.env.SESSION_SECRET || 'dev-secret-change-me'],
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax',
}));

// ---------------------------------------------------------------------------
// API routes — auth (unprotected)
// ---------------------------------------------------------------------------
app.use(authRoutes);
// Site-gate (private-beta password). Public — must be reachable
// unauthenticated so the login page can render.
app.use(siteGateRoutes);

// ---------------------------------------------------------------------------
// Login page (served before auth middleware for unauthenticated users)
// ---------------------------------------------------------------------------
const loginHtml = readFileSync(join(__dirname, 'views', 'login.html'), 'utf8');

app.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect('/');
  res.type('html').send(loginHtml);
});

// ---------------------------------------------------------------------------
// Marketing pages (public, served from /marketing/)
// ---------------------------------------------------------------------------
const marketingDir = join(__dirname, '..', 'marketing');
const marketingPages = ['home', 'features', 'pricing', 'security', 'about', 'changelog', 'terms', 'privacy', 'signup'];
for (const page of marketingPages) {
  app.get(`/${page}.html`, (req, res) => {
    try {
      res.type('html').send(readFileSync(join(marketingDir, `${page}.html`), 'utf8'));
    } catch {
      res.status(404).send('Page not found');
    }
  });
}
app.use('/marketing/assets', express.static(join(marketingDir, 'assets'), {
  maxAge: '1d',
  immutable: false,
}));

// ---------------------------------------------------------------------------
// Public routes that bypass requireAuth
// ---------------------------------------------------------------------------
app.use(bookingPublicRoutes);

// Public ICS feed — token-scoped, no session.
app.use(icsPublic);

// Brand icons are public — used by the marketplace page and (later) marketing.
app.use(iconsRoutes);

// Knowledgebase /help/* — public, marketing-style pages.
app.use(helpRoutes);

// Avatar uploads served from /avatars/<file> (public — they're already
// behind a hashed filename, no need for auth).
app.use('/avatars', express.static(join(__dirname, '..', 'avatars'), {
  maxAge: '7d',
  immutable: false,
}));

// MCP server — Bearer auth (pk_live_…). Mounted before requireAuth.
app.use(mcpRoutes);

// Public inbound mail webhook (recipient address embeds the credential).
app.use(inboxPublic);
app.use(quickSlotsPublic);

// Public API (v1) — uses Bearer-token auth via requireApi() middleware on each
// route, plus optional session auth, so it must be mounted *before* requireAuth.
app.use(apiV1Routes);

// Developer docs + embed loader
const developersHtml = readFileSync(join(__dirname, 'views', 'developers.html'), 'utf8');
const explorerHtml = readFileSync(join(__dirname, 'views', 'explorer.html'), 'utf8');
const embedJs = readFileSync(join(__dirname, 'views', 'embed.js'), 'utf8');
app.get('/developers', (req, res) => res.type('html').send(developersHtml));
app.get('/developers/explorer', (req, res) => res.type('html').send(explorerHtml));
app.get('/embed.js', (req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(embedJs);
});

// ---------------------------------------------------------------------------
// Auth middleware — everything below requires authentication
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  // Allow auth API routes through (already mounted above)
  if (req.path.startsWith('/api/auth')) return next();
  if (req.path.startsWith('/api/signup')) return next();
  if (req.path.startsWith('/api/verify/')) return next();
  // Stripe webhook is signature-verified by Stripe, so it doesn't need session auth
  if (req.path === '/api/stripe/webhook') return next();
  if (req.path === '/api/email-inbox/inbound') return next();
  // Allow public booking widget assets — the public widget itself runs
  // unauthenticated and needs its JS/CSS bundles, fonts, and favicon.
  // Quick-slots public routes: GET metadata + POST book.
  if (req.path.startsWith('/api/public/quick-slots/')) return next();
  if (req.path.startsWith('/q/')) return next();
  if (
    req.path === '/integrations' ||
    req.path.startsWith('/integrations/') ||
    req.path === '/mcp' ||
    req.path === '/api/slack/command' ||
    req.path === '/api/slack/install' ||
    req.path === '/api/slack/oauth/callback' ||
    req.path.startsWith('/assets/') ||
    req.path.startsWith('/api/icons/') ||
    req.path.startsWith('/ics/u/') ||
    req.path === '/book.html' ||
    req.path === '/favicon.svg' ||
    req.path === '/favicon.ico' ||
    req.path === '/developers' ||
    req.path === '/developers/explorer' ||
    req.path === '/embed.js' ||
    // Service Worker + PWA manifest — must load unauthenticated so the
    // shell can be cached BEFORE the user signs in. The SW itself only
    // makes network requests with the session cookie attached, so this
    // doesn't widen any auth surface.
    req.path === '/sw.js' ||
    req.path === '/manifest.webmanifest' ||
    req.path.startsWith('/workbox-') ||
    req.path === '/registerSW.js' ||
    req.path === '/api/v1/openapi.json' ||
    req.path === '/api/v1/ping' ||
    req.path === '/api/v1/error-codes' ||
    req.path.startsWith('/site-gate/') ||
    // Plan catalog — read-only marketing/SaaS metadata; consumed by
    // /pricing.html so the copy can't drift from server enforcement.
    req.path === '/api/plans' ||
    req.path === '/help' ||
    req.path.startsWith('/help/') ||
    req.path === '/api/account/confirm-email' ||
    req.path.startsWith('/avatars/') ||
    // Marketing pages (kept behind nginx IP allowlist during dev; once we go
    // public, nginx opens up but these still bypass the SPA login).
    req.path === '/home.html' ||
    req.path === '/features.html' ||
    req.path === '/pricing.html' ||
    req.path === '/security.html' ||
    req.path === '/about.html' ||
    req.path === '/changelog.html' ||
    req.path === '/terms.html' ||
    req.path === '/privacy.html' ||
    req.path === '/signup.html'
  ) {
    return next();
  }
  if (req.session && req.session.authenticated) return next();

  // API calls get 401, browser requests get redirected to login
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  return res.redirect('/login');
}
app.use(requireAuth);

// Attach req.user for downstream handlers. Runs AFTER requireAuth, so we
// know the session is authenticated. Bridge: existing sessions only have
// `authenticated=true` (no userId) — treat them as the seed user (id=1).
app.use((req, res, next) => {
  if (req.session && req.session.authenticated) {
    req.user = { id: req.session.userId || 1 };
  }
  next();
});

// ---------------------------------------------------------------------------
// Protected API routes (mount here)
// ---------------------------------------------------------------------------
app.use(accountRoutes);
app.use(supportChatRoutes);
app.use(calendarRoutes);
app.use(taskRoutes);
app.use(taskColumnsRoutes);
app.use(integrationsRoutes);
app.use(nativeRoutes);
app.use(importRoutes);
app.use(aiRoutes);
app.use(preferencesRoutes);
app.use(calendarSetRoutes);
app.use(bookingPagesRoutes);
app.use(adminDeveloperRoutes);
app.use(adminMetricsRoutes);
app.use(billingRoutes);
// /api/ics/* admin endpoints — require session auth.
app.use(icsAdmin);
app.use(notificationsRoutes);
app.use(focusBlocksRoutes);
app.use(operationsRoutes);
app.use(trashRoutes);
app.use(activityRoutes);
app.use(feedbackRoutes);
app.use(todayRoutes);
app.use(weeklyReviewRoutes);
app.use(observationsRoutes);
app.use(notesRoutes);
app.use(linksRoutes);
app.use(inboxAdmin);
app.use(templatesRoutes);
app.use(subscriptionsRoutes);
app.use(hiddenEventsRoutes);
app.use(quickSlotsAdmin);

// ---------------------------------------------------------------------------
// Static files + SPA fallback (production)
// ---------------------------------------------------------------------------
const distPath = join(__dirname, '..', 'dist');

if (isProd || existsSync(distPath)) {
  app.use(express.static(distPath));

  // Routes that should always render the SPA (`index.html`). Anything else
  // 404s with a styled page. We don't redirect unknown paths to `/` —
  // redirects lie about what happened, hurt SEO, and break the back button.
  // The SPA itself has no client-side router today, so the only legitimate
  // SPA path is `/`. All public widget / docs paths (`/book/*`, `/q/:id`,
  // `/developers`, marketing) are served via dedicated handlers earlier in
  // the chain — by the time we get here, an unmatched non-API path is a
  // real 404.
  const FOUR_OH_FOUR = readFileSync(join(__dirname, 'views/404.html'), 'utf8');

  app.get('/{*splat}', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    // Bare `/` and SPA-routed sub-paths serve the SPA. Add new client routes
    // here when we expose them — see lib/stores/routeStore.svelte.js.
    if (
      req.path === '/' ||
      req.path === '/integrations' ||
      req.path.startsWith('/integrations/') ||
      req.path === '/admin/metrics' ||
      req.path === '/admin/integrations'
    ) {
      return res.sendFile(join(distPath, 'index.html'));
    }
    // Everything else here is unmatched (static files would have served
    // already; named routes too). Return a real 404 so monitoring catches
    // broken links and search engines de-index dead URLs.
    res.status(404).type('html').send(FOUR_OH_FOUR);
  });
}

// Sentry error handler — must be AFTER all routes/middleware that throw.
app.use(sentryErrorHandler);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Productivity server listening on 127.0.0.1:${PORT}`);
  // Process any failed webhook deliveries every minute
  startRetryLoop(60_000);
  // Retry GCal create for bookings whose initial sync failed (best-effort
  // create after booking commit). Notifies host on final failure.
  startCalendarSyncRetry({ intervalMs: 60_000 });
  // Sweep stale Idempotency-Key entries from /api/v1 once an hour (24h TTL).
  startIdempotencySweeper();
  // Sweep completed (non-error) operations older than 7 days.
  startOperationsSweeper();
  // Daily sweep of expired soft-deleted rows past their 30-day window.
  startTrashSweeper(getDb);
  // Revision history retention: 90 days, swept daily.
  startRevisionsSweeper();
  // Daily sweep of rotated API keys past the 7-day grace window.
  setInterval(() => { try { sweepRotatedKeys(); } catch {} }, 24 * 60 * 60_000).unref?.();
  try { sweepRotatedKeys(); } catch {}
  // Periodic refresh of inbound ICS subscription feeds.
  startSubscriptionRefresher();
  // Background sync of connected provider integrations.
  startSyncRunner();
  // Weekly digest tick every hour, fires Mondays 8-9am server-local.
  startWeeklyDigest();
  // Auto-move late tasks → today, hourly. Only for users with the pref on.
  startLateTaskSweeper();
  // Sweep for bookings due a 24h reminder every 10 minutes.
  // Run once on startup so a missed window during a deploy gets caught.
  processReminderSweep(getDb, fireWorkflows).catch(() => {});
  setInterval(() => {
    processReminderSweep(getDb, fireWorkflows).catch(() => {});
  }, 10 * 60 * 1000).unref?.();

  // Finalize paid bookings (create GCal event + email) every 30s. Fast
  // because the user is waiting on their confirmation email after Stripe
  // redirects them back from Checkout.
  setInterval(() => {
    finalizePaidBookings(google, sendBookingConfirmation, emitEvent).catch(() => {});
  }, 30 * 1000).unref?.();
});
