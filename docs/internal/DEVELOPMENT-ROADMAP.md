# Development roadmap

**Date:** 2026-05-02
**Owner:** Single founder, AI-leverage
**Time horizon:** Now → first 6 months post-launch
**Source-of-truth:** `productivity-surface-strategy.md`. This doc operationalizes the strategy.

This roadmap states current state, the build sequence to charter validation, the launch checklist, the charter-user recruitment plan, and what happens after the first signal lands.

## Current state (as of 2026-05-02)

### What's shipped and working

**Core product:**
- Calendar — Google Calendar sync, drag/drop, recurrence, all-day events, multi-calendar support, custom color schemes, full keyboard accessibility (WCAG 2.1.1).
- Tasks — Todoist mirroring, kanban board, projects, sub-tasks, comments, sections, labels, sub-task ordering.
- Notes — Markdown editor, revisions (90-day history, 50-version cap), comments, project linking, context panel.
- Booking pages — Calendly-style scheduler, multi-event types, custom questions, workflows, single-use invites, time polls, routing forms, paid bookings via Stripe Connect.
- Voice capture — Whisper transcription + Claude Haiku classification → routes to task/event/note/comment with preview-and-confirm.
- Today panel — Synthesis surface (`Y` shortcut) showing decisions, ledger, observations.
- Projects as first-class — Pin (cap 3), intent line, due date, rhythm, momentum, project page with tasks/events/notes context.

**Integrations:**
- Google Calendar (full read/write, OAuth).
- Todoist (full read/write, per-user PAT).
- 12 day-one real adapters live; 90 stub adapters in admin catalog.

**Infrastructure:**
- Multi-tenant SaaS schema (users table, signup, login, sessions, soft-delete).
- Stripe billing wired (waiting on Stripe Price IDs to launch).
- Public developer API at `/api/v1` (Bearer pk_live tokens, scoped, OpenAPI spec).
- MCP server with 9 tools (CRUD-shaped today; workflow-shaped queued).
- Outbound webhooks (HMAC-signed, retry queue).
- Slack app (slash command + OAuth).
- Offline mode (IndexedDB write queue + service worker + last-writer-wins replay).
- Sentry for backend errors.
- Multi-tenancy audit completed (every UPDATE/DELETE scoped by user_id in WHERE).
- GDPR portability export.
- Site-gate password (private beta layer; removable on public launch).

**Documentation:**
- ~80 sections of CLAUDE.md architecture documentation.
- ~10 strategy docs in `docs/internal/`.
- 11 help articles in `docs/help/`.
- Reference library of 20 PDFs with applicable insights extracted.

### What's not yet shipped (gating launch)

