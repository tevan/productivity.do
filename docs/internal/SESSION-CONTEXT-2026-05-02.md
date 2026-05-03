# Session context — 2026-05-02 (multi-day session, cleared 2026-05-02)

This is the breadcrumb for future-you. The session ran multiple days and
covered a lot of strategic + implementation ground. Read this first to
recover context fast, then dive into the specific docs called out.

## What shipped (in commit order)

Recent commits, oldest to newest:

1. `038b81c feat: synthesis layer` — `/api/today`, `/api/weekly-review`,
   `/api/observations` + `TodayPanel.svelte` (`Y` shortcut). Three
   deterministic surfaces. See `synthesis-layer.md`.
2. `898724c ux: serif display face, soft modal entrance` — Fraunces +
   modal pattern + notes polish.
3. `7dc09f7 ux: tighten Today panel` — split overdue/today, hero+support,
   hover-float actions.
4. `c7cfbea feat: pillar stakes` — Estimation Intelligence, Time Ledger,
   Live Context Panel. **NOTE: demoted from "the moat" later in session
   to "interesting features."** See "What changed strategically" below.
5. `019c23c strategy: productivity-surface doc` — first version of the
   strategic anchor; ledger filter to active calendars + sort by usage.
6. `291c068 feat: every activity row is clickable; deleted-record viewer`
   — activity bell becomes navigation; tombstones for deleted records.
7. `e59253c strategy: workflow-files + opinionated-automations as ideas`
   — added to strategy doc as ideas under consideration.
8. `f21b003 strategy: future-proofing section` — three disruption forces
   (agentic, voice, search-collapse) + how investments hold up.
9. `e8d38b0 strategy: voice as #3 load-bearing investment` — Mem's
   pivot, Otter cautionary tale, project metadata as priority signal.
10. `3d75df5 feat: projects as first-class (Tier A)` — `project_meta`
    table, ranker, project page, sidebar, MCP project-context tools.
11. `6c8a80d feat: voice capture (Tier C) + weekly review references
    project intent (Tier B7)`.
12. `f74cfae feat: extend MCP tool surface with project + decisions (C5)
    + weekly-review string bug fix`.
13. `55bd22c docs: mark projects-as-first-class build complete`.

## Then we did Perplexity research

User wanted future-of-space research. The single Perplexity prompt kept
timing out. Iteratively split:
- 1 prompt → 3 → 5 → 8 (final).
- 8 separate `.md` files in `docs/internal/perplexity-future-research-prompt-*.md`.
- Each was run in a separate Perplexity session.
- 9 response `.md` files came back (at one point, the 7-file plan also
  carried two earlier-completed responses).
- Consolidated into `perplexity-future-research-response.md`
  (~3,100 lines, 327KB, 8 sections).

Then user said: "go ahead pls. take your time, going for world-class,
whatever it is that we make."

## Synthesis output (the most important thing in this whole session)

**`docs/internal/perplexity-research-synthesis.md`** — the synthesis. It
identifies:

### Three direction changes
1. **MCP needs workflow-named tools, not CRUD wrappers.** Highest-leverage
   finding. Add `plan_today`, `triage_inbox`, `summarize_project`,
   (v2 `rebalance_week`). ~1 week of work that wraps existing pure
   functions.
2. **Voice = capture + confirm.** Endorses existing `VoiceCapture.svelte`
   flow. Don't expand voice to multi-step orchestration. Push-to-talk
   only. Indefinite.
3. **Skip CRDT-based sync.** Our offline mode is the right amount of
   local-first. If multi-user shared workspaces become a wedge, adopt
   Replicache/ElectricSQL over rolling our own CRDT layer.

### Two confirmations
- Destination apps with agent-readable APIs win (60-70% likely vs. pure
  dissolution into chat).
- Time-to-close beats engagement-maxxing as the right metric.

### Three deliberate ignores
- Spatial/Vision Pro/Quest productivity (5+ years out).
- Decentralized identity (ENS/Lens/AT Protocol — niche in productivity).
- Generative UI as a market force (we use it as a tool, not a moat
  threat).

## Strategy doc edits (applied this session)

Three small additions to `productivity-surface-strategy.md`:

1. Voice section — added a paragraph that explicitly says future
   iterations expanding voice to multi-step orchestration should be
   rejected, with the failure-mode evidence cited.
2. Future-proofing section — added "MCP workflow tools" as a
   parallel investment track. Gates agentic-shift readiness on
   workflow-named MCP, not just having an MCP.
3. New "What we won't chase" section — locks in the ignore list with
   reasoning so it doesn't get relitigated without new info.

## What changed strategically across this session

The arc:

1. **Started:** synthesis layer + pillar stakes (Estimation Intelligence,
   Time Ledger, Live Context Panel) was "the moat."
