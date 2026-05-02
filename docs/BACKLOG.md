# productivity.do — Feature Backlog

Living document of features we've discussed but haven't built. Pull from the top when picking next work; promote items into a dated section once shipped.

## Tier 1 — SHIPPED ✓

- **AI auto-scheduling for tasks** — POST /api/tasks/:id/auto-schedule, work-hours-aware via Settings → Tasks, "Auto-schedule" button in TaskEditor.
- **Round-robin & collective availability** — `assignment_strategy` + `host_user_ids` on booking pages, slot intersection (collective) / union (round-robin), load-balanced host pick. Team-plan gated.
- **Recurring event editor** — preset + UNTIL, "this / this & following / all" scope on edits, RFC 5545 RRULE generation, parent-series UNTIL split for "following".
- **ICS subscription URLs** — token-scoped /ics/u/:token, webcal:// URL, regeneratable from Settings → Calendar.
- **Booking analytics dashboard** — per-page Analytics tab: views, conversion, confirmed/canceled, no-show rate, revenue. /api/booking-pages/:id/analytics endpoint, no-show flag PUT.

## Tier 2 — SHIPPED ✓

- **Settings → Billing tab** — current plan, period end, Manage Subscription (portal), Upgrade (checkout to Pro/Team monthly|annual).
- **Plan upgrade prompts** — `code: 'plan_required'` triggers a global UpgradeRoot modal automatically; checkout flow inline.
- **Sub-tasks rendering** — Sidebar uses `withSubtaskOrder()` to nest children under parents with indent; backend exposes `parentId`.
- **Per-user Todoist token** — `users.todoist_token` column, Settings → Tasks → Todoist integration UI with token validation, per-call userId resolution with env fallback.
- **In-app notification center** — `notifications` table, NotificationBell in toolbar, `emitEvent()` records booking.created/canceled/rescheduled, mark-read + dismiss endpoints.
- **Next-available badge on booking pages** — `/api/public/booking/:slug/next-slot`, click-to-jump in widget, formatted in invitee tz.

## Tier 3 — SHIPPED ✓

- **Mobile booking widget polish** — `<640px` breakpoints in BookingWidget + CancelWidget (single-column slots, 44px tap targets, edge-to-edge layout).
- **CSV export** — `/api/booking-pages/:id/bookings.csv` + `/api/events.csv?from&to`. Download buttons in BookingsTab and Settings → Calendar.
- **Public API bulk operations** — `POST /api/v1/events/bulk` and `/api/v1/tasks/bulk` (max 100/req, partial success array). Documented in OpenAPI.

## Tier 3 — Also shipped this pass

- **Focus blocks** — first-class `focus_blocks` table, weekly recurring, Settings → Tasks editor, soft band on TimeGrid, treated as `extraBusy` by auto-schedule.
- **Email-to-task SKELETON** — `users.inbox_token`, `POST /api/email-inbox/inbound` (provider-agnostic body), `/api/email-inbox/{me,regenerate}`, Settings UI shows a yellow "receiver not configured" banner until `INBOX_DOMAIN` env is set. Mail receiver itself (SES/Postmark/Cloudflare) is the next step.
- **AI meeting prep summaries** — Claude Haiku 4.5 via direct fetch, `inputHash`-keyed cache on `events_cache.prep_*`, "Prep with AI" button in EventPopover with regenerate. Gated on `ANTHROPIC_API_KEY`.

## Tier 3 — Status update (2026-05-01)

- **Travel-time blocks on day view** — code is shipped; gated on `GOOGLE_MAPS_API_KEY`. Returns null silently without it. **Action: provision the key in `.env` to enable.**
- **Calendly-style event types per page** — UI is wired in `BookingPageEditor` (CRUD + per-type questions). Closed unless a customer-driven complaint surfaces.
- **Weather chips on day view** — already rendered via `WeatherRow`. Closed.
- **Slack/Discord/Teams integrations** — deferred. Multi-day each; pick one only if a customer requests it.
- **Stripe Connect for marketplace bookings** — deferred. Substantial billing-model work; revisit when there's a real marketplace use case.
- **OAuth app registry** — deferred. Do once we have third-party clients asking for it.

## Operational follow-ups

- **Pick a mail receiver** for email-to-task. Options: AWS SES inbound (cheapest), Postmark inbound, Cloudflare Email Routing → Worker. Then set `INBOX_DOMAIN` in `.env`, point MX records, and have the provider POST to `/api/email-inbox/inbound`. The handler is provider-agnostic — just map the provider's payload to `{to, from, subject, text, html}`.
- **Provision `ANTHROPIC_API_KEY`** for AI prep. Without it the "Prep with AI" button returns a clear 503 message.

## Operational

- **Resend domain verification** for `productivity.do` so transactional emails don't go to spam. (When we wire the actual `RESEND_API_KEY` here.)
- **Sentry or similar error tracking** on the backend — currently we just `console.warn` and rely on `pm2 logs`.
- **Backup the SQLite DB** to the existing restic flow if not already covered.

## Open (added 2026-05-02)

- **Sync UI — preserve calendar contents during refresh** ✓ shipped
  2026-05-02. `manualResync()` now marks the cached range stale instead
  of deleting it.
- **Note + task collaboration / comments**: scope A FULLY shipped
  2026-05-02. Note comments: `note_comments` table + CRUD + overlay
  panel. Task comments: existing Todoist-backed routes surfaced via
  `TaskCommentsPanel` overlay in TaskEditor. Scope B (sharing) + scope
  C (live multi-user) still deferred per
  `docs/internal/collaboration-thinking.md`. @-mentions in comments
  still TODO — needs the user-list UI which requires multi-user data.
- **Historical weather**: see `docs/internal/historical-weather-design.md`.
  Defer until ~20 paying Pro users to model cost.
- **Subscriptions in the sidebar** ✓ shipped 2026-05-01.
- **Mental-model copy refresh** ✓ shipped 2026-05-02 across home /
  features / about / pricing.
- **Wire /pricing.html to /api/plans** ✓ shipped 2026-05-02.
- **Drop indicator for sidebar task drag** — punted 2026-05-02. The
  list (sidebar AND Tasks → list mode) has no manual-reorder concept
  today; tasks are grouped by date/project/label/priority via
  `taskGrouping.js`. A drop indicator without a real drop target would
  signal "you can drop here" when you can't. Build a "Manual" group-by
  mode first (persists `localPosition` per task in list context with
  drop-zone wiring), then add the indicator. Estimated 4-6 hours, not a
  quick win.
- **Activity log unification** ✓ shipped 2026-05-02.

## Tier 4 — Inspired (Cagan) book findings (2026-05-02)

Three pre-launch product-discipline practices flagged by the book agent.
Logging here so they're not lost; #3 (metrics dashboard) being built now.

- **Charter-user recruitment**: pre-public-launch, identify 6–10 users
  who will suffer most without the product. Work with them deeply
  through beta. Their feedback is stronger signal than aggregate. Do
  this BEFORE removing the IP allowlist. Practical step: list candidate
  users + the verb / pain each one solves with productivity.do. Reach
  out individually with a personalized note + 14-day Pro comp. Treat
  their first-week issues as P0.
- **Opportunity assessments**: a one-page template each meaningful
  feature passes through before it lands on the roadmap (problem /
  target user / success metric / business case / leave-out list). The
  point is to refuse work that doesn't tie to a specific opportunity,
  not to add bureaucracy. Worth picking up once 2+ people are
  prioritizing — solo, the discipline shows up in commit messages and
  CLAUDE.md notes.
- **Product-health metrics dashboard**: see active build below.