- Stripe Price IDs (env vars unset — billing UI shows but checkout fails).
- Resend domain verification (transactional email goes nowhere).
- Sentry DSN (errors only logged locally).
- Anthropic API key (AI features return 503 — meeting prep, voice classification, support chat).
- Cloudflare SSL set to Full (strict).
- Google OAuth app verification (OAuth in test mode; Google review takes 4-6 weeks).
- Charter-user list (TODO).
- Site-gate removal (do last; gates the SPA + /api/* during private beta).

### Strategic direction (locked 2026-05-02)

The four load-bearing investments:
1. Files unified across calendar/tasks/notes.
2. MCP workflow tools (`plan_today`, `triage_inbox`, `summarize_project`, v2 `rebalance_week`).
3. The "what should I do right now" surface.
4. Cross-pillar timeline.

Plus trust-state instrumentation for charter-user validation.

The pillar-stakes thesis (Estimation Intelligence, Time Ledger, Live Context Panel) is demoted — those features stay shipped but stop getting investment.

## Future state (12 months out)

A user opens productivity.do (or asks ChatGPT/Claude/Siri "what should I work on?"). They see one screen with one sentence:

> *"Right now: prep for the 2pm sync with Anne. You have 50 minutes free. Sara sent the spec doc Tuesday — it's attached. Three open questions in your notes from last week's meeting are still unresolved. Start →"*

Click Start. Focus block lands on calendar from now until 1:55. Note opens, scrolled to unresolved questions. Spec doc is right there.

Same answer reachable from ChatGPT. From Claude. From Siri. From any AI assistant that calls our MCP server. The user can be wherever they want; the answer follows them.

Behind the surface:
- 4 workflow MCP tools live and stable.
- Charter users (6-10) report it's a daily habit ("I check this every morning").
- At least one charter user has unprompted said "I asked ChatGPT to plan my day and it called you."
- The booking-widget CTA is converting non-charter signups.
- Featured in 1-2 MCP catalogs (Composio, smithery).
- ChatGPT Connectors Store submission in flight.

## Build sequence to charter validation

Realistic time estimates for a single founder with AI-leverage. Days, not weeks.

### Pre-build (0-2 days): launch-checklist preparation

Before shipping new features, close the launch-checklist gaps that gate validation. The MCP and next-thing surface are useless to charter users if AI features 503 or Stripe Checkout fails.

- [ ] Stripe Price IDs (1-2 hours: Stripe Dashboard → create products → paste IDs into `.env`).
- [ ] Resend API key + domain verification (1-2 hours: Resend dashboard + DNS records).
- [ ] Sentry DSN (15 min: Sentry project → DSN → `.env`).
- [ ] Anthropic API key (10 min: console.anthropic.com → key → `.env`).
- [ ] Cloudflare SSL = Full (strict) (5 min in Cloudflare dashboard).

Google OAuth app verification is a 4-6-week wait that shouldn't gate charter users (charter users are owner-known, OAuth test-mode email allowlist accommodates them).

### Build phase (3-5 days)

Day 1-2 — Files unified across pillars + MCP workflow tools (parallel work).

Files:
- `files` table (user_id, hash, mime, size, original_name, storage_path).
- `file_links(user_id, file_id, source_type, source_id)` — the "appears in" relationship.
- Upload endpoint with size limit + dedup by hash.
- File picker component reusable in EventEditor, TaskEditor, NoteEditor.
- Drag-drop handlers in all three editors.
- Paste-from-clipboard for images.
- Per-file "appears in" rail (panel showing all events/tasks/notes that reference this file).

MCP workflow tools (`backend/mcp/server.js`):
- `plan_today` — wraps `backend/lib/ranker.js#rankTasks`. Returns ranked list with explanation parts (why this, why now, what would change the answer).
- `triage_inbox` — wraps `/api/voice/route` classifier. Free-text in, classified resource + confidence + slot suggestion out.
- `summarize_project` — wraps `getProjectMomentum` + `/api/projects/:id/context`. Outputs momentum, intent, open tasks, recent activity, due-date countdown.
- All three exposed in `GET /api/v1/openapi.json`.
- Documentation at `docs/help/api/mcp-workflows.md`.

Day 3 — "What should I do right now" surface.
- Existing `TodayPanel.svelte` evolves into the primary surface.
- Three-part explanation contract per recommendation (why this, why now, what would change).
- One-click Start: creates focus block + opens linked resource + surfaces attached files.
- `Space` hotkey from anywhere reveals it.
- Phone breakpoint: this becomes the default landing screen.

Day 4 — Trust-state instrumentation + cross-pillar timeline.

Instrumentation:
- `recommendation_events(user_id, recommendation_id, event_type, ts, context_json)` table.
- Event types: `accepted`, `dismissed`, `manually_overridden`, `started_but_abandoned`, `re_ranked`.
- Founder-facing dashboard at `/admin/recommendations` showing per-user trust signals.
- Daily digest email to founder summarizing the week.

Timeline:
- `/api/timeline?range=day&date=YYYY-MM-DD` and `/api/timeline?range=project&project_id=X`.
- Pure SQL UNION over `revisions` + `links` + `tasks_cache` + `events_cache` + `recommendation_events`.
- Frontend timeline view (lazy-loaded per the existing pattern).

Day 5 — Polish + charter-user onboarding scripts.
- Welcome email sequence (3 messages: signup → day 3 → day 7).
- Charter-user onboarding deck (5 slides).
- Founder's daily review cadence: 9am check the recommendation dashboard for last 24h.

### Validation phase (~30 days)

Ship to 6-10 charter users. Founder-as-PM mode: each charter user gets the founder's phone number, daily/weekly check-ins, fast iteration.

Weekly cadence:
- Monday: review dashboard, identify ranking misses, ship fixes by EOD.
- Wednesday: 30-min call with 1-2 charter users.
- Friday: weekly summary email to all charter users.

Iteration loop: if 3+ charter users dismiss similar recommendations, re-tune ranker weights that day. If a charter user reports a bug, fix and ship same day.

## How to get charter users

The hardest unsolved problem. The strategy doc and brief have called this out repeatedly. Here's the operational plan.

### The profile

The ideal charter user fits 4 of these 5:
1. Currently uses Google Calendar **and** a task system (Todoist, Asana, Linear, Things).
2. Already uses ChatGPT or Claude for work (Pro tier preferred).
3. Self-describes as "overwhelmed" or "always behind on planning."
4. Has 5+ meetings per week and 20+ active tasks.
5. Knows the founder personally or 1 degree separated (so feedback is candid).

NOT good charter user fits:
- Already uses a system they love (Things + Apple Notes; Notion-as-OS).
- Single-tool simplicity preference (e.g., happy with just Apple Reminders).
- Doesn't use AI assistants for work.

### The recruitment plan (60 days, 6-10 users)

**Week 1-2: build the list.**

Spend 2-3 hours making a candidate list of 30 people from:
- Founder's professional network (former colleagues, ex-coworkers, advisors).
- Founder's personal network (friends in tech who fit the profile).
- People who've publicly complained about productivity tools on X / HN / blogs (3-5 max — risky because cold).
- Charter users from the existing single-user product (if any signed up despite the IP allowlist + site gate).

For each, note: name, current stack, why they fit, how to reach them, who introduces if needed.

**Week 3-4: outreach (personalized, no template).**

For each candidate:
- Personal message via the channel they actually use (text, email, DM — not LinkedIn).
- 3 sentences: what we built, why I thought of them specifically, ask for 30 min.
- No demo links upfront. Get the call first.

Target: 30 candidates → 15 calls → 6-10 yes.

**Week 5-6: onboarding.**

For each yes:
- 30-min onboarding call. Walk them through the surface. Get them to pin 2 projects and write one intent line on the call.
- 14-day Pro comp (no credit card required).
- Founder's phone number.
- Add to a private Slack/iMessage group with the other charter users.
- Schedule a follow-up at 7 days.

**Week 7-8+: weekly engagement.**

- Founder reviews the recommendation dashboard daily.
- Wednesday call with 1-2 different charter users each week.
- Friday email: "What did the product get right this week? What did it get wrong?"

### What to NOT do for charter recruitment

- Public launch announcement (Product Hunt, X) — burns the launch story before the product is ready.
- Cold outreach to email lists — spam shape.
- "Beta access waitlist" — creates pressure to ship before ready.
- Content marketing as recruitment — slow burn, won't yield 6 users in 60 days.
- Discord / community building — too early; <100 users would feel empty.

### Backup if the network is too thin

If after 2 weeks of outreach we have <5 yeses, the issue is the candidate list, not the message. Options:
- Ask each "yes" for 1-2 referrals to people who fit the profile.
- Founder publishes ONE blog post about the product (in the founder's voice, not marketing copy) and shares with their network. Goal: 1-2 charter users per post.
- Pay for 3 user-research interviews via UserInterviews.com. Not charter users, but validates whether the buyer profile is right before investing more in recruitment.

## Post-validation: what happens when signals land

The 90-day winning check from the brief:
1. Charter users say "I check this every morning."
2. A charter user, unprompted, says "I just told ChatGPT to plan my day and it called you."
3. Someone outside the charter group signs up because their colleague uses it.

If signals 1-3 land within 90 days, the strategy is working. Then:

### Immediate (days 91-120)

- Submit MCP to Composio For You catalog.
- Submit to smithery.ai, glama.ai/mcp, mcp.so.
- Apply to ChatGPT Connectors Store (multi-month review, start now).
- Public launch: marketing site update, single blog post, Product Hunt prep.
- Pricing live with public Stripe Checkout.

### Months 4-6

- Second blog post (one per month, real product writing, not SEO bait).
- Distribute charter-user testimonials (with permission).
- App Intents for iOS (if iOS app exists by then).
- Gemini Actions for Android (lower priority).
- Begin instrumenting expansion-revenue signals (free → Pro conversion).

### Months 7-12

- Evaluate adjacent vertical (finance OR health OR CRM — not all three) IF signal-1 (daily-habit retention) is strong.
- If signals didn't land, refer to the falsifiability section in the brief and re-evaluate.

## Risks specific to the build sequence

### Risk 1: Stripe / Resend / Sentry set up wrong, charter users hit failures

Mitigation: do the launch-checklist items end-to-end on day 0 with a test account. Before any charter user, the founder uses the product in incognito with a fresh email and walks through signup → checkout → AI prep → all features. If anything 503s, fix before charter outreach.

### Risk 2: Build phase runs over due to scope creep

Mitigation: the strategy doc encodes what we're not building. If during the build phase you're tempted to "just add" something not on the list, defer to post-validation. The 5-day estimate assumes no creep. If creep happens, days 6-7 are buffer; days 8+ are scope problem.

### Risk 3: Charter users don't actually pin projects or write intent lines

If charter users use the product without engaging with the captured-signals UI, the ranker has nothing to work with and recommendations feel generic. Mitigation: the onboarding call walks them through pinning + intent line live. Don't deploy without the onboarding ritual.

### Risk 4: Founder burnout during validation window

30 days of daily-dashboard-review + weekly calls + same-day bug fixes is sustainable for 30 days, not indefinitely. If signals don't land in 90 days and charter user count is still 6-10, the right move is to stop, evaluate, and either reset the strategy or accept indie-scale outcome.

## What this roadmap is and isn't

It IS:
- The operational sequence to get from current state to charter validation.
- Realistic timelines (days, not weeks) for a single AI-leveraged founder.
- The recruitment plan for charter users.
- The trigger conditions for what happens after the first signals land.

It IS NOT:
- The full strategy (see `productivity-surface-strategy.md`).
- The customer pitch (see `end-state-vision.md` and `CONVERSATION-BRIEF-2026-05-02.md`).
- A fundraising plan (none planned).
- A marketing plan beyond charter validation + light content.

## When to update this roadmap

- Any time a build step ships, mark it complete and update current state.
- When charter validation starts, update with actual recruited users (anonymized if needed).
- When a 90-day signal lands or fails to land, update with the lesson and the next step.
- Quarterly review at minimum, even if no major changes.
