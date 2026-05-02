# Community + integrations strategy

> Authored 2026-05-02. Captures decisions about which integrations to ship
> day-one, how to capture demand for the rest without committing publicly,
> and how to handle (or defer) community surfaces — forums, Discord,
> subreddit, GitHub Discussions, in-app feedback.
>
> **Status: thinking-document.** Some pieces are decided (day-one
> shortlist, no-public-voting, no-subreddit). Others are explicitly
> deferred. Update this file as decisions land rather than starting fresh.

## Day-one integration shortlist

The marketplace today has 102 adapter cards across 16 categories — most
are stubs marked "Coming soon." Cards advertise breadth without
committing to maintenance. That's been deliberate. For public launch
we need to decide which are *real, day-one, supported* and which stay
honestly labeled as not-yet-built.

The criterion: **users who land on the marketplace expecting the
calendar+task+note tool to "really" connect to the apps they already
use should find the apps they already use here, fully working.**

### The 12 (decided 2026-05-02)

| # | Adapter | Status | Notes |
|---|---|---|---|
| 1 | Google Calendar | ✅ shipped | core read/write, OAuth, two-way sync |
| 2 | Google Tasks | ✅ shipped | adapter present |
| 3 | Todoist | ✅ shipped | primary task backend; per-user PAT |
| 4 | Notion | ✅ shipped (real impl) | elevate in marketplace |
| 5 | Linear | ✅ shipped (real impl) | elevate in marketplace |
| 6 | Trello | ✅ shipped (real impl) | elevate in marketplace |
| 7 | Microsoft 365 Calendar | ✅ shipped (real impl) | elevate in marketplace |
| 8 | Microsoft To Do | ✅ shipped (real impl) | elevate in marketplace |
| 9 | Apple Calendar (CalDAV) | ✅ shipped (read-only) | UI label "Apple Calendar"; CalDAV in tooltip — most users don't recognize the protocol name |
| 10 | Slack | 🟡 partially shipped | slash command + workspace install present; finish + IT-approval friction note in card |
| 11 | Google Meet | ⏳ TODO | booking pages need meeting-link auto-attach |
| 12 | Zoom | ⏳ TODO | booking pages need meeting-link auto-attach |

