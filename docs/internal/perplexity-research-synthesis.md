# Perplexity research — synthesis & strategic adjustments

**Date:** 2026-05-02
**Source:** `docs/internal/perplexity-future-research-response.md` (~3,100 lines, 8 parts)
**Reading time:** ~2 hours
**Purpose:** identify the 2–3 findings that should change direction, and codify what to ignore.

The research is dense. Most of it confirms our existing strategy. A handful
of findings genuinely change what we should be building. This document
captures the delta — what changes, what stays, and the load-bearing pieces
of evidence behind each adjustment.

## The three findings that change direction

### Finding #1 — MCP "skills" not CRUD is the real moat in an agent-first world

The research's strongest single recommendation. Anthropic's own engineering
guidance (Part 3a, footnote [^1] of the agents section) is that an MCP
server exposing `create_task`, `update_event`, `delete_note` is *worse*
than no MCP at all — agents struggle to plan over low-level CRUD, and the
context-window cost compounds with every call. Glean's success (Part 1c +
Part 3a, $100M ARR in 3 years, ~40% wDAU/MAU) is built on workflow-level
abstractions over enterprise data, not raw API access.

Evidence load:
- Anthropic's "code execution with MCP" paper recommends bundling
  multi-step operations into single tool calls.
- CrewAI (450M+ agents/month, 60% of US Fortune 500) explicitly designs
  around opinionated workflows, not raw integrations.
- Granola's MCP server lets agents *query meeting context* — semantically
  rich, not just transcript-CRUD.
- "Lessons from Anthropic" community guidance: small set of clear,
  workflow-named tools beats large surface every time.

What we have today: 6 MCP tools (`create_task`, `complete_task`,
`list_tasks`, `create_event`, `list_events`, `list_booking_pages`). Plus
`list_pinned_projects`, `set_project_pin`, `get_project_context` from the
projects-as-first-class build. These are CRUD wrappers.

**What changes:**

The voice/agent surface investment from the strategy doc is correct, but
needs a different MCP layer than what we have. We need to add (in this
order):

1. `plan_today` — given current calendar + tasks + project pins +
   estimation history, return a ranked decision list with explanations.
   *This is the ranker we already built, exposed as an MCP tool.*
2. `triage_inbox` — classify incoming items (voice transcript, email
   forward, raw text) into task/event/note/comment with confidence
   scores and slot suggestions. *Already implemented in `voice.js`'s
   `/api/voice/route` — needs MCP wrapping.*
3. `rebalance_week` — given a stale week (lots of unscheduled tasks,
   focus blocks not honored), propose a rescheduling diff. Needs a new
   pure function but reuses `findFreeSlots`.
4. `summarize_project` — given a project_id, return momentum + intent
   + open tasks + recent activity. *We have `getProjectMomentum` and
   `/api/projects/:id/context` — wrap as a tool.*

Each is one workflow, named the way an LLM would prompt for it. Each
returns rich structured data with stable IDs an agent can chain on. The
existing CRUD tools stay — they're useful for direct manipulation — but
they stop being the marketed surface. The marketing pitch is "workflows,
not endpoints."

**Why this matters:** when ChatGPT/Claude/Gemini route a productivity
intent, they choose the integration with the highest-leverage tools. If
our MCP exposes only `create_task`, an agent picks Todoist's MCP (which
also exposes `create_task`) by alphabetical or PageRank-style ordering.
If we expose `plan_today` and Todoist doesn't, the agent picks us
because the workflow is at our address.

### Finding #2 — voice is fast capture + confirm, not magic orchestration

The research is unambiguous (Part 3a closing recommendations + Part 3b):
voice usage skews heavily to short, well-bounded tasks. ~19% of ChatGPT
engagement is voice. Voice productivity *outside* OS assistants is mostly
"set a reminder," "what's on my calendar," "dictate a short message,"
"capture a thought." Multi-step orchestration via voice consistently
fails — over-narration, session instability, ambiguous commands.

Evidence load:
- ChatGPT voice = 19% of engagement; majority is still text.
- Limitless Pendant struggles with always-on use due to legal consent +
  social discomfort + unclear value outside meetings.
- Microsoft Recall paused, then re-shipped opt-in only after backlash.
- Gemini Live developers report needing client-side audio gating just
  to prevent the model from narrating every tool call.
