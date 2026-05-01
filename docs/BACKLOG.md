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