**Everything else (~90 adapters) stays as "Coming soon" stubs** with
silent interest-click tracking (see [Interest tracking](#interest-tracking-instead-of-voting)).

### Notable deferrals

These came up in the strategy conversation as candidates for day one,
but were deferred with rationale:

- **Microsoft Teams** — substantially more painful to ship than Slack
  (manifest XML, App Studio, ISV verification, AppSource submission).
  Most Teams users hit IT-approval walls just like corporate Slack
  users. The individual-productivity surface for Microsoft users is
  already served by M365 Calendar + MS To Do adapters; the
  team-chat surface (Teams) is a different beast. Defer until 2+
  charter users request it.
- **Discord (as integration, not community)** — the Discord-using
  audience (solopreneurs, indie devs, creators) is also the audience
  most comfortable installing the app directly. We don't get
  meaningful reach by adding Discord that we don't already get.
- **Asana, ClickUp, Jira** — large surfaces, low individual-user
  penetration in our target audience. Stay as stubs.
- **Zapier / Make / n8n / IFTTT / Pipedream / Workato / Activepieces** —
  these are already on the developer-platform integration scaffold
  list (see `docs/integrations/`). Day-one we point users to our
  public API + webhooks rather than maintaining 7 first-party adapters.

## Slack vs Discord vs Teams: audience analysis

Captured because this came up in the strategy conversation and informs
multiple decisions (which integrations day one, which community
surface, future prioritization).

### Slack users

- **Personal/small-team Slack:** installs work fine. High fit for
  solopreneurs, small consultancies, indie startups.
- **Corporate Slack:** users will hit the "needs admin approval"
  wall. Admins say no by default for productivity tools that pipe
  data to third parties not on the vendor list. The user *knows*
  they're piping company-meeting metadata out, and that's cultural
  friction even when the install technically works.
- **Failure mode:** install proceeds → low usage → "this integration
  is broken." The admin gate is invisible to us; we just see a churn
  signal.

**Mitigation:** the marketplace card should explicitly say
*"Personal/small-team Slack workspaces install instantly. Corporate
workspaces may require admin approval."* Surface the friction honestly
instead of letting users discover it post-install.

### Discord users

Three sub-audiences with different fits:
1. **Solopreneurs / freelancers / indie devs** — Discord is their
   *only* chat tool. High fit for us.
2. **Communities (creators, gaming, open-source, Web3)** where work
   happens in Discord servers. Medium-to-high fit.
3. **Personal-only Discord users** — keep work and social separate.
   They don't want booking confirmations cross-posted. Low fit.

### Teams users

- Demographic = enterprise, salary-employed. The budget segment for
  Pro/Team plans.
- Higher IT-approval barrier than Slack.
- Teams app development is roughly 3-4× the surface area of Slack and
  5-10× the docs-reading. AppSource submission takes weeks.

### Audience leaning for productivity.do specifically

Adjacent-tool patterns:

| Tool | Audience |
|---|---|
| Cron / Notion Calendar | Slack-heavy |
| Akiflow / Sunsama | Slack-heavy |
| Raycast | Split — power users of both, Discord-leaning |
| Linear | Slack-dominant |
| Obsidian / Roam | Discord-dominant |

Our audience (keyboard-driven planners — solo professionals,
consultants, devs, designers, makers) is **Slack-leaning for the
salary-employed slice** and **Discord-leaning for the freelancer/indie
slice**. Not clean.

**Asymmetry that matters:** if Slack integration breaks for a corp
user, the user thinks WE are broken. If Discord doesn't exist for a
Slack user, the user thinks "not for me" and moves on. So Slack-day-1
is higher-leverage than Discord-day-1, even if engagement-per-user is
lower.

## Interest tracking instead of voting

The user raised: should we let users vote on integrations and features
for buy-in?

### For voting

- Cagan / *Inspired*: get user signal before building.
- Notion, Linear, Raycast all run public roadmap voters and their
  communities trust them more for it.
- Solves the "which 3 of 102 adapters to deepen" problem with real
  signal rather than founder guessing.

### Against voting

1. **Voters aren't your customers.** Loudest voters skew power-user.
   Mass-market needs go unrepresented. Pink's *When* peak/trough
   point applies socially: the median user isn't the median voter.
2. **Voting becomes commitment.** Once "Slack — 47 votes" is on a
   public board, you're on the hook. Hooked-agent's lesson: explicit
   promises to users are *investment* mechanisms; breaking them
   costs trust faster than never having promised.
3. **The 102-stub strategy already does this implicitly.** Clicks on
   "Coming soon" tiles ARE votes. We can capture them without the
   public commitment.

### Decision: silent click-tracking on stub adapters, admin-only ranking

- Schema: `interest_clicks(adapter_id TEXT NOT NULL, user_id INTEGER,
  day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1, PRIMARY KEY
  (adapter_id, user_id, day))`. One row per user-adapter-day, count
  bumps if the same user clicks a stub multiple times in a day (rough
  rate-limit + deduplication).
- Surface: an "Interested?" button on each Coming-soon card. On click,
  show a tiny toast ("Got it — we'll keep you posted") and POST to
  `/api/integrations/:adapter/interest`. Anonymized in admin view
  (we record user_id but the admin dashboard shows aggregate counts).
- Admin view: a new section on `/admin/metrics` showing top-20
  most-clicked stubs over the last 30 days, with a delta vs prior 30.
- **No public scoreboard.** Users see breadth (102 cards) and a way
  to express interest, but never see "Slack has 47 votes ahead of
  Discord." We avoid the public-commitment trap.

### When to revisit public voting

If we hit 500 paying users AND we want the community-engagement
benefit (Notion-roadmap-style), shipping a public board becomes
worth it. Until then, silent signal is enough.

## Community surfaces (forum, Discord, subreddit)

Captured options with recommendations and rationale.

### Option 1 — GitHub Discussions

- **For:** free, hosted, indexed by Google, technical-audience-fit
  (we have a public dev API + MCP server). Low moderation overhead
  because GitHub's community norms are already strong.
- **Against:** technical-audience bias might exclude non-developer
  users.
- **Status:** documented, not enabled.

### Option 2 — Discord (community, not integration)

- **For:** high engagement, real-time, fits the indie/maker
  audience.
- **Against:** founder time-sink (people expect responses), not
  search-indexed, becomes a moderation queue if it grows.
- **Note:** the user has expressed reservations about Discord — not
  yet sold. Defer.
- **Sub-option:** a *private* Discord channel for the 6-10 charter
  users (per Cagan's charter-user recruitment) is different from a
  public Discord and worth considering separately. Invite-only inner
  circle, not a public-community surface.

### Option 3 — Subreddit

- **For:** discoverability, organic growth potential.
- **Against:** risk-asymmetric. Ghost town signals no traction. Active
  without founder presence skews to complaints/venting. Reddit's
  cultural default is critique, not camaraderie.
- **Decision:** **don't claim r/productivitydo, don't engage.** If
  users start one organically, that's their space — engage there as
  a guest if useful, but don't seed it ourselves.

### Option 4 — Discourse (self-hosted or hosted)

- **For:** classic SaaS choice (Stripe, Cloudflare, Notion). Excellent
  for support + feature discussion.
- **Against:** real ops investment, content-moderation queue.
- **Status:** defer indefinitely. Revisit if/when GitHub Discussions
  feels strained at ~500 users.

### Option 5 — In-app feedback widget

- **For:** lower-friction than a forum, captures private feedback
  that shouldn't be public, no community-management overhead.
- **Against:** doesn't build community.
- **Status:** ship-able quickly (~1hr work) — modal + endpoint +
  Postmark email or webhook. Worth doing day-one.

### Decision (2026-05-02)

User isn't yet sold on Discord OR GitHub Discussions. Documenting all
options here for future revisit. Day-one community surface decision is
**defer everything except potentially the in-app feedback widget**.

When we revisit, the key question is: *can the founder commit to ~30
min/day of presence in the chosen surface for the first 6 months?*
- Yes → forums become a moat.
- No → forums become a tinderbox.

## Decision filters

For future decisions about new integrations or community surfaces.

### Adding a new integration

Promote a stub to a real adapter only when ALL of these are true:
1. **At least one charter user has explicitly requested it** (not
   inferred from a click).
2. **The integration's value is felt within the user's first week**
   (not a "nice-to-have they'll use eventually").
3. **Adapter implementation is < 2 weeks of work** (otherwise it's a
   strategic bet, not a tactical add — different decision-making
   process).
4. **The adapter has a clear maintenance owner** (us, until we have
   a team — limits how many we can keep alive).

If only some are true, leave as a stub with interest tracking.

### Adding a community surface

Ship a community surface only when ALL of these are true:
1. **We can commit ~30 min/day of founder presence for 6 months.**
2. **There's a specific question we want the surface to answer**
   (support? feature requests? showcase? troubleshooting?). Don't
   ship a generic forum.
3. **It complements rather than fragments** existing channels (don't
   ship Discord *and* Discourse *and* GitHub Discussions
   simultaneously — pick one).
4. **There's a charter-user inner circle separately** for high-trust
   feedback. Public surfaces are not for raw founder-user dialogue.

### Adding a public scoreboard / vote

Don't, until 500+ paying users. Silent signal is enough until the
community-buy-in benefit outweighs the public-commitment cost.

## What's already in place vs what needs building

**In place:**
- 102 marketplace cards across 16 categories
- 9 of the day-one 12 already real adapters (need elevation in UI)
- Slack slash command + workspace install (need to finish + add IT
  friction note)

**Needs building for day-one launch:**
1. Google Meet adapter — booking-page meeting-link integration
2. Zoom adapter — same
3. Apple Calendar UI rename (CalDAV in tooltip)
4. Slack marketplace-card copy update (IT-approval friction note)
5. `interest_clicks` schema + Coming-soon-card "Interested?" button +
   `/api/integrations/:adapter/interest` endpoint + `/admin/metrics`
   ranked-stubs section
6. (Optional, low-effort) In-app feedback widget — modal + endpoint +
   Postmark/webhook

**Explicitly NOT day-one:**
- Microsoft Teams integration
- Discord integration
- Public voting / roadmap board
- Subreddit
- GitHub Discussions (not yet decided)
- Discord community server (not yet decided)
- Discourse forum

## Decisions captured 2026-05-02 (round 2)

After the strategy review, three decisions changed the day-one shape:

### 1. In-app feedback widget — DAY ONE ✅

A small modal accessible from the SPA (footer link or `?` shortcut)
posting to a backend endpoint that emails the founder via Postmark.
Captures private feedback without committing to a community surface.

### 2. Charter-user recruitment — TODO INDEFINITELY 🟡

Acknowledged as important per Cagan / *Inspired*, but explicitly not
a priority for day-one launch. Stays in `applicable_insights.md` as
a Pending action; will get done when it gets done. Not blocking
public launch, not blocking community-surface decisions.

### 3. Hide unimplemented integrations from users — DAY ONE ✅

**This reverses the breadth-as-marketing strategy.** The marketplace
will show ONLY the 12 day-one real adapters. Stubs are removed from
the user-facing UI. Admin still sees the full 102-card catalog in an
admin panel for internal reference (which adapters exist as scaffolds,
which categories they fall under, etc.).

**Why the reversal:** "promising something is not as effective as
having it." Showing 102 cards with 90 marked "Coming soon" reads as
*advertising aspirations*, not *advertising capability*. Users who
need an integration we don't have should discover that absence cleanly
("oh, they don't do Asana") instead of being teased ("Asana — Coming
soon, click to express interest").

This is closer to the "day surface" product philosophy in
`docs/internal/product-philosophy.md`: be opinionated about what we DO,
not about what we MIGHT do.

**Consequences:**
- The `interest_clicks` table proposed earlier is no longer needed.
  Without stubs visible to users, there's nothing to click.
- Admin demand-tracking shifts to a different signal — once charter
  users exist, *direct conversation* is the source. Until then, we
  guess.
- The 102 stub adapters in `backend/integrations/` stay in the code
  (they're cheap, and useful for the admin catalog) but lose their
  user-facing manifestation.
- Coming-soon labeling design questions are moot.

### Updated needs-building list (day-one)

Shipped 2026-05-02:
1. ✅ **Hide non-shipped adapters from `/integrations`** — `GET /api/integrations` now filters to `status: stable | beta` only. The frontend `IntegrationsTab.svelte` had its `coming_soon` filter option + status confusion removed.
2. ✅ **Admin catalog page** — `/admin/integrations` (SPA route) backed by `GET /api/admin/integrations`. Full 102-row table, status filters (all/stable/beta/coming_soon/deprecated), search, grouped by category. User-visible rows highlighted.
7. ✅ **In-app feedback widget** — `FeedbackModal.svelte`, `POST /api/feedback`, `GET /api/admin/feedback`, `feedback_submissions` table, opened from Settings → Help → "Send feedback".

Still TODO:
3. **Google Meet adapter** (booking-page meeting-link integration)
4. **Zoom adapter** (same)
5. **Apple Calendar UI rename** (CalDAV in tooltip only)
6. **Slack marketplace-card copy update** (IT-approval friction note)

### Explicitly removed from the build list

- `interest_clicks` schema + handler + admin ranking — no longer
  needed (no stubs visible to users to click on).
- "Interested?" button on Coming-soon cards — no Coming-soon cards.
- Stronger visual treatment for Coming-soon labeling — no
  Coming-soon items.

## Resolved by these decisions

- ✅ In-app feedback widget shipping decision
- ✅ Charter-user list deferral
- ✅ Coming-soon labeling design question (moot — no labels)
- ✅ Whether to public-vote on integrations (no — and now we don't
  even need the silent-tracking fallback)