2. **User pushback:** "I'm struggling to see how insights are useful for
   people. people use their calendar and tasks in different ways."
3. **Pivot:** moat is now three load-bearing investments (files unified,
   "what should I do right now" surface, cross-pillar timeline). Pillar
   stakes demoted to "interesting features."
4. **Voice added** as the third load-bearing investment after observing
   Mem leading with Voice Mode + Granola disrupting Otter.
5. **Projects as first-class** built end-to-end while user was AFK
   (Tiers A + B + C, all three).
6. **Perplexity research** validates the three-investment shape, but
   adds a fourth track (MCP workflow tools) and clarifies what NOT to
   chase.

The strategy doc (`productivity-surface-strategy.md`) is the single
source of truth. The synthesis (`perplexity-research-synthesis.md`)
explains *why* the doc says what it says. Read both.

## Concrete next steps (when ready to build)

Build order, post-contrarian-reorder (2026-05-02 evening):

1. **Files done well** (4-6 weeks). Substrate; everything else
   compounds with it.
2. **MCP workflow tools** (~1 week, parallel-able with files).
   The highest-leverage agent-distribution play. Promoted ahead of
   the timeline after steelmanning the contrarian position. See
   `claude-perplexity-future-of-productivity-contrarian.md`.
   - `plan_today` — wraps `backend/lib/ranker.js`. Returns ranked
     decisions + score breakdowns + explanations.
   - `triage_inbox` — wraps `/api/voice/route` classifier. Free-text
     in, classified resource + confidence + slot suggestion out.
   - `summarize_project` — wraps `getProjectMomentum` +
     `/api/projects/:id/context`. Outputs momentum + intent + open
     tasks + recent activity + due-date countdown.
   - `rebalance_week` (v2 — pure function over events + tasks + focus
     blocks; returns proposed reschedule diff).
3. **"What should I do right now" surface** (2-3 weeks). UI uses the
   *same* ranker the `plan_today` MCP tool exposes — UI and agent
   surface read from one source.
4. **Cross-pillar timeline** (3-4 weeks).

Each MCP tool gets:
- Workflow-named (verb-driven), not table-named.
- Stable input/output schemas.
- Listed in `GET /api/v1/openapi.json`.
- Documented at `/help/api/mcp-workflows`.

## Files to read first when resuming

In this order:

1. `docs/internal/SESSION-CONTEXT-2026-05-02.md` (this file)
2. `docs/internal/productivity-surface-strategy.md` (~600 lines, the
   anchor)
3. `docs/internal/perplexity-research-synthesis.md` (~250 lines, the
   "why" behind recent strategy edits)
4. The relevant memory entries (auto-loaded — see `MEMORY.md`)

Skip on first pass:
- `perplexity-future-research-response.md` (3,100 lines, raw input to
  the synthesis — the synthesis IS the takeaway)
- `perplexity-future-research-prompt-*.md` (the 8 prompt files —
  historical artifacts from the splitting exercise)
- `pillar-stakes` and `synthesis-layer.md` (superseded by the
  productivity-surface strategy)

## Memory entries added/updated this session

- `synthesis_layer.md` — three deterministic surfaces.
- `synthesis_design.md` — side panel, Fraunces, soft scrim, late-task
  auto-move.
- `pillar_stakes.md` — original moat plan (now superseded).
- `productivity_surface_strategy.md` — the supersession.
- `mcp_workflow_tools.md` — discipline added today; CRUD parity loses
  to workflow uniqueness.
- `silent_save_failures.md` — modals branch on save result before
  close.
- `activity_trash_undo.md` — activity log + trash + restore-via-trash
  undo pattern.

## Things deliberately left undone

- Removing the `perplexity-future-research-prompt-*.md` files. Kept
  for historical reference; they're cheap to keep and might be useful
  if we re-research.
- Implementing the MCP workflow tools. Queued in the strategy doc;
  not started.
- Moving `perplexity-future-research-response.md` somewhere else.
  It's 327KB but harmless; gitignored locations would lose the
  reference. Stays in `docs/internal/` until/unless we need to clean
  up.

## Invariants future-you should preserve

These are not negotiable absent strong new evidence:

1. **Voice is push-to-talk + preview-and-confirm.** Always-on /
   wake-word / direct-commit are documented failure modes.
2. **MCP tools should be workflow-named, not CRUD-named.** Existing
   CRUD tools stay (direct manipulation), but new tool design is
   workflow-first.
3. **No CRDT-based sync. No Notion-style block universe. No custom
   databases / formulas / per-project metadata fields.** Each is the
   slope toward a contested market we lose on.
4. **Time-to-close beats engagement.** Don't surface time-spent
   metrics. Don't make Today a feed.
5. **Every UI feature ships with the corresponding API + webhook
   event + (when applicable) MCP workflow tool.**
