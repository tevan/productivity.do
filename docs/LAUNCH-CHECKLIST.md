# productivity.do — Public Launch Checklist

Pre-launch state (2026-05-01): IP-allowlisted at the nginx layer, Stripe Price IDs not configured, Google OAuth in testing mode. Schema is multi-tenant; all the pieces wait on env config + account-side approvals.

This doc is a checklist *for the human*. Nothing here should be run autonomously by an agent — every item either changes prod behavior, costs money, or commits to an external account. Walk through it manually when ready to flip the switch.

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

## 5. Optional integrations (skip for launch, wire later)

- [ ] **Tomorrow.io API key** for weather narratives — `TOMORROW_API_KEY=...`. Without it the WeatherRow falls back to Open-Meteo and the narrative tooltip says "no details available."
- [ ] **Anthropic API key** for AI meeting prep — `ANTHROPIC_API_KEY=sk-ant-...`. Without it the "Prep with AI" button returns a friendly 503.
- [ ] **Google Maps API key** for travel-time chips — `GOOGLE_MAPS_API_KEY=...`. Without it `/api/travel-time` silently returns null and the day-view travel band uses `~` placeholders.
- [ ] **Postmark inbound** for email-to-task — already provisioned (server `Productivity-Inbound`, ID 19064779), MX record live in Cloudflare. Just confirm `INBOX_DOMAIN=inbox.productivity.do` is set in `.env`.

## 6. Remove the nginx IP allowlist

This is the actual "go live" moment. Once this lands, anyone on the internet can hit the site.

- [ ] Verify items 1-3 above are green.
- [ ] On the server, edit `/etc/nginx/sites-available/productivity.do.conf` and remove (or comment out):
  ```nginx
  # IP allowlist
  allow 69.131.127.243;
  deny all;
  ```
- [ ] `sudo nginx -t && sudo systemctl reload nginx`
- [ ] Verify from an outside network (phone hotspot or a VPN) that you can reach `productivity.do/home.html` and the booking widget at `/book/:slug`.
- [ ] Verify rate limits work: hit `/api/v1/ping` 130 times in a minute from one IP, expect a 429.

The convenience script at `scripts/launch-go-live.sh` does steps 5.2 + 5.3 with a backup of the previous config (so you can revert in seconds if something goes wrong).

## 7. Post-launch monitoring (first 48h)

- [ ] Watch `pm2 logs productivity` for `error` lines.
- [ ] Watch `/var/log/outage-attribution.log` — origin/edge/DNS attribution for any blip.
- [ ] Set up Sentry (or equivalent) for backend error tracking — currently we rely on `pm2 logs`, which truncates at the rotate boundary.
- [ ] First-day metrics to glance at:
  - Signups (`SELECT count(*) FROM users WHERE created_at > date('now','-1 day')`)
  - Booking conversions (per-page analytics endpoint)
  - 4xx/5xx ratio in the access log
  - Stripe checkout success vs. abandonment

## 8. After launch — rollback plan

If anything goes wrong, the rollback is fast:

- **Site misbehaving:** restore the nginx allowlist with `scripts/launch-go-live.sh --restore` and `sudo systemctl reload nginx`.
- **Stripe webhook taking bad signups:** revoke the webhook secret in the dashboard; the route returns 400 for everything until you set a new one.
- **Bad code shipped:** `git revert <sha> && pm2 restart productivity`. The `events_cache` and `tasks_cache` rebuild on next sync.

The site has nothing in production database that isn't either rebuildable from upstream (Google/Todoist) or owned by the user (notes/booking-pages/links/focus-blocks). Backups via restic run hourly remote + 15-min local.
