# The decision-surface pattern

**Date:** 2026-05-02
**Status:** Pattern recognition; productivity.do is the first execution.

The deeper claim under our strategy isn't "build a productivity app."
It's a recognizable pattern that applies to many verticals. This doc
captures the pattern, why productivity is the right first slot, what
the natural follow-ons are if it works, and what's NOT a candidate.

This is not novel thinking — Linear's founders have written about
it, a16z's "agent-native vertical winners" thesis is similar, and
Glean / Granola / productivity.do are three implementations of the
same shape. Documenting it for clarity, not because we invented it.

## The shape

Strip the domain out and our strategy reads:

> Be the structured surface where humans (or agents acting on their
> behalf) make decisions in domain X, and expose those decisions
> cleanly to AI assistants.

Three ingredients, all required:

1. **Specific domain with real data and constraints.** Not generic
   chat. Not "everything." A vertical with state, deadlines, and
   recurring decision-points.
2. **Deterministic decision engine.** Compresses domain state into a
   recommended next action. Auditable, explainable in one sentence,
   no ML at the decision moment.
3. **Agent-readable interface.** Workflow-named MCP tools (or
   equivalent protocol) so AI assistants reach *into* the system
   instead of replacing it.

When the three ingredients land together, the result is:
- The user gets a clear answer in one click.
- The AI assistant has an authoritative source to call.
- The system compounds with use, but doesn't depend on the user
  learning new behaviors.

## Why productivity was the right first slot

Productivity hits the pattern's sweet spot:

- **High-frequency decisions.** Daily, sometimes hourly.
- **Structured state.** Calendar + tasks have schemas; no NLP
  required to model them.
- **Agent-relevant.** People ask AI about their day constantly.
- **Existing tools are commoditized.** Calendar, task list, notes
  = table stakes. Differentiation has to come from the decision
  layer, not the data layer.
- **Universal pain.** Everyone has too much to do.
- **Low activation energy for a solo founder.** No regulation, no
  enterprise sales motion, no licensing.

Other domains that hit similar marks (finance, health, CRM) have
higher friction — regulation, expertise, enterprise sales — and
were poor first slots for a solo team.

## Where the pattern applies (strong fit)

Each of these has the same three-ingredient shape. None executed
well yet by an AI-native team. Listed in rough order of probable
TAM x current openness:

- **Personal finance.** "What should I do with this paycheck?"
  Account balances + budgets + bills + goals → one ranked
  recommendation. Mint died, Copilot/Monarch are inheriting the
  category but neither is agent-native.
- **Health / fitness.** "What's my workout / meal / recovery today?"
  Calendar + recovery score + program + injury log → one
  prescription. WHOOP / Strava have data; nobody compresses it
  into a daily decision well.
- **Sales / CRM.** "Who should I reach out to next, and what should
  I say?" Pipeline + last-contact + role priority → one candidate,
  one suggested message. Salesforce is the Notion of this category
  (bloated, configurable, hated). Attio is the closest decision-
  surface play.
- **Recruiting.** Same shape as sales. Pipeline-shaped state,
  daily/weekly cadence, AI-friendly compression.
- **Customer support triage.** "Which ticket next?" Queue + SLA +
  complexity + agent skill → one ticket. Linear-for-support
  without the Notion bloat.
- **Cooking / meal planning.** "What should I cook tonight?"
  Pantry + dietary constraints + meals this week + time available →
  one recipe.
- **Learning.** "What should I study right now?" Course progress +
  spaced-repetition state + available time → next item.

## Where the pattern doesn't fit

Critical to know — these look adjacent but aren't:

- **Creative work** (writing, music, design). "What should I do
  next" is the wrong question; creators want a blank canvas, not a
  ranked list. Figma, Ableton, Notion-as-doc win on flexibility.
- **Browsing / discovery** (news, social, shopping). Users want
  serendipity, not a single answer. This is the recommendation-
  feed shape (algorithmic, exploratory), not the decision-surface
  shape (deterministic, compressive).
- **Real-time gaming / collaboration.** State changes faster than
  a compression layer can work.
- **Pure search.** Glean is the closest counterexample — it sells
  decision-flavored search ("what did Sara promise the customer?")
  but the product is retrieval, not commitment. Different shape.

## Implications for productivity.do

If the pattern is right and our execution works:

1. **Productivity is proof-of-shape, not the destination.** The
   value of nailing it isn't just the productivity TAM — it's the
   reusable infrastructure (MCP workflow tools, deterministic
   rankers, agent-readable schemas, provenance metadata).

2. **The natural follow-on is an adjacent vertical, not more
   productivity features.** Finance or health are the strongest
   candidates because the decision-paralysis profile is similar.

3. **Stay in our lane on this product.** The temptation to broaden
   ("add finance features," "add health tracking") destroys the
   pattern by confusing the domain. Each vertical needs its own
   surface, its own ranker, its own data model. The substrate is
   portable; the product isn't.

4. **The platform play, if there is one, is later.** A "decision-
   surface engine" that other founders use to build verticals is
   the obvious 5-year fantasy. It's wrong to pursue today —
   prematurely abstracting before any single vertical works is the
   classic platform trap. Build the productivity vertical first,
   prove the pattern, then evaluate.

## What this changes about our strategy

Nothing in the near term. The four load-bearing investments
(files-unified, MCP workflow tools, next-thing surface, cross-
pillar timeline) are all the productivity-vertical execution of
the pattern. They stand on their own merit.

Where this lens helps:

- **Hiring / collaborator framing.** When pitching the product to
  potential collaborators or advisors, the pattern-claim is more
  durable than the productivity-claim. "We're building the
  decision-surface pattern; productivity is our first vertical"
  reads as a thesis, not a feature list.
- **Investor framing if we ever raise.** Same.
- **Personal motivation.** When productivity feels small,
  remembering it's the proof-of-shape for a category-portable
  pattern keeps the work meaningful.
- **Anti-temptation lens.** When tempted to add features outside
  productivity (a finance tracker, a workout logger), this doc is
  the reminder that the right move is a separate vertical, not a
  bloated single product.

## What this is NOT

- Not a roadmap. We're building productivity, not 7 verticals.
- Not a fundraising pitch. It's a thinking tool, not a deck.
- Not novel. The pattern has been observed by others; we're naming
  it for ourselves.
- Not contingent on success. If productivity doesn't work, the
  pattern might still be right — different team, different
  vertical.
