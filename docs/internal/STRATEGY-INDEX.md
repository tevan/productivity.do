# Strategy index — read these first

This folder mixes strategic docs with feature notes. The strategic ones
are listed below in **priority order** with a one-line hook so you (or
a future collaborator, or a ChatGPT instance) can find the load-bearing
docs without scrolling through feature-implementation notes.

If you only have 10 minutes, read item 1.
If you have 30 minutes, read items 1-3.
If you're returning to this project after weeks away, read item 4 first
to recover context, then 1-3.

## Tier 1 — load-bearing strategy

1. **`productivity-surface-strategy.md`** — The strategic anchor.
   What we're building, what we're not, why, and the build order.
   Single source of truth for product decisions over the next 12
   months.

2. **`DEVELOPMENT-ROADMAP.md`** — The operational sequence from
   current state to charter validation. Realistic timelines
   (days, not weeks). Charter-user recruitment plan. What
   happens when signals land.

3. **`CONVERSATION-BRIEF-2026-05-02.md`** — Self-contained briefing
   for a smart conversation partner (e.g., ChatGPT in voice mode).
   Compresses the strategic anchor + supporting docs into one read,
   with risks, falsifiability checks, and probe questions.

4. **`perplexity-research-synthesis.md`** — Synthesis of the 8-part
   Perplexity future-of-space research (~3,100 lines distilled to
   ~250). Three direction changes, two confirmations, three
   deliberate ignores. Why we made the strategic moves we did.

## Tier 2 — supporting strategy

5. **`SESSION-CONTEXT-2026-05-02.md`** — Running session breadcrumb.
   Where we left off, what's queued, what changed strategically.
   Update this when ending a working session.

6. **`decision-surface-pattern.md`** — The pattern productivity.do
   is one execution of (generalizes to finance/health/CRM). Anti-
   feature-creep lens: when tempted to broaden, the right move is
   a separate vertical, not a bloated product.

7. **`end-state-vision.md`** — What the product looks like 12
   months out. Customer pitch (one-sentence, three-sentence, 60s
   demo). Distribution plan. 90-day winning check.

8. **`captured-signals.md`** — Concrete inventory of every
   structured signal the app captures (~20 today + what's coming).
   What's deliberately NOT captured (and why). Replaces the vague
   word "substrate" with a specific table.

9. **`ai-cost-architecture.md`** — When we use LLMs and when we
   don't. Decision moments are deterministic (pure SQL). LLMs only
   on three narrow paths. Rule for evaluating new AI features.
   AI cost = ~0.8% of revenue at 10K DAU.

## Tier 3 — tactical / archived

10. **`claude-perplexity-future-of-productivity-contrarian.md`** —
    Perplexity's contrarian steelman ("apps dissolve into agent
    surfaces"). Useful when re-evaluating whether to pivot toward
    pure-API. The synthesis already addressed it; kept for
    reference.

11. **`perplexity-future-research-response.md`** — The full 3,100-
    line consolidated Perplexity research. Don't read on first
    pass — the synthesis (item 4) is the takeaway. Kept as the
    underlying source so future-us can verify a citation.

12. **`perplexity-future-research-prompt-*.md`** (8 files) — The
    original prompts split into 8 parts to work around timeouts.
    Historical artifact. Not load-bearing.

## Feature notes (everything else in this folder)

The rest of `docs/internal/` is feature-implementation notes
(`booking-pages.md`, `integrations.md`, `tasks-board.md`, etc.) —
these document specific features and aren't strategic.

## How to update this index

When adding a new strategic doc:
- Decide which tier it belongs in (load-bearing? supporting? tactical?).
- Add a one-line hook (~150 chars).
- Insert in priority order within the tier.

When a strategic doc gets superseded:
- Move it to Tier 3 with a "superseded by X" note rather than deleting.
- Strategy history matters when re-evaluating decisions.
