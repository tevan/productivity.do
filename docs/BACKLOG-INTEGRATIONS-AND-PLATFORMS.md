# Integrations & Platforms — Backlog

Captured 2026-05-01 from a long planning conversation. This is the
forward-looking inventory of integrations, platform extensions, and
strategic decisions we've talked through but not yet executed.

The marketplace itself ships with 102 adapters across 15 categories
(see `backend/integrations/registry.js`). Most are stubs surfaced as
"Coming soon" — depth is deliberate breadth-first so users see "yes,
they support what I use" before signup.

---

## Strategic decisions still pending

### Developer-platform apps (Zapier/Make/n8n/IFTTT/Pipedream/Workato/Activepieces)

Scaffolds live in `docs/integrations/<platform>/`. None submitted.

Before submission we need to decide:

1. **App branding** — name (`productivity.do`?), logo (256×256 PNG),
   tagline, color, short description per platform's required shape
2. **Plan-tier eligibility** — Does using Zapier require Pro+, or is
   `/api/v1` open to Free users from third-party platforms? Affects
   how we describe each integration
3. **Partner-program engagement** — Zapier Partner Program, Make
   Featured Apps, n8n verified partner, Activepieces community pieces.
   Each is 2-4 weeks of back-and-forth. Pick which to pursue first
4. **IFTTT OAuth surface** — IFTTT requires us to host a real OAuth 2.0
   flow. ~hundreds of lines. Build now or wait until IFTTT accepts us?
5. **Submission timing** — Zapier and Make each take 2-4 weeks of
   review. Sequence them so we're not blocked

### Marketplace mode field (already shipped)

Every adapter declares `mode`:
- `sync` — two-way (default)
- `import` — one-way bring-data-in (Calendly/SavvyCal/Cal.com,
  competitor migrations)
- `read` — read-only context surface (Strava/Garmin on calendar,
  Stripe MRR daily widget, Beehiiv/Buffer scheduled posts on calendar)

Currently 80 sync · 13 read · 9 import.

---

## Editor / agent / chat platforms

Two artifacts being built next:

### 1. MCP server at `productivity.do/mcp` (PRIORITIZED)

Exposes our data as MCP resources and our actions as MCP tools. Any
MCP-aware client mounts it.

Covers natively:
- Claude Code (CLI)
- Claude Desktop
- Cursor (VS Code fork)
- Cline / Continue / Aider / Roo Code / other MCP clients

Auth: Bearer `pk_live_…` API keys (existing surface).

Decided: full bidirectional read+write from day one (the API is
already there).

### 2. Slack app (PRIORITIZED)

Slash command `/productivity new task: …` + right-click "Send to
productivity.do" message action.

Decided: just the slash command for v1. Skip daily-digest bot post.

### Paused — VS Code + JetBrains extensions

Real demand exists. Build later when we have customer pull. Notes:
- VS Code extension (TypeScript) auto-runs in Cursor + Windsurf because
  they're VS Code forks
- JetBrains is a separate codebase (Kotlin plugin SDK)
- Auth via API key paste (device-code flow is nicer but 2x effort)
- TODO comment scanning is opinionated — off by default, surfaced as
  a setting if we add it. Currently parked: "let's see if someone
  asks for it"

### Out of scope (don't expand here)

We're holding the line at 2-3 platforms done well, not 8 done poorly.

- **GitHub Copilot** — proprietary, no extension hook
- **Sublime / Helix / vim** — small audiences
- **Linear's Asks / Slack-mode tools as separate adapters** — these
  are message-to-task converters, fundamentally Slack/Discord/Teams
  app surface area. Already covered by the Slack app above

---

## Marketplace stubs to deepen (when prioritized)

These are stubs today; depth is the work.

### Calendar (5 stubs)
- Apple Calendar (CalDAV pre-fill — iCloud server URL)
- Yahoo Calendar / AOL Calendar (CalDAV)
- Fastmail Calendar (CalDAV)
- Proton Calendar (CalDAV)
- TripIt (read-only — flights/hotels auto-add to calendar)

