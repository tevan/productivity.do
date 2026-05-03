# productivity.do — Public Launch Checklist

**Canonical user-action list.** This is the doc to walk through when prepping for launch. Everything here is something you (the human) need to do — accounts, dashboards, dollars, or external approvals. Agents shouldn't run any of this autonomously.

Status as of 2026-05-02: site-gate password-protected, Stripe Price IDs unset, Google OAuth in testing mode, Resend/Sentry/Anthropic keys unset, charter-user list TODO, redesign in flight. Code surfaces are launch-ready (multi-tenant schema, billing flow, plan gates, full keyboard a11y, GDPR export, tenancy-audited).

When you complete an item, leave the box checked and add a date. When you discover something new that needs to happen before launch, add it here — this list is the single source of truth.

---

## 1. Stripe — billing live

You can ship without paid plans (Free tier is the SPA itself), but the Pro/Team upgrade flow returns 500 today because Price IDs aren't set.

- [ ] Create products in Stripe Dashboard:
  - Productivity Pro — $12/mo, $120/yr
  - Productivity Team — $20/user/mo, $200/user/yr
- [ ] Copy each Price ID into `/srv/www/productivity.do/.env`:
  ```
  STRIPE_SECRET_KEY=sk_live_...
  STRIPE_WEBHOOK_SECRET=whsec_...        # generated when adding the webhook endpoint below
  STRIPE_PRICE_PRO_MONTHLY=price_...
  STRIPE_PRICE_PRO_ANNUAL=price_...
  STRIPE_PRICE_TEAM_MONTHLY=price_...
  STRIPE_PRICE_TEAM_ANNUAL=price_...
  PUBLIC_ORIGIN=https://productivity.do
  ```
- [ ] In Stripe → Developers → Webhooks, add endpoint `https://productivity.do/api/stripe/webhook` listening on `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.paid`, `invoice.payment_failed`. Paste the signing secret as `STRIPE_WEBHOOK_SECRET`.
- [ ] `pm2 restart productivity` and place a test purchase from a fresh account on the Free tier; verify `users.plan` flips to `pro` and the upgrade modal closes.

## 2. Google OAuth — verification

App is currently in "testing" mode with one test user. Public launch needs verification or it'll show the unverified-app warning and cap users at 100 testers.

- [ ] In Google Cloud Console → OAuth consent screen, add the privacy policy and terms URLs (already at `productivity.do/privacy.html` and `/terms.html`).
- [ ] Submit for verification. Scopes used: `calendar.readonly`, `calendar.events`, `userinfo.email`, `userinfo.profile`. Verification typically takes 4-8 weeks for sensitive scopes.
- [ ] **Until verified**: launch can proceed with a "verification in progress" notice on the signup page; OAuth still works for everyone, just with a scary warning screen. New users are auto-enrolled as testers up to 100.
- [ ] Once verified, remove the testing-mode notice.

## 3. Resend — transactional email

Booking confirmation, cancellation, 24h reminder, and signup verification all use Resend. Without `RESEND_API_KEY` they no-op silently — fine for soft launch, ugly for real users.

- [ ] Create a Resend account, add a domain (`productivity.do`), add the DKIM/SPF DNS records via Cloudflare (DNS-only).
- [ ] Wait for verification (usually <1h).
- [ ] Set `RESEND_API_KEY=re_...` in `.env`.
- [ ] `pm2 restart productivity`.
- [ ] Test: book a slot on your own booking page from an incognito tab; confirm the email arrives and is not spam-flagged.

## 4. Customer support email

The AI support chat in Settings → Help routes escalations (trigger words like "refund", "cancel subscription", "lawsuit", or user-clicked "Talk to a human") to `support@productivity.do`. That mailbox needs to exist before launch.

