# productivity.do (Productivity Calendar)
Status: Active — preparing for public SaaS launch
See: /srv/www/CLAUDE.md for server patterns, workflow preferences, UI rules, and shortcuts

## Overview

Fantastical-inspired web calendar with Google Calendar + Todoist sync. Svelte 5 SPA + Express 5 backend. Currently IP-restricted during dev; multi-tenant SaaS is now wired up (users table, signup/login, Stripe billing, plan gates) and waiting on Stripe Price IDs to launch. Hosts Calendly-style booking pages at `/book/:slug` plus a public developer API at `/api/v1`.

## Marketing site

`/marketing/` directory holds 9 hand-styled HTML pages (`home`, `features`, `pricing`, `security`, `about`, `changelog`, `terms`, `privacy`, `signup`) served by Express. Shared `marketing/assets/{marketing.css,marketing.js}`. Pricing tiers: Free / Pro $12/mo / Team $20/user/mo with annual discount. The home page lives at `/home.html` (not `index.html` — that's the Svelte SPA).

**Stack:** Svelte 5 + Vite (multi-entry SPA), Express 5, better-sqlite3 (WAL, cache + booking data), PM2 (port 3020)
**App directory:** /srv/www/productivity.do/
**Fonts:** Inter (Google Fonts)

## Auth

Three layers, applied in this order: site-gate (private-beta password) → user session (real account auth) → per-resource authorization.

- **Layer 1 — Site-gate (private beta):** see [Site-gate](#site-gate-private-beta) section below. nginx `auth_request` enforces a shared cookie before requests reach the SPA or `/api/*`. Will be removed at public launch.
- **Layer 2 — User session:** `users` table with bcrypt password hashes, cookie-session with `req.session.userId`. Legacy sessions (`authenticated=true` with no userId) bridge to seed user id=1.
  - **Signup:** `POST /api/signup` with email + password + plan. Auto-login on success, best-effort verification email via Resend (`GET /api/verify/:token`).
  - **Login:** `POST /api/auth` with `{email, password}`. Falls back to seed user `SEED_USER_EMAIL` (env, defaults to `owner@productivity.do`) if no email supplied — preserves the legacy single-password login during the transition.
  - **Google OAuth:** Calendar read/write scopes, per-user tokens in `google_tokens` (PK = user_id), auto-refresh.
  - **Todoist:** Per-user PAT in `users.todoist_token`; falls back to `process.env.TODOIST_API_TOKEN` for legacy single-user mode (flagged in `routes/tasks.js`).
- **Layer 3 — Per-resource authorization:** route handlers check `req.user.id` matches the resource owner. API keys (Bearer `pk_live_…`) carry scopes for `/api/v1/*`.

### Public bypass list (Express requireAuth middleware)

These paths skip Layer 2 (user session) — they're either pre-auth flows or genuinely public surfaces. Layer 1 (site-gate) still applies during private beta unless the path is also nginx-bypassed (see Site-gate section).

`/api/auth/*`, `/api/signup`, `/api/verify/*`, `/api/stripe/webhook`, `/assets/*`, `/book.html`, `/book/*`, `/api/public/booking/*`, `/developers`, `/developers/explorer`, `/embed.js`, `/api/v1/openapi.json`, `/api/v1/ping`, `/api/v1/error-codes`, `/site-gate/*`, `/sw.js`, `/manifest.webmanifest`, `/workbox-*`, `/registerSW.js`, `/avatars/*`, `/help`, `/help/*`, `/api/account/confirm-email`, `/home.html`, `/features.html`, `/pricing.html`, `/security.html`, `/about.html`, `/changelog.html`, `/terms.html`, `/privacy.html`, `/signup.html`.

When adding a new pre-auth route, edit BOTH:
1. The Express bypass conditional in `backend/server.js` (the `requireAuth` middleware).
2. The corresponding nginx `location` block in `/etc/nginx/sites-available/productivity.do.conf` if the route should also be reachable without the site-gate cookie.

## Site-gate (private beta)

A shared-password screen gating access to the SPA + `/api/*` during the private-beta phase. Mirrors the resourcingtools.com staging-gate pattern — modeled there, lifted here. **Designed to be deleted at public launch** without disturbing the rest of the system.

**Why it exists:** the prior approach was an nginx IP allowlist (`allow 69.131.127.243; deny all;`). That worked from the owner's home IP but rendered as blank-page 403s for charter users on mobile carriers, coffee shops, etc. The site-gate keeps the charter-user friction (a password) without locking out devices that move between networks.

**Files:**
- `backend/routes/site-gate.js` — `POST /site-gate/check`, `GET /site-gate/verify` (nginx auth_request hook), `POST /site-gate/logout`, `GET /site-gate/login.html`. Mounted before `requireAuth` so it's always reachable.
- `backend/views/site-gate-login.html` — self-contained login page with attempts-remaining display, dark mode, mobile-friendly layout. No SPA dependency, no Vite — served directly.
- `/etc/nginx/sites-available/productivity.do.conf` — the `auth_request /site-gate/_verify` directive on the SPA `location /` block, plus `error_page 401 = @site_gate_login` redirecting to the login page with `?to=$request_uri` so post-login lands on the originally-requested path.

**Cookie shape:** `productivity_site_auth=v1.<exp>.<sig>`. `sig` is `HMAC-SHA256(SITE_AUTH_SECRET, "v1.${exp}")`. Verified with `crypto.timingSafeEqual`. Cookie attributes: `Secure; HttpOnly; SameSite=Lax; Max-Age=30 days`.

**Lockout:** 3 failed attempts within 15 minutes from the same client IP → that IP is blocked from further attempts for 1 hour. State is in-memory (`Map<ip, {count, firstAt, blockedUntil?}>`). PM2 restart resets counters — that's intentional: a server hiccup shouldn't lock anyone out permanently. Single-process today; multi-process would need shared state (Redis or sqlite).

**Bypass IPs:** the `SITE_GATE_BYPASS_IPS` env (comma-separated) skips BOTH the password prompt AND the lockout. Owner's home IP is populated. The bypass reads from `X-Forwarded-For` (leftmost hop), since requests come Cloudflare → nginx → Express.

**nginx-public surfaces (no site-gate, no auth_request):**
- Marketing pages: `/home.html`, `/features.html`, `/pricing.html`, `/about.html`, `/changelog.html`, `/terms.html`, `/privacy.html`, `/security.html`, `/signup.html`
- Booking widgets: `/book/*`, `/q/*`
- Developer surface: `/developers`, `/developers/explorer`, `/api/v1/{ping,openapi.json,error-codes}`
- External webhook + invitee endpoints: `/api/stripe/webhook`, `/api/public/*`, `/api/email-inbox/inbound`, `/ics/u/*`
- Site-gate itself: `/site-gate/*` (login page + check endpoint)
- Favicon

Everything else (the SPA, `/api/*`, `/admin/*`) is gated.

**Environment:**
- `SITE_PASSWORD` — required. The shared password.
- `SITE_AUTH_SECRET` — required. 64 hex chars (`openssl rand -hex 32`). Rotating invalidates all existing cookies.
- `SITE_GATE_BYPASS_IPS` — optional. Comma-separated.

**Implementation notes:**
- `getPassword()` / `getSecret()` / `getBypassIps()` are functions, not module-level constants. server.js parses `.env` AFTER imports, so reading `process.env.*` at module-load captures empty strings. Lazy access fixes that.
- The `/site-gate/verify` route returns 200 if `SITE_PASSWORD` or `SITE_AUTH_SECRET` is unset — fail-open so a misconfigured server doesn't brick the site.
- The login page passes `?to=<original-path>` through and the JS validates it starts with `/` (no `//`) before redirecting, to prevent open-redirect via a crafted login URL.

**Removal at public launch:**
1. Delete `backend/routes/site-gate.js` and `backend/views/site-gate-login.html`.
2. Remove the `siteGateRoutes` import + `app.use(siteGateRoutes)` line + `/site-gate/*` bypass in `backend/server.js`.
3. In `/etc/nginx/sites-available/productivity.do.conf`, delete the `auth_request /site-gate/_verify` line on `location /`, the `error_page 401 = @site_gate_login` block, and the public `/site-gate/`, `/site-gate/_verify` location blocks. The other public locations (marketing, booking, developer) stay — they're correct for public launch too.
4. Delete `SITE_PASSWORD`, `SITE_AUTH_SECRET`, `SITE_GATE_BYPASS_IPS` from `.env`.

## Views

| View | Letter | Number | Description |
|------|--------|--------|-------------|
| Day | D | 1‑4 (slot-order) | Single column |
| Next N Days | X | — | Rolling window, configurable 3‑7 (default 5) |
| Week | W | — | Mon‑Sun or Sun‑Sat |
| Month | M | — | Grid with event bars |

Available views are configurable in Settings → General → Available Views (`enabledViews` pref). Numeric `1‑4` shortcuts map to the user's enabled-view order.

## Keyboard Shortcuts

`T`=today, `N`/`C`=new event (uses hovered hour slot if any), `1‑4`=views in tab order, `D`/`X`/`W`/`M`=specific view, `J`/`K` or arrows=next/prev, `G`=go-to-date, `?`=help, `/`=focus input, `Cmd+K`=toggle event/task, `Cmd+1‑3`=calendar sets, `Esc`=close.

## API Routes

```
Auth (unprotected):
  POST /api/auth, GET /api/auth/status, GET /api/auth/google,
  GET /api/auth/google/callback, GET /api/auth/google/status,
  POST /api/auth/google/disconnect

Calendar (protected):
  GET /api/calendars, GET /api/events, POST /api/events,
  PUT /api/events/:calId/:eventId, DEL /api/events/:calId/:eventId,
  GET /api/events/sync

Tasks (protected):
  GET /api/tasks, POST /api/tasks,
  PUT /api/tasks/:id (supports projectId via Todoist /move + estimatedMinutes/localStatus/localPosition locally),
  POST /api/tasks/:id/complete, POST /api/tasks/:id/reopen,
  POST /api/tasks/:id/auto-schedule,
  DEL /api/tasks/:id, GET /api/tasks/projects,
  GET/POST/DELETE /api/tasks/integration       (per-user Todoist token)
  GET /api/task-columns,                       (kanban columns; auto-seeds defaults)
  POST /api/task-columns,                      (add custom column; capped at 5)
  PUT /api/task-columns/:id,                   (rename)
  PUT /api/task-columns/order,                 (reorder; Done forced rightmost)
  DELETE /api/task-columns/:id,                (only custom; tasks revert to To Do)
  GET /api/tasks/projects,                     (list)
  POST /api/tasks/projects,                    (create)
  PUT /api/tasks/projects/:id,                 (rename / recolor / favorite)
  DELETE /api/tasks/projects/:id,
  GET /api/tasks/sections?projectId=,          (CRUD on Todoist sections)
  POST/PUT/DELETE /api/tasks/sections[/:id],
  GET /api/tasks/labels,                       (CRUD on Todoist labels)
  POST/PUT/DELETE /api/tasks/labels[/:id],
  GET /api/tasks/filters,                      (read-only; Pro feature, [] for free)
  GET /api/tasks/:id/comments,                 (per-task comments)
  POST /api/tasks/:id/comments,
  PUT /api/tasks/comments/:id,
  DELETE /api/tasks/comments/:id,
  POST /api/tasks/quick,                       (Todoist NL parser: "buy milk tomorrow @errands p1")
  GET /api/tasks/reminders,                    (Pro feature)
  PUT /api/tasks/bulk                          (apply patches to up to 100 tasks)

Focus blocks (protected):
  GET /api/focus-blocks, POST /api/focus-blocks,
  PUT/DELETE /api/focus-blocks/:id

Email-to-task (mixed):
  POST /api/email-inbox/inbound                (PUBLIC, provider webhook)
  GET  /api/email-inbox/me                     (auth — returns the user's address)
  POST /api/email-inbox/regenerate             (auth — rotates the token)

AI prep (protected):
  POST /api/events/:calId/:eventId/prep        (Body: {force?:boolean})

Booking pages (protected, owner CRUD):
  GET/POST /api/booking-pages,
  GET/PUT/DELETE /api/booking-pages/:id,
  GET /api/booking-pages/:id/bookings,
  GET /api/booking-pages/:id/bookings.csv    (CSV export)
  GET /api/booking-pages/:id/analytics?days  (views/conversion/no-show/revenue)
  POST/PUT/DELETE /api/booking-pages/:id/event-types[/:typeId],
  PUT /api/booking-pages/:id/questions,
  PUT /api/booking-pages/:id/workflows,
  GET/POST/DELETE /api/booking-pages/:id/invites[/:token],
  GET/PUT/DELETE /api/booking-pages/:id/polls[/:pollId],
  PUT /api/bookings/:id                      (toggle no_show flag)
  GET/POST/PUT/DELETE /api/routing-forms[/:id]

Calendar / events (protected):
  GET /api/events.csv?from&to                (CSV export)
  GET /api/events/search?q                   (LIKE match across summary/description/location)
  POST /api/events/find-time                 (find N free slots across calendars)
  + recurrence on POST/PUT (preset, RRULE, or {freq,interval,count,until,byDay,byMonthDay});
    PUT accepts scope: 'instance' | 'series' | 'following'

Event templates / subscriptions / hide / quick slots (protected):
  CRUD /api/event-templates
  CRUD /api/subscriptions[/:id], POST /api/subscriptions/:id/refresh  (read-only ICS feeds)
  GET/POST /api/hidden-events, DELETE /api/hidden-events/:calId/:eventId
  GET/POST /api/quick-slots, DELETE /api/quick-slots/:id              (one-off appointment links)

Quick-slots public (unprotected):
  GET /q/:id                                 (self-contained HTML widget)
  GET /api/public/quick-slots/:id, POST /api/public/quick-slots/:id/book

ICS feeds + notifications + billing (protected):
  GET  /api/ics/me, POST /api/ics/regenerate
  GET  /api/notifications, POST /api/notifications/read,
       POST /api/notifications/:id/read, DELETE /api/notifications/:id
  GET  /api/billing/me, GET/POST /api/billing/checkout, GET /api/billing/portal
  GET  /api/plans                              (no auth — pricing.html consumes this)

Notes (protected):
  GET /api/notes, GET /api/notes/:id,
  POST /api/notes, PUT /api/notes/:id, DELETE /api/notes/:id (soft-delete; ?permanent=1 to skip)
  GET  /api/notes/:id/revisions               (90d history, 50 versions cap)
  POST /api/notes/:id/revisions/:revId/restore
  GET  /api/notes/:id/comments                (author-only; mirrors task_comments)
  POST /api/notes/:id/comments,
  PUT  /api/notes/:id/comments/:commentId,
  DELETE /api/notes/:id/comments/:commentId   (soft-delete via deleted_at)

Tasks revisions (protected):
  GET  /api/tasks/:id/revisions
  POST /api/tasks/:id/revisions/:revId/restore

Trash + activity + operations (protected):
  GET  /api/trash                              (list soft-deleted across notes/booking_pages/event_templates/calendar_sets)
  POST /api/trash/restore                      ({resource, id})
  POST /api/trash/purge                        ({resource, id})
  POST /api/trash/empty                        (purge all past purge_at)
  GET  /api/activity                           (cross-resource recent revisions for the user)
  GET  /api/operations/:id                     (LRO status; AI prep + future bulk imports)
  GET  /api/operations/:id:wait                (long-poll variant, max 30s)

Account + sessions (protected, except confirm-email):
  GET  /api/account                            (profile + active sessions list)
  PUT  /api/account/profile                    (display_name, timezone)
  POST /api/account/avatar (multipart), DELETE /api/account/avatar
  POST /api/account/change-password            (verifies current pw, revokes other sessions)
  POST /api/account/change-email               (sends confirmation to NEW address)
  GET  /api/account/confirm-email              (no auth — token in query)
  DELETE /api/account/sessions/:id             (revoke one device)
  POST /api/account/sessions/revoke-others
  POST /api/account/delete                     (soft-delete; 30-day recovery; ?mode=immediate skips)
  GET  /api/account/export                     (full data JSON; every user-owned row, secrets redacted)

Admin metrics (admin-only — user_id=1 OR is_team_admin=1):
  GET  /api/admin/metrics                      (signups/activation/WAU/plans/retention/booking-conv)
  GET  /api/admin/integrations                 (full 102-row adapter catalog incl. stubs)
  GET  /api/admin/feedback?limit=N             (recent feedback submissions for triage)

Feedback (protected):
  POST /api/feedback                           ({kind, body, url} → DB + best-effort Resend)

Site-gate (no auth — private-beta password screen):
  GET  /site-gate/login.html
  POST /site-gate/check
  GET  /site-gate/verify                       (nginx auth_request hook)
  POST /site-gate/logout

Booking public (unprotected):
  GET /book/cancel/:token                    (HTML widget)  ← register first
  GET /book/reschedule/:token                (HTML widget)
  GET /book/i/:token                         (HTML widget — single-use invites)
  GET /book/form/:slug                       (HTML widget — routing forms)
  GET /book/:slug[/:typeSlug]                (HTML widget)
  GET /api/public/booking/:slug              (page metadata; bumps page-view counter)
  GET /api/public/booking/:slug/slots?date   (available slots)
  GET /api/public/booking/:slug/next-slot    (first available slot in next 14d)
  POST /api/public/booking/:slug             (create booking — atomic tx)
  POST /api/public/booking/:slug/poll        (Doodle-style time poll)
  POST /api/public/booking/cancel/:token     (cancel)
  GET  /api/public/booking/by-cancel-token/:token[/ics]
  GET  /api/public/forms/:slug               (routing form metadata)
  GET  /api/public/invite/:token             (validate single-use invite)
  GET  /ics/u/:token                         (token-scoped read-only ICS feed)

Public developer API (Bearer pk_live_<prefix>.<secret>, scoped):
  GET  /api/v1/ping                          (no auth)
  GET  /api/v1/openapi.json                  (no auth — full OpenAPI 3.1 spec)
  GET  /api/v1/error-codes                   (no auth — stable error-code catalog)
  GET  /api/v1/me                            (key info)
  CRUD /api/v1/tasks, /api/v1/events, /api/v1/calendars,
       /api/v1/booking-pages[/:id/bookings], /api/v1/webhooks
  POST /api/v1/events/bulk, /api/v1/tasks/bulk  (max 100/req, per-item results)

Admin developer (SPA-only, session auth):
  CRUD /api/api-keys, /api/webhooks[/:id/{rotate-secret,deliveries}]

Other (protected):
  GET /api/weather, GET /api/travel-time,
  GET/PUT /api/preferences, CRUD /api/calendar-sets
```

## Commands

```bash
pm2 restart productivity
pm2 logs productivity
cd /srv/www/productivity.do && npm run build
cd /srv/www/productivity.do && npm run dev
```

## Vite multi-entry build

Two HTML entries: `index.html` (main SPA) and `book.html` (public booking widget). Configured in `vite.config.js` via `build.rollupOptions.input`. Each entry produces its own JS+CSS bundle (`assets/main-*.{js,css}` and `assets/book-*.{js,css}`) plus a shared `assets/app-*.{js,css}` chunk.

## Key Implementation Details

- **Svelte 5 runes** ($state, $derived, $effect) — NOT Svelte 4 stores
- **Theme reactivity:** isDark must be derived from `prefs.values.theme` + reactive matchMedia listener, NOT from `document.documentElement.classList`
- **Todoist API v1:** `https://api.todoist.com/api/v1` — returns `{ results: [...] }` not flat arrays. Project change requires separate `POST /tasks/:id/move` call (see `backend/lib/todoist.js#moveTask`).
- **AudioContext:** Created on user gesture (Enable Notifications click), reused in setTimeout for autoplay compliance
- **TimezoneBar:** Supports half-hour offsets (Kolkata, Kathmandu) via minute-level Intl computation
- **Calendar visibility:** localStorage by default, optional server sync (syncCalendarVisibility pref, default true)
- **Sidebar sections:** Collapsible (localStorage key: productivity_sidebar_collapsed). Each section can be hidden via Settings → Sidebar (`sidebarSections` pref). Calendars individually hideable from list (`hiddenCalendarIds` pref).
- **Sidebar task grouping:** `prefs.taskGroupBy` ∈ `'date' | 'project' | 'label' | 'priority'`. Logic lives in `src/lib/utils/taskGrouping.js`.
- **View/date persistence:** `view.svelte.js` saves `currentView`, `currentDate`, and time-grid scroll position to localStorage; restored on reload.
- **Booking availability:** computed in `backend/lib/booking.js#computeSlots`. Inputs: per-weekday windows + per-date overrides (in host tz), busy intervals from Google (multiple `check_calendar_ids`, with `transparency==='transparent'` excluded), existing confirmed bookings, plus `min_notice_min` / `max_advance_days` / `daily_max` / `slot_step_min` / `buffer_before_min` / `buffer_after_min`. Times stored as UTC ISO; conversion uses `Intl.DateTimeFormat` for tz wall→UTC mapping.
- **Booking event creation:** Atomic SQLite transaction wraps slot recheck + invite-redeem (`UPDATE … WHERE used_by_booking_id IS NULL`, check `changes===0`) + INSERT. Google Calendar create runs *after* the booking is reserved (best-effort) and patches `google_event_id` on success. Cancel deletes the Google event if present.
- **Booking widget tz:** Invitee picks their own timezone via dropdown; slot labels render in invitee tz, but slots are stored in UTC and computed against host tz windows.
- **DST safety in `tzWallToUtc`:** Probes offsets at `naive ± 12h`; for fall-back ambiguity prefers earlier UTC; for spring-forward gap returns the gap-start instant.
- **Booking rate-limiting:** Public booking POST is in-memory per-IP. `/api/v1/*` per-key (or per-IP) is **persisted in SQLite** (`api_v1_rate_buckets`), 120 req/min, survives PM2 restarts. Returns `X-RateLimit-{Limit,Window,Remaining}` + `Retry-After` on 429.
- **Public asset access:** `requireAuth` middleware allow-lists `/assets/*`, `/book.html`, `/favicon.{svg,ico}`, `/developers`, `/embed.js`, `/api/v1/openapi.json`, `/api/v1/ping` so the unauthenticated widget + docs + ping can load.
- **Calendly extras (per-page sub-resources):** Event types (multi-meeting), custom questions (text/textarea/select/checkbox, optionally per-type), workflows (webhook on_booked / on_canceled / on_rescheduled / reminder_24h with `{{name}}` template vars + 8s timeout + SSRF guard), single-use invite tokens, time polls (Doodle-style), routing forms (rules evaluated server-side via POST /api/public/forms/:slug/route — never returned to clients), branding (logo/cover/brand_color), pacing (min_gap_min/weekly_max), Stripe price stub, ICS download + Google/Outlook add-to-calendar.
- **Public developer API (`/api/v1`):** Bearer `pk_live_<prefix>.<secret>` (sha256-hashed, `crypto.timingSafeEqual` compare). Scopes: read/write × tasks/events/booking-pages, read calendars/webhooks, write webhooks, plus admin wildcard. CORS `origin: '*'` (non-reflected). Session-cookie fallback only honored for same-origin requests. OpenAPI 3.1 spec auto-generated at `/api/v1/openapi.json`.
- **API error-code catalog:** `backend/lib/errorCodes.js` is the single source for stable error codes (`auth_*`, `plan_*`, `validation_*`, `not_found_*`, `conflict_*`, `rate_*`, `bulk_*`, `payload_*`, `upstream_*`, `server_*`). Every `/api/v1` error response should be `{ ok:false, code, message, ... }` — use `sendError(res, code, extras)` (or `sendUpstreamError`). `GET /api/v1/error-codes` exposes the catalog (5min cache); `docs/help/api/error-codes.md` documents the contract. Don't repurpose existing codes — add new ones.
- **API Explorer at `/developers/explorer`:** Self-contained HTML at `backend/views/explorer.html`. Loads `/api/v1/openapi.json`, lets the user paste an API key + pick an op + tweak JSON body + send live requests. Auto-generates an `Idempotency-Key` for write methods. Uses DOM methods (no innerHTML) — security hook will reject anything else.
- **Outbound webhooks:** HMAC-SHA256 over `${ts}.${body}`, sent via `X-Productivity-Signature: t=<ts>,v1=<sig>` (replay-safe — receivers should reject >5min stale). 8s timeout, retry queue 1m/5m/30m/2h/12h. URLs validated by `isSafeWebhookUrl` (https + non-loopback/RFC1918/CGNAT/IPv6-internal) at persist time and at delivery time.
- **Confirm modal:** `confirmAction()` from `src/lib/utils/confirmModal.svelte.js` returns `Promise<boolean>` and renders via `<ConfirmRoot>` mounted in `App.svelte`. Replaces `window.confirm()` throughout per CLAUDE.md UI rules.
- **Upgrade modal:** `showUpgrade({feature, requiredPlan, detail})` from `src/lib/utils/upgradeModal.svelte.js`. The `api()` wrapper in `src/lib/api.js` auto-triggers it whenever the backend returns `{code:'plan_required', requiredPlan, feature}`. Backend helpers (`requireFeature` and `checkCountLimit` in `backend/lib/plans.js`) emit that shape on 402.
- **Auto-scheduling tasks:** `backend/lib/autoSchedule.js` finds the next free slot inside `prefs.workHours` honoring busy events from all visible calendars + buffer. POST `/api/tasks/:id/auto-schedule` creates a Google Calendar event AND patches Todoist `due_datetime` so the task lands on the calendar at the right moment without re-sync. Per-task duration estimate stored locally on `tasks_cache.estimated_minutes` (Todoist has no field for it).
- **Team booking pages:** `assignment_strategy` ∈ `single|round_robin|collective` plus `host_user_ids` JSON array. Slot computation: collective → union of all hosts' busy intervals; round-robin → intersection (slot is bookable if any host is free). `pickRoundRobinHost` is load-balanced (fewest upcoming confirmed bookings). For round-robin the GCal event lands on the *assigned* host's primary calendar via `assigned_user_id` on bookings. Team-plan gated; route returns `code:'plan_required'`.
- **Recurring events:** `expandRecurrence()` in `backend/routes/calendar.js` translates `'daily'|'weekdays'|'weekly'|'biweekly'|'monthly'|'yearly'` presets, raw `RRULE:` strings, or `{freq,interval,count,until,byDay,byMonthDay}` objects into Google's `recurrence[]`. PUT accepts `scope`: `instance` (default), `series` (resolves `recurringEventId`, patches parent), or `following` (terminates parent series with `UNTIL=instance-1s` then creates a fresh series from the instance forward).
- **ICS subscription feeds:** `routes/ics.js` exports two routers — `icsPublic` (mounted before `requireAuth` for `/ics/u/:token`) and `icsAdmin` (mounted after for `/api/ics/{me,regenerate}`). Token is 16-byte hex on `users.ics_feed_token`; lookup uses indexed match plus `crypto.timingSafeEqual`. Feed window is -30d/+90d, all visible calendars, 60s `Cache-Control`, `webcal://` URL returned to the SPA.
- **Booking analytics:** `booking_page_views(page_id, day, views)` upserted on every public page-fetch. `bookings.no_show` flag toggled by owner via `PUT /api/bookings/:id`. `/analytics?days=30` returns views/bookings counts, conversion (confirmed/views), no-show rate (no-show/past confirmed), and per-currency revenue grouped from paid bookings.
- **In-app notifications:** `notifications` table (user-scoped, with `kind`, `title`, `body`, `data_json`, `read_at`). `emitEvent()` in `lib/webhooks.js` calls `renderNotification(eventName, data)` to derive a title/body for booking.created|canceled|rescheduled and inserts a row before delivering webhooks. Frontend `NotificationBell.svelte` polls every 60s, marks all as read on dropdown open.
- **Per-user Todoist:** `users.todoist_token` column. `lib/todoist.js#getToken(userId)` looks up the per-user token first, falls back to `process.env.TODOIST_API_TOKEN`. All wrapper functions take an optional `userId` (back-compat: callers without userId still work via env). `validateToken()` does a probe GET against `/projects` before the token is saved.
- **Sub-tasks:** `tasks_cache.parent_id` mirrored from Todoist on every list. `withSubtaskOrder()` in `src/lib/utils/taskGrouping.js` returns `[{task, indent}]` interleaving children directly after parents. `TaskRow.svelte` accepts `indent` prop for left-padding.
- **Bundle splitting:** `App.svelte` lazy-loads `TasksView`, `NotesView`, `Settings`, `GotoDate`, `ShortcutsHelp`, and `BookingPageEditor` via dynamic `import()` gated on `$state` refs (e.g. `let TasksView = $state(null); function loadTasksView() { import('...').then(m => TasksView = m.default); }`). `$effect` blocks fire the loaders the moment the user navigates to the view / opens the modal. Each chunk is its own asset (e.g. `Settings-BdMJ-_IQ.js` 84 KB) so the main bundle dropped from 341 KB → 197 KB. **When adding new heavy modals/views, follow this same pattern** rather than a static import.
- **Compression:** `compression` middleware mounted in `server.js` with `threshold: 512`. `/api/tasks` response went from 109 KB → 13.5 KB on the wire. nginx in front also has gzip enabled, but the Express layer ensures non-nginx callers (origin probes, MCP tools, internal scripts) also get compressed responses.
- **Task list refactor:** Sidebar's task rendering and the holistic Tasks view's list mode both use `<TaskListPanel>` (`src/lib/components/TaskListPanel.svelte`). Group-by tabs, multi-select, bulk actions (complete / today / tomorrow / no-date / delete), and grouped+sub-grouped rendering live in one place. Sidebar passes `compact draggable`; Tasks view passes `compact={false}`. **Don't reimplement task list UI** — extend the panel.
- **Tasks board (kanban):** `tasks_cache.local_status` ∈ `'todo'|'in_progress'|'custom_<n>'|NULL` and `tasks_cache.local_position` (manual sort within column) are productivity.do-only — Todoist never sees them. Done is NOT a writable status; "Done" column = Todoist `is_completed=true` (the canonical action is `POST /api/tasks/:id/complete`). Per-user `task_columns` table holds up to 5 columns with stable `status_key` separate from user-renamable `name`. Default columns (To Do / In Progress / Done) are seeded on first GET. Backend route file: `backend/routes/task-columns.js`. Frontend store: `src/lib/stores/taskColumns.svelte.js`. UI: `src/lib/views/TasksView.svelte` (drag-to-move, per-column sort modes manual/due/priority/created, inline-rename column header, `+` add-column button) + `src/lib/components/BoardColumnsEditor.svelte` (Settings → Tasks; supports drag-to-reorder via `PUT /api/task-columns/order`). Done is forced rightmost server-side. `task.moved` webhook event fires on `localStatus` changes with `{id, fromStatus, toStatus}`. Public API exposes the new fields on `/api/v1/tasks` and a read-only `/api/v1/task-columns`. Full design rationale: `docs/internal/tasks-board.md`.
- **View persistence (general):** Any user-selectable view in the app (top-level Calendar/Tasks/Notes via `appView`, Tasks list/board via `tasksView`, Calendar Day/Week/Month via `calendarView`, …) persists per form-factor on the server. Pref keys follow `${viewName}_${formFactor}` where formFactor ∈ `desktop|mobile` (breakpoint 768px). Helper: `src/lib/utils/viewPersistence.js` (`readLocalView`, `reconcileFromPrefs`, `writeView`, `getFormFactor`). localStorage mirrors give first-paint hydration; the server pref is authoritative and reconciled after `fetchPrefs()` (see `reconcileAppViewFromPrefs` in `appView.svelte.js`, `reconcileViewFromPrefs` in `view.svelte.js`). Don't fall back to localStorage-only when adding a new view toggle.
- **CSV export:** `/api/booking-pages/:id/bookings.csv` and `/api/events.csv?from&to`. Local `csvEscape` helper handles quotes/newlines.
- **Bulk public API:** `/api/v1/{events,tasks}/bulk` accepts `{items: [...]}` (max 100), iterates serially per-user, returns `{ok:true, results:[{index, ok, ...resource|error}]}` so partial failures don't block the rest.
- **Mobile booking widget:** `<640px` breakpoint in `BookingWidget.svelte` and `CancelWidget.svelte` — single-column slot grid, 44px tap targets, edge-to-edge layout.
- **Focus blocks:** `focus_blocks(user_id, label, weekday 0-6, start_time HH:MM, end_time HH:MM)`. `expandFocusBlocks(blocks, tz, numDays)` in `lib/autoSchedule.js` materializes them into UTC intervals; `findNextFreeSlot` accepts `extraBusy[]` to merge them in. Frontend `getFocusBlocks()` store fetched at boot, `focusBlocksForDate(date)` filters by weekday, rendered as a striped band with `top:(min/60)*48px; height:(min/60)*48px;` (matches the 48px hour-row).
- **Email-to-task:** Address shape is `u<userId>+<token>@${INBOX_DOMAIN}` (env, default `inbox.productivity.do`). `users.inbox_token` is 12-byte hex; lookup compares with `crypto.timingSafeEqual`. Provider-agnostic inbound handler accepts `{to: string|string[], from?, subject?, text?, html?}`. Token is the credential — anyone who can forge mail to it can create tasks. The mail receiver itself (SES/Postmark/CF Email Routing) isn't wired yet; UI shows a "receiver not configured" banner until `INBOX_DOMAIN` is set.
- **Event store cache (stale-while-revalidate):** `events.svelte.js` keeps a `Map` cached by `${start}|${end}` ISO key. Cached entries paint instantly on navigation; background refetch reconciles. TTL 5 min, max 24 entries (LRU). `invalidateRangesOverlapping(start,end)` runs after every create/update/delete on *both* old and new windows. In-flight requests deduped via `inFlight` map.
- **Subscribed (inbound) ICS calendars:** `subscribed_calendars` + `subscribed_events`. Tiny RFC-5545 parser in `routes/subscriptions.js#parseIcs` (no RRULE expansion — first instance only). 6h cron via `startSubscriptionRefresher()` from server.js. Subscribed events are merged into `/api/events` with `calendarId` prefixed `sub-` and `readOnly:true`. SSRF-guarded URL validation rejects RFC1918/loopback/CGNAT.
- **Event templates:** `event_templates` table; CRUD `/api/event-templates`. EventEditor shows a picker that prefills summary/description/location/duration when no event is loaded. Right-click → "Save as template" creates one from the clicked event.
- **Quick slots (one-off appointment links):** `quick_slots` table. Backend has admin (`/api/quick-slots`) + public (`/api/public/quick-slots/*`) routers. Widget at `/q/:id` is server-rendered self-contained HTML using DOM methods (NOT innerHTML — security hook blocks). Atomic single-booking transaction: `UPDATE … WHERE booked_at IS NULL`.
- **Hidden events:** `hidden_events(user_id, calendar_id, event_id)`. Right-click → "Hide event" inserts; `/api/events` filters by user_id. Use `events:invalidate` window CustomEvent to trigger refresh after hide (currently no listener wired).
- **Combine duplicate events:** events with same `summary.toLowerCase()+start` across multiple cals collapse into one with `mergedFromCalendarIds[]`. Popover shows a small "On N calendars" badge.
- **Working location / OOO:** `/api/events` returns `eventType` from Google. AllDayRow applies `class:ooo` (red diagonal stripes) and `class:working-location` (green) overrides on top of the base chip styling.
- **Cmd+F event search:** `SearchOverlay.svelte` debounced search against `/api/events/search` (LIKE match on summary/description/location, capped at 50). Click result jumps to date.
- **Tab badge:** `App.svelte` `$effect` sets `document.title = (N) Productivity` where N is timed events remaining today + tasks due today.
- **Recurring task indicator:** TaskRow shows a small loop icon next to tasks where `task.isRecurring` is true. Backend exposes `dueString` and `isRecurring` from Todoist's `due` object.
- **Weekly digest:** `lib/digest.js`, hourly cron, fires Mondays 8-9am server-local. Sends via Resend with this week's events + open tasks. Dedupes on `users.last_digest_at` >6 days old. Skipped if `RESEND_API_KEY` unset.
- **Per-event timezone display:** EventPopover shows the event start time in up to 2 alternate timezones from `prefs.additionalTimezones` (collapsed to a small icon row).
- **Attendee response display:** Popover renders accepted/declined/tentative/needsAction counts as colored chips. Backend now includes `attendees[]` (with `responseStatus`, `organizer`, `self`) and `attachments[]` on every event.
- **AI meeting prep:** `lib/prep.js` calls Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) via direct `fetch` to keep deps minimal. ~350 token cap, 15s timeout. Cached per event by `inputHash` (sha256 over title/desc/start/location/attendees → first 16 hex). Cache lives in `events_cache.prep_summary/prep_generated_at/prep_input_hash`. Click "Prep with AI" in EventPopover; "Regenerate" sends `{force:true}`. Returns 503 if `ANTHROPIC_API_KEY` is unset.
- **Tokens:** All cancel/reschedule/invite/uuid generation uses `crypto.randomUUID`/`randomBytes` — no `Math.random`.
- **SQLite migrations:** `applyMigrations()` in `backend/db/init.js` calls `ensureColumn(db, table, col, def)` which validates identifiers via `^[A-Za-z_][A-Za-z0-9_]*$` and double-quotes them.
- **ICS line folding:** Counts UTF-8 octets via `TextEncoder` and slices on whole-codepoint boundaries (RFC 5545 §3.1 compliance for emoji/CJK).
- **Drag-to-move events:** `createEventDragHandler` in `src/lib/utils/drag.js`. Move = vertical (retime) + horizontal (day-shift via `getDayAtX` mapper from TimeGrid). Resize = drag bottom edge. 15-min snap; Shift disables snap.
- **All-day events drag horizontally** in `AllDayRow.svelte` to shift days while preserving span.
- **All-day date parsing:** Google uses YYYY-MM-DD with EXCLUSIVE end (`end.date=2026-05-01` for an Apr 30 single-day event). `new Date("2026-04-30")` parses as UTC midnight, which in tz west of UTC shifts the event to the prior day. Use `parseAllDayDate()` from `src/lib/utils/dates.js` to parse as LOCAL midnight. Editor form shows INCLUSIVE end-date; backend POST/PUT bumps +1 day for Google; renderer's `getSpanForEvent` subtracts -1 from `event.end` for inclusive span.
- **Show weekends toggle:** `prefs.showWeekends` (default true). When false, `WeekView` filters out Sat/Sun from the rendered dates array — TimeGrid auto-adapts. MonthView is unaffected (always 7 cols).
- **Today button placement:** Lives at the *right* of the date-range label (toolbar-nav) with accent border + accent text — chosen for prominence over the prev/next chevrons (which are smaller and less primary).
- **Overdue indicator on tasks:** Red circle-with-exclamation icon prefixes the title in `TaskRow.svelte`; the title text stays its normal color so the indicator stands out without making the row visually scream. `TaskEditor.svelte` shows a small "Overdue" pill next to the modal heading via the same `isOverdue` derivation.
- **Booking page brand color presets:** 8 preset swatches (`#3b82f6`, `#6366f1`, `#8b5cf6`, `#ec4899`, `#ef4444`, `#f59e0b`, `#10b981`, `#0ea5e9`) plus the existing `<input type="color">` for fine-tuning. Active preset gets a 2-ring outline (border + shadow halo) so the current color reads at a glance.
- **Task due-date parsing (TZ safety):** All `dueDate` strings (`YYYY-MM-DD`) are parsed via `parseTaskDue(task)` in `src/lib/utils/dates.js`, which uses local-midnight semantics. NEVER `new Date(t.dueDate)` directly — UTC midnight reads as the prior day in tz west of UTC, making "due today" tasks appear overdue right after local midnight. Audited and fixed in: `TaskRow`, `TaskEditor`, `AllDayRow`, `App.svelte` tab badge, `tasks.svelte.js#tasksByDate/overdueTasks`, `taskGrouping.js#groupByDate/byUrgencyThenDate`.
- **Sidebar show/hide:** Toolbar has a sidebar-toggle button at the start of the nav row. State persists in `localStorage.productivity_sidebar_hidden`. App.svelte conditionally renders `<Sidebar />` based on `sidebarHidden`.
- **MiniCalendar arrows hidden by default:** Prev/next month chevrons in the sidebar mini-cal fade in only on header hover (or focus-visible). Avoids visual collision with the toolbar's prev/next which are stacked top-left.
- **Drag tasks horizontally on calendar:** `AllDayRow.svelte#handleTaskMouseDown` lets the user drag a dated task left/right between day columns. Same column-width math as event drags. Updates `dueDate` (or preserves time-of-day for `dueDatetime` tasks).
- **Drag sidebar tasks to calendar day:** TaskRow now takes a `draggable` prop; Sidebar passes it. `AllDayRow` renders invisible per-column `.drop-zone` elements that highlight on `dragover` and call `updateTask` on `drop`. AllDayRow renders whenever `tasks.length > 0` (not only when there's a dated task) so empty days still accept drops.
- **Project dropdown swatches + dedupe:** Todoist returns project colors as named tokens (`charcoal`, `blue`, etc.) which browsers don't recognize as CSS colors — `todoistColor()` in `dates.js` maps all 19 names → hex. Fallback dot is `var(--text-tertiary)` so every option has a swatch. The synthetic null-Inbox is suppressed when Todoist already returns its real Inbox project.
- **RSVP states on event chips:** Declined events are filtered from `visibleEvents` by default (toggle via `prefs.showDeclinedEvents` to keep them visible with strikethrough). Tentative ("Maybe") events render with diagonal stripes + dashed left border + 0.85 opacity. Both `EventChip` (all-day row) and `TimeGrid` event blocks honor `attendees.find(a => a.self)?.responseStatus`.
- **Per-cluster event layout:** TimeGrid's `layoutEvents()` groups events into overlap clusters and computes column count per cluster, NOT per day. Earlier `totalCols = columns.length` made every event in a day share width even when they didn't overlap each other.
- **Scheme-aware overdue red:** Each color scheme defines `error` in its light AND dark blocks; `applyColorScheme` writes `--error` so overdue indicators (icon, banner, due-input border) tint to match the scheme. Monochrome's red is heavily desaturated (#A05A55 / #C68A87) but still recognizably red.
- **Removed event-popover nudge buttons:** The −30m/+30m/−1d/+1d row was removed; drag-to-move handles this faster. Cleaned up `liveStart`/`liveEnd` state and the `nudge()` function.
- **EventPopover nudge buttons** (`-30m / +30m / -1d / +1d`) for trackpad-friendly moves without dragging.
- **Double-click event** opens the full EventEditor modal (was: inline title edit, removed). Single-click → popover.
- **Click task in calendar** opens TaskEditor via `app.editTask` Svelte context exposed by App.svelte. Used by AllDayRow's task chips.
- **Right-click context menu** on events: Edit, Duplicate, Move to calendar (re-create + delete), Change color, Save as template, Hide event, Delete.
- **Travel-time blocks:** `lib/stores/travel.svelte.js` walks consecutive same-day events with `location` set, fetches durations via `/api/travel-time` (which silently returns null without `GOOGLE_MAPS_API_KEY`), renders striped pre-event blocks in TimeGrid. `prefs.showTravelBlocks` toggles. Without API key the band still renders with `~` placeholder.
- **Find a time (multi-cal):** `findFreeSlots()` in `lib/autoSchedule.js` + `POST /api/events/find-time`. `FindTimeModal.svelte` lets user pick duration/days/calendars; click slot → opens EventEditor with start/end pre-filled. Bound to **F** key.
- **Custom Dropdown component:** `Dropdown.svelte` replaces every native `<select>` (32 across the app). Keyboard nav (Enter/Space to open, Arrow keys, Esc, Enter to select), click-outside-to-close, hover states, color swatches, custom panel matching surface/border/shadow tokens. Per CLAUDE.md UI rules — no native selects in app or in the public booking widget. Apply via `<Dropdown bind:value options={[{value, label, color?, disabled?}]} />`.
- **Color schemes:** `lib/utils/colorSchemes.js` defines 5 schemes (Classic, Vibrant Tones, Pastel, Forest, Monochrome). `prefs.colorScheme` is orthogonal to `prefs.theme` — light/dark controls bg, scheme controls accent + a `paletteOverride` that maps to all 12 `--color-*` event-chip vars. Each `PASTEL_COLORS` entry has a `varName` field; chips render via `style="background: var(--color-rose, fallback)"` so scheme overrides repaint without re-running `getEventColor()`. `applyColorScheme(id, isDark)` writes CSS vars to `<html>` with `!important` (beats App.svelte's `:global(html.dark)` rules). Settings → Appearance shows visual swatch-card picker only (no dropdown — redundant with the cards). Custom accent-color input only appears for the Classic scheme.
- **Chip text contrast:** Text color uses `readableText()` (white on dark bg, near-black on light bg via WCAG luminance) computed against the resolved bg, NOT against `bgFallback`. `resolveCssVar()` reads the live `var(--color-X)` from `<html>` so saturated scheme overrides (Vibrant Tones red, Forest green) get readable foreground text. The chip's `$derived` text-color depends on `prefs.values.colorScheme` so it recomputes on scheme switch.
- **Persistent event cache:** `events.svelte.js` writes the in-memory `rangeCache` Map to `localStorage.productivity_events_cache` on every successful fetch. On module load, hydrates the Map AND pre-populates the `events` $state with the union of all cached entries — so first paint after refresh shows last-known data instantly. 24h disk TTL; in-memory 5min TTL drives revalidation.
- **Multi-select tasks** in sidebar: shift-click ranges, cmd/ctrl-click toggles. Bulk action bar: Complete / Today / Tomorrow / No date / Delete.

## Integrations / sources abstraction

Calendar and tasks are no longer hardcoded to Google + Todoist. Every event/task carries a `provider` column. `provider = 'native'` means the user created it in productivity.do (no third-party). Other providers register adapters.

- **Adapter directory:** `backend/integrations/<provider>/adapter.js`. Each implements `{ provider, name, kind, authType, syncTasks, syncEvents, createTask/updateTask/deleteTask, createEvent/updateEvent/deleteEvent, disconnect }`. Providers that aren't fully wired use `_stub.js`'s `makeStub()` and surface 501-shaped errors.
- **Registry:** `backend/integrations/registry.js` — list every adapter, ordered for the Settings UI.
- **Persistence:** `integrations` table (`user_id`, `provider`, `status`, `access_token`, `refresh_token`, `expires_at`, `account_email`, `metadata_json`, `last_synced_at`, `last_error`). One row per user-provider pair. `metadata_json` carries provider-specific config (Notion db id, Trello board ids, Linear team ids, CalDAV server URL).
- **Native storage:** `events_native`, `tasks_native`, `projects_native` — primary stores when no integration is connected. Survive disconnect.
- **Read merge:** `/api/events` returns Google live + native + non-Google cached. `/api/tasks` returns Todoist live + native + non-Todoist cached. Native + non-Google rows are appended (no dedup across providers).
- **Routes:** `/api/integrations` (list/connect/disconnect/sync), `/api/native/{events,tasks,projects}` (CRUD on native rows). PAT/OAuth/CalDAV auth flows handled per adapter.
- **Provider front-end routing:** `events.svelte.js` and `tasks.svelte.js` inspect `provider` on each record and route mutations to `/api/native/...` (when native) or `/api/...` (everything else). Default for `createTask`/`createEvent` is **native** unless caller passes a provider.
- **Connected providers (real impl):** Google Calendar, Google Tasks, Todoist, Notion, Linear, Trello, Microsoft 365 Calendar, Microsoft To Do, CalDAV (read-only for now).
- **Stub providers** (surfaced as "Coming soon" in the marketplace): Asana, ClickUp, Jira, Evernote, Monday.com, plus Slack/Discord/Teams (comms), Zoom/Meet (meetings), Drive/Dropbox/OneDrive/Box (storage), Docs/Sheets/Slides/Office365 (docs), Gmail (email), Toggl/Harvest/Clockify (time), Typeform/Google Forms/Jotform (forms), Miro/Lucidchart (whiteboards), Figma/Canva (design), HubSpot/Salesforce (crm), Twilio (sms), and Zapier/Make/n8n/IFTTT/Pipedream/Workato/Activepieces (automation). 39 stubs total.
- **Background sync:** `backend/integrations/syncRunner.js`. Runs every 5min, picks connected rows whose `last_synced_at` is older than 15min, calls `adapter.syncTasks(userId)` and/or `adapter.syncEvents(userId)` with a 60s per-call timeout. Updates `last_synced_at` and `last_error`. Manual "Sync now" reuses the same dispatch.
- **Token encryption-at-rest:** `backend/lib/cryptoBox.js`. AES-256-GCM via `ENCRYPTION_KEY` env (64 hex chars / 32 bytes). `store.js` transparently encrypts `access_token`/`refresh_token` on write, decrypts on read. Lazy migration: plaintext rows stay readable until the next write re-encrypts them. Without `ENCRYPTION_KEY`, fields are stored plaintext (same behaviour as before).
- **Marketplace UI:** category-grouped directory (16 categories) with search + status filter (All / Available / Connected / Coming soon). Adapter list exposes `category`, `status`, `recommended` from each adapter; Coming-soon cards render with a muted style and a "Learn more" link only.
- **Adapter shape extras:** every adapter now declares `category` (one of the 16 in `_categories.js`), `status` ∈ `stable|beta|coming_soon|deprecated`, `recommended: bool`. Stub adapters use `makeStub()` which auto-fills these for "coming soon" providers.

Full architecture rationale: `docs/internal/integrations.md`. Developer-platform integration scaffolds (Zapier/Make/n8n/IFTTT/Pipedream/Workato/Activepieces) live in `docs/integrations/`.

## MCP server + Slack app

- **MCP server** at `POST/GET /mcp`. Streamable HTTP transport via `@modelcontextprotocol/sdk`. Bearer `pk_live_…` auth (same scheme as `/api/v1`). Tools: `create_task`, `complete_task`, `list_tasks`, `create_event`, `list_events`, `list_booking_pages`. Resources: `productivity://tasks`, `productivity://today`. Server impl in `backend/mcp/server.js`; route in `backend/routes/mcp.js`. Sessions are in-memory, keyed by `mcp-session-id` header. Per-session McpServer instance is bound to one user. Mounted before `requireAuth` (Bearer-only).
- **Slack app** at `POST /api/slack/command` (HMAC-signed slash command), `GET /api/slack/install` (OAuth install start), `GET /api/slack/oauth/callback`, `GET /slack/link?token=…` (session-auth user-linking). Tables: `slack_workspaces` (per-team bot tokens), `slack_user_links` (slack_user_id ↔ user_id mapping), `slack_link_tokens` (10-min single-use). Slash command: `/productivity new task: <title>` with optional trailing `today`/`tomorrow`/`YYYY-MM-DD` date hint. `/productivity link` and `/productivity help` also supported. Body parsing is custom (raw body needed for HMAC) — slack route mounts BEFORE `express.json()`. Env: `SLACK_SIGNING_SECRET`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `PUBLIC_ORIGIN`.

## Brand icons

`GET /api/icons/:provider.svg` — public, cache 24h. Returns simple-icons SVG (3429-icon library at `simple-icons` npm) when the provider has a brand match, otherwise a colored letter avatar from `getLetterIcon()`. Provider→slug map in `backend/lib/icons.js`. No client-side bundling of the icon library; the server pulls from the bundled package and ships SVG bytes.

## Knowledgebase + AI support chat

Help docs live at `docs/help/**/*.md` with `title:`/`description:` frontmatter. Loaded once on first request via `backend/lib/kb.js#getArticles()`. Three consumers from one source: public `/help` and `/help/:slug` pages (route: `routes/help.js`), AI chat context (`searchArticles` + `articlesAsContext`), and future marketing-site SEO. Slug derivation: `docs/help/api/auth.md` → `/help/api/auth`. Restart server (or `reloadKb()`) to pick up new articles.

AI support chat at `POST /api/support-chat` (Settings → Help → AI assistant). **Sandbox is architectural, not filter-based**: the chat handler is a pure function `(userMessage, kbContext) → text`. The LLM never sees `process.env`, the source tree, the DB, our APIs, or other users' data. Inputs: user msg + retrieved KB articles + system prompt + ≤6 turns of caller-supplied history. Output: text only, capped 500 tokens. Daily budget: 25 msgs/UTC-day per user, soft warning at 20 — `support_chat_usage(user_id, day, msg_count)`. Trigger words (refund/cancel/legal/breach/etc.) short-circuit any LLM call and email transcript to `SUPPORT_EMAIL` (default `support@productivity.do`). Transcripts retained 90d in `support_chat_messages`. Don't give the LLM tools — the whole sandbox depends on it.

## Account, sessions, soft-delete

Profile management at `/api/account/*` (route: `routes/account.js`, UI: `ProfileTab.svelte` in Settings → Account → Profile). New columns on `users`: `avatar_path`, `pending_email`, `pending_email_token`, `pending_email_sent_at`, `deleted_at`, `permanently_purge_at`, `original_email`. New table `user_sessions` (one row per active sign-in; cookie carries `req.session.sessionId`). Sensitive ops (delete, change email, change password) require current password verified via `bcrypt.compare`.

**Email change** sends confirmation to the NEW address (not old) — old address gets a security notice. **Soft-delete** sets `deleted_at` + 30-day `permanently_purge_at`, revokes all sessions, clears cookie. **Email gets renamed at delete time** (suffixed `+deleted-<id>-<ts>`) and the original is stashed in `users.original_email` so the column-level `email UNIQUE` constraint doesn't block someone re-signing up with the same address during the 30-day window. Login matches both `email` and `original_email`, restores the original on recovery, and refuses recovery (409) if a fresh active account has since claimed the address. `createUser`, `authenticate`, and `getUserByEmail` all filter `deleted_at IS NULL` so deleted rows can't satisfy active-user lookups. `mode: 'immediate'` skips the window. **Password change** auto-revokes all OTHER sessions (current device stays). **Avatars** uploaded via multer, hashed filename `${userId}-${sha256-16}.${ext}`, served from `/avatars/<file>` (public; on requireAuth bypass list since filenames are unguessable). Gravatar fallback when `avatar_path` is null.

**GDPR/portability export** (`GET /api/account/export`) walks every user-owned row in the schema and returns a single JSON document. Includes: profile (creds redacted), all native + integration metadata, notes + comments, tasks (kanban + focus blocks + hidden events), booking pages with every child resource (event_types, custom_questions, booking_workflows, booking_invites, booking_page_views, time_polls, bookings), routing forms, quick slots, calendar sets + members, event templates, subscribed calendars + events, preferences, links, integrations (tokens redacted), feedback submissions, AI support transcripts, notifications, revisions, operations, sessions, API keys + webhook subscriptions (secrets redacted). Excludes: caches (events_cache, weather_cache, sync_state, idempotency keys, rate buckets), webhook delivery logs, secrets/tokens. **When adding a new user-owned table, add it to `account.js#/api/account/export`** — the audit lives at the bottom of `routes/account.js`. The export covers the full schema as of 2026-05-02; if it drifts, GDPR portability is incomplete.

## Tenancy audit (2026-05-02)

Pre-launch sweep of every authenticated route. The pattern in this codebase is: ownership is verified either by a SELECT with `WHERE id = ? AND user_id = ?` (or a join through an owned parent), then mutation runs. Two defense-in-depth issues were found and fixed: (1) `links.js` DELETE used a separate ownership SELECT then a `DELETE WHERE id = ?` — collapsed into one `DELETE WHERE id = ? AND user_id = ?` so the row count tells the story atomically; (2) `booking-pages.js` PUT verified ownership via `getOwnedPage()` then ran `UPDATE booking_pages WHERE id = ?` — added `AND user_id = ?` for defense-in-depth. Everywhere else the post-write `SELECT * FROM x WHERE id = ?` pattern is safe because either the id came from `lastInsertRowid` (just-created row) or ownership was verified earlier in the handler. **When writing new authenticated routes, the rule is: scope every mutation by user_id directly in SQL, even if you've SELECTed for ownership above.** A separate ownership SELECT + a non-scoped UPDATE/DELETE is one missed code-path away from a tenancy bug.

## Booking widget acquisition CTA

Every public booking surface (`/book/:slug`, `/q/:id`, cancellation/reschedule widget) renders a "Powered by productivity.do — make your own free" link to `/signup`. Per onboarding research (Hulick + OpenView), every distribution surface that doesn't funnel back to signup is a wasted PLG slot. CTA appears: (a) on the booking success state, (b) below the booking card, (c) on the cancellation success state, (d) on the reschedule success state, (e) below the quick-slots widget. Don't strip it on the assumption "the host already brands the page" — the link is for the *invitee*, not the host.

## Stripe configuration gate

`isStripeConfigured()` requires BOTH `STRIPE_SECRET_KEY` AND at least one of the four `STRIPE_PRICE_*` env vars to be set. Returning true with the secret key alone surfaces a 500 mid-checkout when `priceIdFor()` returns null. New helper `isStripePlanConfigured(plan, period)` lets the SPA disable an individual upgrade button when its price isn't wired (e.g., Pro is configured but Team isn't yet) without disabling the whole pricing page.

## TimeGrid keyboard accessibility

WCAG 2.1.1 Level A — full keyboard support across the calendar grid + chip surfaces. The keyboard model is split between a pure helper (`src/lib/utils/timegridKeyboard.js`) and the wiring inside `TimeGrid.svelte`. Tests at `timegridKeyboard.spec.js` document the contract — runnable under vitest if/when we add it.

**Two focus modes**, distinguished by what's focused (DOM is the source of truth, not separate state):

- **Slot focus** — an hour cell is focused. Arrow keys traverse 24 hours × N days, Page Up/Down jumps 4 hours, Home/End to top/bottom of day, Enter/Space opens new-event flow at that time. Arrow at column edge swallows (returns `noop`) so focus doesn't leak to the next focusable element on the page.
- **Event focus** — an event chip is focused. Arrow Up/Down nudges by `prefs.dragSnapMinutes` (Shift halves it for fine-grained moves), Arrow Left/Right shifts ±1 day, Alt+Arrow Up/Down resizes the end time only, Enter/E opens the editor, Delete/Backspace removes (with confirm), Shift+F10 / ContextMenu key opens the right-click menu, Esc returns focus to the surrounding slot.

**Roving tabindex** per WAI-ARIA grid pattern: only one descendant inside `.day-columns` has `tabindex=0` at any time. `focusedDay` + `focusedSlot` track the slot tabstop; `focusedEventId` (composite `${calendarId}|${id}`) tracks the chip tabstop. When `focusedEventId` is non-null, the chip wins; otherwise the slot at (focusedDay, focusedSlot) gets the tabstop.

**ARIA**: `role="grid"` on `.day-columns`, `role="row"` per day-column, `role="gridcell"` on hour-slots AND event chips, plus `aria-rowcount`/`aria-colcount`/`aria-rowindex`/`aria-colindex`. Each gridcell has an `aria-label` derived from `ariaSlotLabel()` or `ariaEventLabel()`. A polite-mode `aria-live` region (`role=status` with `.sr-only` styling) at the top of the wrapper announces moves like "9:00 AM, Tuesday May 12" or "Moved to Coffee with Alex, ...".

**Optimistic patch on keyboard moves**: `applyLocalPatch()` runs before the network round-trip, same as the drag handler. Failed PUT rolls back the patch and announces "Could not update event. Reverting." Don't drop this — keyboard users feel the lag worse than mouse users because they hold arrow keys.

**Companion components also keyboard-accessible**: `EventChip.svelte`, `TaskRow.svelte`, `MonthView.svelte` event bars, `AllDayRow.svelte` working-location chips. All have `role=button` + `tabindex=0` + Enter/Space handlers. Only event chips inside the time-grid get the full move/resize keyboard model — all-day chips don't, because keyboard-driven day-shift on a multi-day span would compete with the slot-focus model on the same surface and confuse SR users. To shift an all-day event's days via keyboard, open the editor with Enter and edit the dates directly.

**Focus-visible CSS**: every focusable surface in the calendar gets a 2px accent outline only on `:focus-visible` (so mouse users don't see haloes on click). Slot focus uses `box-shadow: inset` to stay within the row divider; event chips use `outline-offset` for breathing room.

**Removed `svelte-ignore a11y_*` comments** across `TimeGrid.svelte`, `AllDayRow.svelte`, `EventChip.svelte`, `TaskRow.svelte`, `MonthView.svelte`. New code in these files should not reintroduce them — if Svelte flags an interactive element, the answer is to add the role + key handler, not to suppress.

## Optimistic drag pattern

Drag/drop and other instant-feedback mutations MUST optimistically patch the in-memory store BEFORE the network round-trip. Use `applyLocalPatch(eventId, patch)` from `events.svelte.js` for events; `tasks.svelte.js#updateTask` already does optimistic + rollback for tasks. **Do not** rely on a `dragPreview`-only solution to hide the lag — that masks the bug, doesn't fix it. The store is the source of truth; preview overlays are for in-flight gesture rendering only. Bug fixed 2026-05-01: chip flashed back to original position for one frame between dragPreview clear and server response. Wired in `TimeGrid.svelte#onCommit` (timed events) and `AllDayRow.svelte` mouse-up (all-day events).

## App tabs (top-bar workspace switcher)

User-reorderable + hideable via Settings → Tabs. Pref `appTabs = { order, hidden }`. Cap of 3 visible at a time (`MAX_VISIBLE_TABS` in `appView.svelte.js`); at least 1 must remain visible. Catalog `ALL_APP_TABS` is the single source of truth for tab id → label mapping. Both `Toolbar.svelte` and `MobileBottomNav.svelte` consume `getVisibleTabs(prefs.values)` — don't hard-code the tab list. App.svelte has a `$effect` that bounces `appView` to the first visible tab when the active one becomes hidden. Editor: `src/lib/components/AppTabsEditor.svelte` (drag-to-reorder + hide checkbox). Forward-looking: integration-driven tabs land here when we lift the cap.

## Marketplace at `/integrations`

Full-page route. SPA serves at `/` and `/integrations[/:provider]`. Routing is minimal client-side (`src/lib/stores/routeStore.svelte.js`) — `popstate` + `pushState`, no router dep. App.svelte renders `IntegrationsPage` (lazy chunk) when `route.isIntegrations`, otherwise the regular shell. Settings still has an "Integrations" entry but it's a link button to `/integrations`. Each adapter card shows its simple-icons logo; deep link `/integrations/:provider` scrolls + highlights that adapter on load.

## Offline mode

The SPA at `/` is offline-capable as a PWA. Booking widget at `/book/*` and marketing pages are deliberately online-only. Three layers:

1. **App shell precache** via `vite-plugin-pwa` — `dist/sw.js` precaches HTML/JS/CSS/fonts at install. Workbox `generateSW` mode (config in `vite.config.js`).
2. **Read-through SWR cache** for `/api/{calendars,preferences,calendar-sets,task-columns,focus-blocks,booking-pages,notifications,auth/status,auth/google/status,notes,links}` GETs plus prefix matches on `/api/{tasks,events,integrations}`. Cache name `productivity-api-v1`, 7-day expiry, 200-entry cap.
3. **Write queue** in `src/lib/offline/replayQueue.js` — IndexedDB-backed (`productivity-offline.queue`). `src/lib/api.js` wraps every fetch; mutations during `!navigator.onLine` enqueue with a generated `Idempotency-Key` and return a synthetic `{ok:true, queued:true, idempotencyKey}` envelope. On `online`, drain in insertion order, **last-write-wins** (no conflict UI). Activity log lives in IndexedDB store `activity-log`. `ActivityTab.svelte` MERGES the IndexedDB log with `/api/activity` (server-side revisions) so the user sees one feed for "what just happened?" — sorted newest-first.

SW registration is production-only (`import.meta.env.PROD`) and lazy-loaded via `import('virtual:pwa-register')` in `src/main.js`. Auto-update + 1h re-check interval. `requireAuth` bypass list extended to allow `/sw.js`, `/manifest.webmanifest`, `/workbox-*`, `/registerSW.js` through unauthenticated. Toolbar chip at `src/lib/components/OfflineChip.svelte` shows "Offline" or "Syncing N".

**Excluded from offline:** `/api/v1/*` (public dev API not used by SPA), `/api/support-chat`, `/api/billing/*`, `/api/stripe/*`, `/api/ai/*`, file uploads (multipart not queued today). Full rationale + testing steps + mobile-app parity notes in `docs/internal/offline.md`.

## Note comments (Scope A collaboration)

`note_comments(user_id, note_id, body, created_at, updated_at, deleted_at)` — author-only for now. CRUD at `/api/notes/:id/comments` and `/api/notes/:id/comments/:commentId`. Soft-delete via `deleted_at`. UI: `NoteCommentsPanel.svelte` mounted as an overlay inside `NoteEditor.svelte` (same anchored-overlay pattern as `RevisionHistoryPanel.svelte`). The note must own the comments; route returns 404 (not 403) when the note isn't owned, to avoid leaking existence. Schema mirrors the future `task_comments` shape so a "comments anywhere" generalization is cheap. Scopes B (sharing) + C (live multi-user) deferred per `docs/internal/collaboration-thinking.md` — wait for user demand.

## Task comments

Task comments use the existing Todoist proxy at `/api/tasks/:id/comments` (GET/POST) + `/api/tasks/comments/:id` (PUT/DELETE). Field is `content` (not `body`) and timestamp is `postedAt` (not `createdAt`) — different from note comments because Todoist owns the storage. UI: `TaskCommentsPanel.svelte` overlay in `TaskEditor.svelte` next to the History button. Todoist hard-deletes (no soft-delete window) — confirm modal warns the user.

## Manual resync UX

`manualResync()` in `events.svelte.js` MUST NOT delete the cache entry before refetching. Doing so blanks the in-memory `events` for the duration of the network round-trip — visually the calendar flashes empty on every Sync click. Instead, mark the cached entry stale (`fetchedAt = 0`) so events keep painting from cache while the request is in flight; only the new payload replaces them.

## Integrations marketplace shape

User-facing `/integrations` page shows ONLY adapters with `status: 'stable' | 'beta'` (12 day-one real adapters). Stubs (`status: 'coming_soon'`) are filtered out at `GET /api/integrations` — users never see "Coming soon" cards. The full 102-row catalog lives at `/admin/integrations` (SPA route, lazy-loaded `AdminIntegrationsPage.svelte`) backed by `GET /api/admin/integrations`. Admin-only, gated to `user_id=1` OR `is_team_admin=1`. Read-only — internal reference for what scaffolds exist.

**Why:** "Promising something is not as effective as having it." Showing 102 cards with 90 marked "Coming soon" reads as advertising aspirations, not capability. Decided 2026-05-02 — see `docs/internal/community-and-integrations-strategy.md` and the `integration_breadth_vs_depth` memory entry.

**Decision filter for promoting a stub to user-facing:** ALL of (1) charter user requested it directly, (2) value felt in first week, (3) <2 weeks of work, (4) clear maintenance owner. The `interest_clicks` schema was considered and rejected — there's nothing to click on without stubs visible.

In `routes/integrations.js`, the per-user connection status field (from the `integrations` row) was renamed `connectionStatus` to disambiguate from the adapter classification field (`adapterStatus` ∈ stable/beta/coming_soon/deprecated). `IntegrationsTab.svelte` was updated accordingly. Don't conflate the two.

## In-app feedback

`POST /api/feedback` (auth) accepts `{kind, body, url}`, persists to `feedback_submissions` table, best-effort emails the founder via Resend with `reply_to: <user.email>` so replies route back natively. `GET /api/admin/feedback?limit=N` returns recent submissions for the founder to triage in one place. Rate-limit: 5 per user per hour. UI: `FeedbackModal.svelte` opened from Settings → Help → "Send feedback" button. ⌘+Enter sends, Esc closes. The DB row is the source of truth — Resend failure doesn't fail the user's submission. `SUPPORT_EMAIL` env (default `support@productivity.do`) is the destination.

Why this surface day-one (and no public forum / Discord / GitHub Discussions yet): see `docs/internal/community-and-integrations-strategy.md`. In-app feedback captures private signal without the moderation overhead of a community surface; we can revisit once the founder can commit ~30 min/day for 6 months.

## Admin metrics dashboard

`GET /api/admin/metrics` returns six product-health numbers computed live from existing tables — no analytics-events pipeline. Surfaces at `/admin/metrics` (SPA route, lazy-loaded `AdminMetricsPage.svelte`). Auth: session-only, gated to `user_id=1` OR `is_team_admin=1`. Six cards: signups (30d, sparkline), activation (≥2 distinct days within 7d of signup, 30-60d cohort), WAU (4 weekly buckets), plan mix, retention (D1/D7/D30 from a 30-60d signup cohort), booking conversion (views → confirmed). Definitions live in `backend/routes/admin-metrics.js#computeMetrics`. **Don't add an analytics-events table until volume warrants it** — every metric should derive from data we already keep for product reasons. New metrics: extend `computeMetrics()` and add a card in `AdminMetricsPage.svelte`. Cagan/Inspired discipline: if a number won't change behavior, don't surface it.

## Tasks board column alignment

`.board-pane` in `TasksView.svelte` uses `justify-content: center` — under-filled boards (3 columns × 340px on a 1600px screen) center to align with the toolbar's centered tabs. Trello and Linear both center under-filled boards. Don't switch to `flex-start` without thinking about how it'll look against the toolbar.

## Error tracking (Sentry)

Backend errors flow through Sentry when `SENTRY_DSN` is set. No-op otherwise. Init lives in `backend/lib/sentry.js`; called from `server.js` *before* any other import. Express error-handler middleware mounted after all routes. Request bodies are scrubbed in `beforeSend` to avoid leaking tokens.

**Background-task coverage:** request-handler errors hit Sentry automatically via the Express middleware. Background sweepers + best-effort fire-and-forget paths swallow errors with `console.warn` so they're invisible to the middleware — those need explicit `captureError(err, {component, ...ctx})` calls. Wired so far: `notify.js` (resend, reminders, workflows, user email/sms), `stripe.js` (paid-booking GCal, finalize sweep), `calendarSyncRetry.js` (sweep loop), `operations.js` (LRO failures + sweeper), `webhooks.js` (notification record, retry sweep), `revisions.js` (sweeper). When adding a new background path, follow the pattern: keep the existing `console.warn` for local visibility, add `captureError` alongside with a unique `component` string.

## DB Schema (additions)

Core booking tables:
- `booking_pages` — pages + availability + branding + pacing. Recent additions (via `applyMigrations`): `logo_url`, `cover_image_url`, `brand_color`, `min_gap_min`, `weekly_max`, `has_event_types`, `enable_ics`, `send_emails`, `reminder_24h`.
- `bookings` — invitee + status. Recent additions: `type_id`, `invite_token`, `payment_status`, `payment_intent`, `answers_json`, `reminder_sent_at`, `assigned_user_id` (round-robin), `no_show`.
- `booking_pages` (more recent): `host_user_ids`, `assignment_strategy` (single|round_robin|collective).
- `booking_page_views(page_id, day, views)` — analytics counter.
- `event_types` — multi-meeting (per page).
- `custom_questions` — text/textarea/select/checkbox, page-scoped or type-scoped via `type_id`.
- `booking_workflows` — webhook hooks per page (trigger ∈ on_booked|on_canceled|on_rescheduled|reminder_24h).
- `booking_invites` — single-use tokens (unique `token`, `used_by_booking_id` set atomically on consumption).
- `routing_forms` — questionnaire that maps answers → booking page (rules evaluated server-side only).
- `time_polls` — Doodle-style multi-time proposals (status: pending|confirmed|declined).

Tasks & integrations:
- `tasks_cache` — recent additions: `estimated_minutes` (auto-schedule), `parent_id` (sub-tasks), `local_status` + `local_position` (kanban board, productivity.do-only).
- `task_columns(user_id, position, name, status_key)` — per-user kanban configuration. `status_key` is the stable identifier (`todo|in_progress|done|custom_<n>`); `name` is user-customizable. UNIQUE(user_id, status_key). Up to 5 rows per user.
- `users` — recent additions: `ics_feed_token` (calendar feed), `todoist_token` (per-user PAT).
- `notifications` — in-app feed, user-scoped, `kind/title/body/data_json/read_at`.

Public API tables:
- `api_keys` — sha256(secret) only; never plaintext. Compared with `crypto.timingSafeEqual`.
- `webhook_subscriptions` — outbound event subscriptions, signing secret, events[].
- `webhook_deliveries` — delivery log + retry queue with `next_retry_at`.
- `api_v1_rate_buckets` — persisted per-key/per-IP rate-limit buckets (sliding 60s window, max 120).

Schema runs idempotently on `getDb()` via `CREATE TABLE/INDEX IF NOT EXISTS`. Column-level migrations go through `ensureColumn(db, table, col, def)` in `backend/db/init.js` (validates identifiers, no-op when already present).

## Reference library

`docs/reference-library/` holds 20 curated PDFs across UX, calendar/time/focus, GTD, engineering, API design, IA, product strategy, and timing/rhythms — plus `INDEX.md` (book navigation), `applicable_insights.md` (the working insights doc — what each book/article applies to in our codebase), and `productivity_do_reading_list.md` (curated list of ~80 external engineering articles across 13 productivity.do-relevant topics). **The whole directory is gitignored** — nothing in there is committed. PDFs are personally-owned copyrighted material; INDEX/reading list reveal stack/roadmap detail.

**State as of 2026-05-02:** all 13 unread books in the library have been read by background agents and produced structured insight entries in `applicable_insights.md` (~3500 lines, ~130 Pending actions). Books with `Status: ⏳ Pending` actions represent the working backlog from a literature lens. Articles in `productivity_do_reading_list.md` haven't been processed yet — that's the next pass.

When planning a feature: read `docs/reference-library/INDEX.md` to pick the most-relevant book, then check `applicable_insights.md` for actions already proposed (search for the book title heading). Read the targeted chapter via the Read tool with `pages: "X-Y"` (PDFs over 10 pages need it; chunks of 5-8 pages avoid the per-tool-call 32MB cap). Cite specific sections in design discussions and commit messages so future-us can trace the reasoning.

**Cross-book themes already crystallized** (see memory entries):
- "Time-to-close" as the right product metric (Newport, reinforced by Atomic Habits' Goodhart's Law) — see `time_to_close_metric.md` memory.
- The weekly digest is currently broken three ways (Tufte: no baseline; Newport: engagement-bait; Allen: passive list; Clear: not implementation-intention shaped). One rewrite satisfies all four.
- Two books point at the same schema change — GTD's Areas of Focus and BASB's PARA both want `project_id` on notes.
- "Don't surface back to user" consensus on productivity metrics (Hooked + Clear's Goodhart + Newport).

When proposing actions, follow the convention in `applicable_insights.md`: each action carries a `Status:` line with one of `⏳ Pending` / `🟡 In progress` / `✅ Implemented` / `❌ Skipped`. Edit in place when status changes; don't append siblings.

## Pending Setup

- **Stripe Price IDs:** Set in `.env` to enable Pro/Team checkout flow:
  - `STRIPE_SECRET_KEY=sk_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`
  - `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`, `STRIPE_PRICE_TEAM_MONTHLY`, `STRIPE_PRICE_TEAM_ANNUAL`
  - `PUBLIC_ORIGIN=https://productivity.do`
- **Cloudflare SSL mode:** Set to Full (strict) in dashboard (origin cert installed, API token lacks zone settings permission)
- **Google OAuth:** App in testing mode (unverified), test user: tevan.alexander@gmail.com. For SaaS launch, Google verification + per-user OAuth grants are needed (the schema is already per-user).
- **Resend API key:** Set `RESEND_API_KEY` in `.env` for booking confirmation/cancellation/24h reminder + signup verification emails. Without it all calls no-op silently.
- **Postmark inbound — LIVE.** Server `Productivity-Inbound` (ID 19064779), domain `inbox.productivity.do`, webhook URL embeds `INBOX_WEBHOOK_USER:INBOX_WEBHOOK_PASS@` for HTTP Basic Auth. MX record `inbox.productivity.do → inbound.postmarkapp.com` priority 10 in Cloudflare (DNS-only, orange cloud off). Payload normalizer in handler maps Postmark's capitalized keys to our lowercase shape.
- **Public launch checklist:**
  - Remove the site-gate (see "Removal at public launch" in the [Site-gate](#site-gate-private-beta) section — 4 steps)
  - Configure Stripe Price IDs + webhook in dashboard pointing at `/api/stripe/webhook`
  - Verify Google OAuth (consent screen — currently in testing mode)
  - Remove the `noindex, nofollow` defaults from marketing pages once SEO is desired
- **Optional (if provisioned):**
  - `GOOGLE_MAPS_API_KEY` for `/api/travel-time` to return real durations (otherwise it returns null silently). Travel-time chips on day view are deferred until this is set.
  - `ANTHROPIC_API_KEY` for AI meeting prep summaries. Without it, the "Prep with AI" button returns 503.
  - `INBOX_DOMAIN` for email-to-task. Without it the per-user address still generates but mail won't deliver. Pick a mail receiver provider (SES inbound, Postmark, Cloudflare Email Routing → Worker) and POST parsed mail to `/api/email-inbox/inbound`.
- **Backlog:** see `docs/BACKLOG.md`. Tiers 1-2 shipped. Tier 3 mostly shipped (mobile polish, CSV export, bulk API, focus blocks, AI prep, email-to-task skeleton). Still deferred: travel chips (gated on `GOOGLE_MAPS_API_KEY`), Slack/Teams/Discord deepening, Stripe Connect, OAuth app registry. Tier 4 is the Cagan/Inspired set — charter-user recruitment + opportunity-assessment template (see `applicable_insights.md` for ~130 reading-derived actions across all 13 books).
- **Project card on tevan.co/tools/projects:** ID `de34950e-533a-45da-a254-befd4e154e5f`. Status updates POST to `http://127.0.0.1:3010/tools/api/projects/<id>/status-claude`.