### Tasks (real depth wanted)
- Apple Reminders (CalDAV-backed but most users don't know that)
- Things 3 (URL scheme + iOS app sync; needs iOS companion)
- TickTick (Todoist's main competitor, big in Asia)
- Airtable (PAT, treat rows as tasks — large user base)
- Habitica (gamified habits, recurring tasks)
- Streaks (iOS app — needs companion)
- Beeminder (recurring goals as tasks)
- GitLab / Gitea / Bitbucket (issue trackers we have stubs for)
- Shortcut (formerly Clubhouse)
- Sentry (issue → task)
- Basecamp / Wrike (project management we have stubs for)

### Notes (real depth wanted)
- Obsidian (Local REST API plugin)
- Roam Research, Logseq (PKM crowd)
- Bear (macOS/iOS — x-callback-url)
- Mem (AI-powered notes)
- Apple Notes (iCloud — needs iOS companion)
- Readwise / Pocket / Instapaper / Matter (read-later imports)

### Fitness / context (read-only)
- Strava — show activities as busy time
- Garmin Connect — workouts + sleep
- Apple Health — needs iOS companion
- Health Connect (Android) — replaces Google Fit (deprecated)

### Content publishing (read-only — surface scheduled posts)
- Beehiiv, Mailchimp, Substack
- Buffer, Hootsuite, Later

### Daily check-in widgets (read-only)
- Stripe — today's MRR, new customers, disputes
- QuickBooks — invoiceable time, unpaid invoices

### Customer support (sync)
- Front, Help Scout, Zendesk, Intercom — convert conversations to tasks

### Email clients (one-way import or sync)
- HEY Email, Spark Email — convert emails to tasks

### Booking competitors (one-way import — switching is easy)
- Calendly, SavvyCal, Cal.com — bring event types and bookings over

### Communication / push targets (sync or read)
- Slack, Discord, Microsoft Teams — already on roadmap, see Slack app
- Telegram (bot API — international audience)
- Pushover (indie/dev "ping me when X" use case)
- ntfy (open-source, self-hosted push — homelab crowd)
- Matrix (privacy crowd) — added if anyone asks
- Mattermost / Rocket.Chat / Zulip — niche, defer

---

## Tier-3 candidates (skipped or revisit)

Discussed but not added. Add later if signup data shows demand.

**Add later (likely value):**
- AirTable as deeper sync (we have a stub)
- Personal finance daily widgets — YNAB, Monarch, Mint successors
- Analytics daily widgets — Plausible, Mixpanel, Amplitude, GA4

**Skip:**
- WhatsApp — Business API is approval-gated and metered; not free-tier friendly
- Signal — API is awkward (requires self-hosted bridge)
- Phone-call notifications — wrong category for productivity
- Recruiting/HR — Lever, Greenhouse, BambooHR (too narrow)
- Sales tools — Apollo, Outreach, Salesloft (CRM-adjacent, niche)
- Education — Canvas, Blackboard, Google Classroom (institutional)
- Health/medical — Epic MyChart, athenahealth (HIPAA burden)
- Smart home — Home Assistant, SmartThings (already covered by IFTTT)
- Splunk On-Call / PagerDuty / Opsgenie / VictorOps / PagerTree — incident
  management; wrong category for productivity tool
- Prometheus, Gotify, Pushbullet, Group integration — too niche or declining
- Trello "create card on alert" — wrong direction; we have Trello as a tasks adapter

---

## App-tab strategy

Top-level workspace tabs (Calendar / Tasks / Notes) are now reorderable
and individually hideable via Settings → Tabs. Cap is 3 visible at a
time. At least one must remain visible.

**The cap is forward-looking.** When integration-driven tabs become a
real ask, we lift the cap. Pref shape and the `getVisibleTabs(prefs)`
helper in `lib/stores/appView.svelte.js` already support arbitrary tab
ids — just append to `ALL_APP_TABS` and bump `MAX_VISIBLE_TABS`.

**Email tab — deferred, probably permanently.** Considered briefly. We
already have email-to-task as a *capture* surface (mail to your unique
inbox creates a task). A real email tab would be an inbox renderer —
roughly the size of the Tasks surface itself, and historically a
graveyard product (Outlook is the only one that worked; Superhuman
shipped a calendar feature in 2023 but it's not a moat for them either).

Better path: when Gmail integration ships, add a **Sidebar section**
showing today's important threads (read-only, click-to-open in user's
mail client). Context, not replacement. ~10× less work for ~80% of the
value.

## Strategic moats discussed

- **Integrations breadth is the moat.** Bear/Apple/Things native-only
  apps need a companion. We can ship as a web app that connects to
  everything. This is the bet.
- **Native standalone usability matters first.** Empty calendar/tasks
  on signup kills funnel. Native event/task/notes storage already in
  place via `events_native` / `tasks_native` / `projects_native`.
- **iOS app is 2-4 weeks out** per stable web baseline. Then iPadOS,
  Android, possibly Apple Watch (Android Watch is too niche).

---

## Conventions to preserve

- **Source abstraction**: every event/task/note has a `provider` column.
  `provider='native'` for app-created data; everything else is an adapter
  ID. See `docs/internal/integrations.md`.
- **Adapter shape**: must declare `provider, name, kind, category,
  status, mode, authType, description, docsUrl, recommended`. Stubs use
  `_stub.js#makeStub()` to fill these uniformly.
- **Tokens encrypted at rest** when `ENCRYPTION_KEY` env is set
  (AES-256-GCM via `lib/cryptoBox.js`). Lazy-migration: existing
  plaintext rows stay readable, next write re-encrypts.
- **Background sync** runs every 5 min, picks rows where
  `last_synced_at > 15 min`, calls `adapter.syncTasks(userId)` /
  `syncEvents(userId)` with 60s timeout per call.
- **Don't break /api/v1.** It's the seam every external integration
  hits. Versioned, OpenAPI-spec'd, rate-limited persisted in SQLite.