- [ ] Set up `support@productivity.do` — the simplest path is a Cloudflare Email Routing rule that forwards to a personal mailbox you check daily. No new MX needed beyond what already exists.
- [ ] Optional but better long-term: create the mailbox in your help-desk tool of choice (Help Scout, Front, Plain) so transcripts land in a queue you can triage.
- [ ] Set `SUPPORT_EMAIL=support@productivity.do` in `.env` (currently defaults to that address — explicit env makes it overridable).
- [ ] `pm2 restart productivity` and test: in Settings → Help, type "I want a refund" and confirm the transcript arrives at the support mailbox.

The AI chat will work without this set, but escalations silently fail. Don't ship to real users without a mailbox someone reads.

## 5. Sentry — backend error tracking

Currently `SENTRY_DSN` is unset and the boot logs say so on every restart. The instrumentation is already wired throughout — `notify.js`, `stripe.js`, `calendarSyncRetry.js`, `webhooks.js`, `revisions.js`, `operations.js`, the global Express error middleware. Without the DSN, every error past `console.warn` lives only in `pm2 logs` until rotation.

- [ ] Create a Sentry project for productivity.do (sentry.io free tier is fine for solo).
- [ ] Set `SENTRY_DSN=https://...` in `.env`.
- [ ] `pm2 restart productivity`. The boot log should now read `[sentry] initialized` instead of `[sentry] SENTRY_DSN not set`.
- [ ] Verify by triggering a known-bad path (e.g. `curl localhost:3020/api/billing/portal -H "Cookie: …"` against a user with no `stripe_customer_id` to force the 500). Confirm the error appears in the Sentry dashboard within ~30 seconds.

Worth doing weeks before launch — it lets you watch the error rate during the redesign in real time instead of finding out after.

## 6. Charter-user list (Cagan/Inspired)

Pre-launch literature flag: identify 6-10 people who will benefit most from the product. Personal outreach beats aggregate signal during private beta.

- [ ] List 6-10 candidate users with the specific verb/pain each one solves with productivity.do (e.g. "Maya — runs three calendars across two clients, currently triple-books herself").
- [ ] Send personalized outreach (NOT a marketing blast). Offer 14-day Pro comp + your direct contact for first-week issues.
- [ ] Give them site-gate access today; don't wait for public launch. Their first-week issues are P0.
- [ ] Track first-week sentiment + a single "would you be disappointed if this product disappeared?" question at day 14.

Do this BEFORE removing the site-gate (item 8). Their feedback shapes the redesign.

## 7. Optional integrations (skip for launch, wire later)

- [ ] **Tomorrow.io API key** for weather narratives — `TOMORROW_API_KEY=...`. Without it the WeatherRow falls back to Open-Meteo and the narrative tooltip says "no details available."
- [ ] **Anthropic API key** for AI meeting prep + AI support chat — `ANTHROPIC_API_KEY=sk-ant-...`. Without it the "Prep with AI" button returns a friendly 503 and the support chat is disabled. **Marketing pages currently advertise both — provision the key OR strip the AI claims before launch, otherwise it's false advertising.**
- [ ] **Google Maps API key** for travel-time chips — currently SET in .env. ✅
- [ ] **Postmark inbound** for email-to-task — currently SET (server `Productivity-Inbound`, ID 19064779, MX record live, `INBOX_DOMAIN=inbox.productivity.do`). ✅

## 8. Cloudflare SSL Full (strict)

Origin certificate is installed but Cloudflare SSL mode is currently Flexible (or unconfigured). API token doesn't have zone-settings permission so this needs a manual UI step.

- [ ] In Cloudflare → SSL/TLS → Overview, set encryption mode to **Full (strict)**.
- [ ] Verify with `curl -I https://productivity.do` from outside the server — should return 200 with no cert warnings.

## 9. Remove the site-gate (THE actual go-live moment)

Once this lands, anyone on the internet can hit the SPA + `/api/*`. Marketing pages, booking widgets, and the developer surface are already public.