- McKinsey/voice market data: ~52% use voice daily, but for short tasks
  (cooking, driving, dictation) — not for orchestration.

What this validates in our existing strategy:

- ✅ Build #1 ("voice on the decision surface") and Build #2 ("voice
  capture that routes to the right pillar") are exactly the use cases
  where voice works.
- ✅ Skipping Granola-shape meeting transcription is correct — that
  market is contested and the moat is the integration depth, which a
  solo founder can't outrun on the meeting-bot dimension.

What this *adjusts*:

- The voice UX must default to **preview-and-confirm**, not direct
  commit. When the user says "remind me to call Anne Tuesday," our flow
  is: transcribe → classify → show a preview card ("Task: Call Anne,
  due Tue 2026-05-05") → user confirms with one tap or "yes." Direct-
  commit has too many failure modes (homophones, ambiguous dates, wrong
  pillar) and erodes trust the moment one slip happens.
- Voice as **always-on listening** is a non-starter. Push-to-talk only.
  No background mic. No "wake word" for the foreseeable future. This
  isn't a privacy stance for marketing; it's the only mode that actually
  works given the failure data.

The current `VoiceCapture.svelte` flow already does preview-and-confirm.
This is correct. Don't let an "improvement" iteration delete it.

### Finding #3 — local-first is a hedge, not the moat. Sync engine choice matters more than CRDTs.

Part 5's "if I were starting today" recommendation explicitly says: *use a
relational core (Postgres/SQLite) with a server-of-record, an append-only
sync log à la Linear, and **avoid CRDTs initially**.* The research is
careful here — Ink & Switch's local-first principles are great, and Anytype
+ Logseq + Obsidian have shown there's a market — but full local-first is
operationally complex and not what mainstream users pay for. What they pay
for is reliable, low-friction sync, backup, and multi-device access.

Evidence load:
- Linear's architecture (50K+ paying customers, $1.25B valuation): one
  PostgreSQL primary + replicated to multiple regions + append-only
  `SyncAction` log. Not CRDTs.
- Anytype/Obsidian/Logseq's local-first commercial story is paid sync,
  not "your data lives only on your device."
- Ink & Switch's own writing (foundational local-first paper) admits
  full adherence to all 7 principles is operationally hard, and
  industrial CRDT adoption remains limited.
- PowerSync/Replicache/ElectricSQL are emerging as "local-first lite"
  middle paths — practical, but coupling to a specific engine is
  expensive to undo.

What this validates in our existing strategy:

- ✅ We already have the relational core (better-sqlite3 + WAL).
- ✅ We already have an offline mode (the IndexedDB write queue +
  service worker), which is the right amount of local-first for our
  audience.
- ✅ We chose last-writer-wins for offline replay — the research
  endorses this for productivity surfaces unless multi-user collab is
  the wedge.

What this *adjusts* (or rather, what it tells us NOT to chase):

- Do not invest in CRDT-based sync. The flywheel is not local-first;
  the flywheel is the workflow + the agent surface (Finding #1).
- Do not invest in a multi-device "true local-first" mode beyond the
  current offline support. The audience that values this is small and
  vocal but not where the moat compounds.
- If we ever expand sync (multi-user shared workspaces), prefer adopting
  a sync engine (Replicache, ElectricSQL, PowerSync) over rolling our
  own CRDT layer. Decoupling our domain model from the engine means we
  can swap engines if the choice ages badly.

This is a "stay in our lane" finding, not a build-something-new finding.
It's a budget protection — we're not going to spend 3 months on
CRDT-based sync because Hacker News thinks we should.

## Two findings that confirm but sharpen our strategy

### Confirmation #1 — destination apps win in productivity, but with agent-readability

Part 2b's stance ranking: 60-70% likely that "destination apps that are
agent-native dominate" vs. 30-40% pure dissolution into chat surfaces. The
load-bearing evidence:

- Users punish "AI wrappers" (Otter pre-pivot, Mem pre-pivot, Pi).
- Users reward AI + durable UX + structure (Notion, Linear, Granola).
- Linear at $1.25B valuation, profitable — explicit "AI as feature on
  top of opinionated UX," not "AI is the product."

This is exactly our existing strategy. We are a destination app
("productivity surface"), with agent-readable APIs (Finding #1), with
structured durable UX (calendar/tasks/notes pillars). The research
endorses our basic shape.

The sharpening is small: marketing copy should explicitly position us as
"the app where you and your agents converge," not "the AI productivity
app." The research data shows the second framing performs worse — it
gets pattern-matched to commodity AI wrappers and loses on commodity
pricing. The first framing positions us as durable + AI-augmented.

This is already aligned with the strategy doc's framing ("be the place
where someone or their agent makes the decision"). Keep it.

### Confirmation #2 — the right metric is time-to-close, not engagement

Part 1a + Part 1b reinforce something we already wrote down (memory
entry `time_to_close_metric.md`): productivity tools that maximize time-
in-app are losing to ones that minimize time-to-decision. Linear's
positioning ("zero ambient noise," "fast issue tracker") is the
canonical example — it explicitly markets *not being* a hangout. Cal.com,
Vimcal, Things, Bear all share this DNA.

Conversely, the apps under pressure (Notion's growth slowdown, Mem's
pivot) are ones that try to be the workspace you live in. Engagement-
maxxing fails when AI starts handling the busywork that drove
engagement.

This validates our two existing decisions:

- ✅ Don't surface a "time spent" badge in the daily summary. The
  research says engagement metrics are anti-product.
- ✅ The Today panel is designed as a "see-and-leave" surface, not a
  "stay-and-work" surface.

The sharpening: when we add the cross-pillar timeline (investment #3),
we should resist the temptation to make it look like a "your day in
review" engagement scroll. It's an audit trail, accessed when needed,
not a feed. Quiet, dense, instrumental.

## Three findings we ignore (deliberately)

### Ignore #1 — spatial / Vision Pro / Quest productivity

Part 4 spends pages on it. Real, but 5+ years out for the audience we'd
serve. Building a Vision Pro app would be 2-4 weeks of work that produces
no near-term revenue and competes with Fantastical for visionOS, which
already exists and works. If a charter user explicitly asks, we
reconsider. Until then, skip.

### Ignore #2 — decentralized identity (ENS, Lens, AT Protocol)

Part 4 acknowledges these are mature technically but niche in
productivity. No mainstream productivity app has adopted them. Email +
OAuth is the practical state of the world. If federation becomes the
norm in 3 years, we add it then. Today it's a distraction.

### Ignore #3 — generative UI (v0, Galileo)

Part 4 frames generative UI as eroding "UI as a moat." This is true at
the level of "make me a calendar layout in 5 prompts." But our moat is
not the UI — it's the data model + workflow + agent surface (Findings
#1, #2). Generative UI is a tool we already use (Claude generates Svelte
components for us); not a market force we need to defend against.

## What this means for the next 4–6 weeks

The three load-bearing investments in `productivity-surface-strategy.md`
remain correct: files-done-well, "what should I do right now" surface,
cross-pillar timeline. **The order changes.**

After steelmanning the contrarian position (see
`claude-perplexity-future-of-productivity-contrarian.md`), MCP workflow
tools get promoted from "parallel track" to **second priority — ahead of
the cross-pillar timeline**. Reasoning: the contrarian's strongest demand
is that the agent-distribution surface is closer to a moat than any
human-facing UI we ship, because agents pick which MCP server to route
an intent to based on workflow uniqueness. Granting this is cheap (the
work is naming + schema + docs over existing pure functions) and aligns
with the both/and shape (destination app + workflow MCP) that survives
both backend-arbitrage AND agent-routing scenarios.

Final order:

1. Files-done-well (substrate).
2. **MCP workflow tools** (~1 week, parallel-able with files).
3. "What should I do right now" surface (uses the same ranker the
   `plan_today` MCP tool exposes — UI and agent surface read from one
   source).
4. Cross-pillar timeline.

**The MCP workflow tools deliverable:**

1. Wrap `rankTasks` (`backend/lib/ranker.js`) as MCP tool `plan_today`.
   Returns the ranked decision list with score breakdowns + explanations.
2. Wrap `/api/voice/route`'s classifier as MCP tool `triage_inbox`.
   Inputs: free-text item. Outputs: classified resource + confidence +
   suggested time-slot.
3. Wrap `getProjectMomentum` + `/api/projects/:id/context` as MCP tool
   `summarize_project`. Inputs: project_id (or name). Outputs: momentum,
   intent line, open tasks, recent activity, due-date countdown.
4. Add `rebalance_week` — pure function over events + tasks + focus
   blocks, returns a proposed reschedule diff. Save for v2 if scope
   tightens.

Each tool gets:
- A clear human-readable description.
- Explicit input/output schemas.
- Workflow naming (verb-driven), not table naming.
- Returned in `GET /api/v1/openapi.json`.
- Documented at `/help/api/mcp-workflows`.

This is the "stop being a CRUD MCP" investment. ~1 week of work, but it
might be the single highest-leverage thing on the roadmap because it
makes us the *first-pick* MCP for any agentic intent in our category.

## What this changes about the existing strategy doc

Three small edits to `productivity-surface-strategy.md`:

1. The "Voice — the third load-bearing investment" section already
   captures Finding #2's preview-and-confirm pattern correctly. Add
   one paragraph noting that **Build #1 and Build #2 are correct
   precisely because they're the use cases where voice works** — so a
   future iteration that wants to expand voice to multi-step
   orchestration should be rejected.

2. The "Future-proofing" section's "How our three investments hold up"
   list should be updated: agentic-shift readiness is *not* automatic
   from having an MCP — it's gated on having workflow-named MCP tools
   (Finding #1). We should add a fourth investment line item:
   **MCP workflow tools** as a discipline applied to every shipped
   feature, like the API/webhook discipline already noted.

3. Add a new section "What we won't chase" listing the three "ignore"
   findings (spatial, decentralized identity, generative UI) so future-
   us doesn't relitigate them.

I'll apply these edits next.

## What this changes about the existing memory

One memory entry should be added:

**`mcp_workflow_tools.md`** — codifying the discipline. Workflow tools >
CRUD tools. Each new feature should ask "what's the MCP-shaped name for
this?" and ship the workflow-level tool alongside the route. Reference:
this synthesis doc, Anthropic's MCP guidance, and Glean's hybrid-search
architecture.

No memory entries need to be removed or contradicted. The research
endorses the existing memory.

## Confidence

I'm ~80% confident on Finding #1 (MCP workflows). The evidence is broad
and converges from multiple angles (Anthropic, Glean, CrewAI, Granola).

I'm ~95% confident on Finding #2 (voice = capture + confirm). The
evidence is overwhelming and matches our existing implementation.

I'm ~75% confident on Finding #3 (skip CRDT). The research is clear that
CRDTs are not where the moat is, but I'm leaving 25% for "we end up
needing multi-user shared workspaces in 12 months and the right answer
might shift."

The ignore list is high confidence (~90%) — these are clear
distractions for our scope.

## Things the research might be wrong about (the meta-skepticism layer)

The research is Perplexity-generated, and it has biases:

- **Recency bias.** It cites 2025-2026 sources heavily and
  extrapolates linearly. The MCP boom is real today; whether it's
  durable in 3 years is unclear. Mitigation: build MCP workflows but
  don't over-invest in MCP-specific tooling that wouldn't translate
  to a successor protocol.
- **VC-narrative bias.** "Granola at $1.5B" and "Glean at $100M ARR"
  numbers come from press releases. Real revenue, churn, and gross
  margin are often much messier. Mitigation: treat these as
  directional, not as "this is what works at our scale."
- **Underweights the failure modes.** When the research says
  "destination apps win," it's based on the survivors. Survivor bias
  is real here — we're seeing Linear and Notion, not the 50 task
  apps that died in the same window. Mitigation: this is why moat
  thinking matters; we need defensible properties, not just shipping.
- **The future-of-OS-assistants prediction is genuinely unknowable.**
  Apple Intelligence might never matter. Gemini might consolidate
  Android. Both might fail to replace dedicated apps. We don't know.
  Mitigation: design for protocols (MCP), not platforms.

## Action items

Concretely:

1. ✅ Update `productivity-surface-strategy.md` with the three small
   edits noted above. *(next step)*
2. ✅ Add `mcp_workflow_tools.md` memory entry. *(next step)*
3. ✅ Add an "MCP workflow tools" track to the implementation roadmap
   in the strategy doc. *(next step)*
4. ⏳ Implement `plan_today` MCP tool. *(future)*
5. ⏳ Implement `triage_inbox` MCP tool. *(future)*
6. ⏳ Implement `summarize_project` MCP tool. *(future)*
7. ⏳ Document workflow MCP tools at `/help/api/mcp-workflows`. *(future)*

The "future" items are queued, not started. The doc/memory updates are
the immediate next step so we don't lose the synthesis context.