- [ ] Verify items 1-6 above are green and at least 5 charter users have spent a week on it.
- [ ] Delete the site-gate code surface (4-step procedure, see CLAUDE.md "Removal at public launch" subsection of [Site-gate](../../CLAUDE.md#site-gate-private-beta)):
  1. Delete `backend/routes/site-gate.js` and `backend/views/site-gate-login.html`.
  2. Remove the `siteGateRoutes` import + `app.use(siteGateRoutes)` line + `/site-gate/*` bypass in `backend/server.js`.
  3. In `/etc/nginx/sites-available/productivity.do.conf`, delete the `auth_request /site-gate/_verify` directive on `location /`, the `error_page 401 = @site_gate_login` block, and the public `/site-gate/`, `/site-gate/_verify` location blocks.
  4. Delete `SITE_PASSWORD`, `SITE_AUTH_SECRET`, `SITE_GATE_BYPASS_IPS` from `.env`.
- [ ] `sudo nginx -t && sudo systemctl reload nginx && pm2 restart productivity`.
- [ ] Verify from an outside network (phone hotspot or VPN) that you can reach `productivity.do/` (SPA, no password prompt), `/home.html` (marketing), and the booking widget at `/book/:slug`.
- [ ] Verify rate limits work: hit `/api/v1/ping` 130 times in a minute from one IP, expect a 429.

## 10. Post-launch monitoring (first 48h)

- [ ] Watch `pm2 logs productivity` for `error` lines.
- [ ] Watch `/var/log/outage-attribution.log` — origin/edge/DNS attribution for any blip.
- [ ] Watch the Sentry dashboard (set up in section 5) for issue spikes.
- [ ] First-day metrics to glance at — `/admin/metrics` shows all of these:
  - Signups (last 30d sparkline)
  - Activation (≥2 distinct active days within 7d of signup, 30-60d cohort)
  - WAU (4 weekly buckets)
  - Plan mix (free/pro/team)
  - Retention (D1/D7/D30 from a 30-60d signup cohort)
  - Booking conversion (views → confirmed)
- [ ] Stripe checkout success vs. abandonment from the Stripe dashboard.

## 11. Post-launch distribution (after `plan_today` MCP ships)

When the MCP-workflow-tools track is shipped (priority #2 in
`docs/internal/productivity-surface-strategy.md`), submit our MCP to
the open catalogs for free distribution. The horizontal aggregator
play (Rube/Composio, Zapier Central) has been pulled back from
consumer tier — vertical-with-strong-MCP is what survives, and
catalog presence is how we get reached.

- [ ] **Composio For You** — works with any MCP client; positioning
  to be the developer-tier MCP aggregator after Rube's May 15
  shutdown. Submit via [composio.dev](https://composio.dev/) (verify
  URL at submission time).
- [ ] **smithery.ai** — community MCP catalog.
- [ ] **glama.ai/mcp** — MCP server directory.
- [ ] **mcp.so** — additional listing.

Do NOT submit before `plan_today`, `triage_inbox`, and
`summarize_project` are stable. CRUD-only MCPs are commodity; submit
when workflow tools differentiate us.

## 12. After launch — rollback plan

If anything goes wrong:

- **Site misbehaving:** restore the site-gate by reverting the section-9 commit (`git revert <sha> && pm2 restart productivity`). The gate code is one commit away — adversaries lose access in seconds.
- **Stripe webhook taking bad signups:** revoke the webhook secret in the dashboard; the route returns 400 for everything until you set a new one.
- **Bad code shipped:** `git revert <sha> && pm2 restart productivity`. The `events_cache` and `tasks_cache` rebuild on next sync.

The site has nothing in production database that isn't either rebuildable from upstream (Google/Todoist) or owned by the user (notes/booking-pages/links/focus-blocks). Backups via restic run hourly remote + 15-min local. Test a restore once before launch — the worst time to discover a backup gap is during recovery.
