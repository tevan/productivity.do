# productivity.do — end-state vision and customer story

**Date:** 2026-05-02
**Status:** What we're building toward (12-month horizon) and how we'd
explain it to a customer today.

This is not the marketing site copy. It's the source-of-truth for the
*shape* of the end state, written so we can derive customer-facing copy,
demo scripts, investor framing, and feature decisions from one document
without each one drifting from the others.

## The end state, described

A user opens productivity.do (or has ChatGPT/Claude/Siri open it for
them via voice). They see one screen.

The screen shows **the next thing they should do**, in plain language:

> **Right now: prep for the 2pm sync with Anne.**
> You have 50 minutes free. Sara sent the spec doc Tuesday — it's
> attached. Three open questions in your notes from last week's
> meeting are still unresolved. *Start →*

Click *Start* and:
- A focus block lands on their calendar from now until 1:55pm.
- The note opens, scrolled to the unresolved questions.
- The spec doc is right there, no hunting.
- When the meeting starts, the focus block ends naturally.
- After the meeting, the screen updates: *"Your prep paid off — 2
  decisions captured. Want to log them as tasks?"*

That's the surface. One screen, one decision, one click. The entire
product is in service of making that screen consistently right.

## What's underneath

Three substrates that compose into the surface:

1. **Files unified across calendar/tasks/notes.** The spec doc lives
   once and shows up wherever it's relevant. No re-uploading, no
   "where did I put this."

2. **A deterministic decision engine** that ranks tasks against
   current calendar context, available time, project pins, and
   recent activity. Auditable, explainable in one sentence per
   item.

3. **Cross-pillar timeline.** When the user wants context, the same
   data shows up as a per-day or per-project chronological view.
   "What happened on this project this month" is one click.

And under all of that:

4. **Agent surface.** Every decision the surface makes is also
   exposed as an MCP tool that ChatGPT, Claude, Gemini, or Siri can
   call. *"Hey ChatGPT, what should I work on today?"* → ChatGPT
   calls our `plan_today` tool → the user gets the same answer they'd
   see in our app, in their AI of choice.

## What it looks like vs. what's here today

The shape is recognizable from what we already ship:
- Calendar (Google sync, drag, recurrence, all the polish).
- Tasks (Todoist mirroring, kanban, projects, comments).
- Notes (Markdown, revisions, comments, context panel).
- Booking pages (Calendly-style).
- The TodayPanel (`Y` shortcut) — the proto version of "the surface."
- The MCP server with 9 tools today.

What changes:
- The TodayPanel becomes **the** primary surface, not a side panel.
- Files become first-class everywhere.
- The decision engine gets the workflow MCP tools (`plan_today`,
  `triage_inbox`, `summarize_project`).
- The cross-pillar timeline ships as a real surface.
- Voice capture (already shipped) gets first-class placement on the
  primary surface.

What stays:
- Calendar / tasks / notes / booking-pages all keep their full
  feature surface for users who prefer working in them directly. The
  "one screen" model is for the daily decision moment, not the only
  way to use the product.

## The customer pitch

### One sentence

> productivity.do is the place where you — and the AI assistants you
> trust — decide what you should work on next.

### Three sentences

> Most productivity apps make you do the work of figuring out what
> matters. productivity.do compresses your calendar, tasks, notes,
> and files into a single recommended next action — and exposes that
> same logic to ChatGPT, Claude, and Siri so the answer is wherever
> you are. You stop staring at a list of 47 things; you start
> working on the right one.

### Why it matters (the "so what")

- You already use Google Calendar and Todoist (or their equivalents).
  We sync to those — no migration.
- You already use ChatGPT or Claude. We're the system they call when
  you ask "what should I do today?"
- You already have files scattered across Drive, Gmail, and notes.
  We unify them so they show up where they're useful.

We're not asking you to switch apps. We're asking you to add **one
screen that compresses everything you already have into a clear
decision.**

### Who it's for

- **People with too much on their plate** to organize manually
  (operators, founders, senior ICs, freelancers juggling clients).
- **People already using AI assistants** for work (ChatGPT Pro,
  Claude Pro, Gemini Advanced).
- **People whose tools are spread across Google + Todoist + Notion
  + iCloud** — the unification is the immediate value.

Not for: people who already love their existing system (Things +
Apple Notes is a coherent answer; Notion-as-OS is a different
philosophy; Sunsama is a competitor for some of the same audience).

### The 60-second demo

1. Open productivity.do. *"This is your day, decided."* Show the
   TodayPanel: one task, one explanation, one button.
2. Click Start. *"It schedules the focus block, opens the note,
   surfaces the file."* Show all three happen in one click.
3. Open ChatGPT in another tab. Type *"what should I work on?"*
   Show ChatGPT calling our MCP and returning the same answer.
4. *"Same answer, wherever you are. We're the brain; ChatGPT is
   the voice."*

That's the whole pitch. Don't show them the calendar grid (it's
table stakes). Don't show them the kanban board. Don't show them
the marketplace. Show them the decision moment. Everything else is
substrate.

## Distribution — how this gets to market

Five layered approaches, from cheapest/highest-conviction to
most-speculative.

### 1. Charter users (Cagan/Inspired pattern) — first 60 days

Pick 6-10 specific people who fit the buyer profile. Personalize
outreach. 14-day Pro comp. The goal is not revenue; it's product
feedback under real use. Every charter user gets the founder's
phone number for bug reports.

This is on the launch checklist as TODO. It's the highest-priority
distribution work post-launch.

### 2. Catalog presence — once `plan_today` MCP ships

When the workflow MCP tools are stable, submit to:
- **Composio For You** (post-Rube the developer-tier MCP catalog).
- **smithery.ai**, **glama.ai/mcp**, **mcp.so** (community catalogs).

Every catalog listing is free reach. The investment is one form
submission per catalog.

### 3. Direct positioning in AI assistants

The play that matters most long-term:
- **ChatGPT Connectors store.** Get listed. Curated by OpenAI;
  requires manual approval.
- **Claude Apps directory** (when it exists publicly).
- **Apple Intents.** Ship App Intents for the iOS app when we have
  one. Siri can route "what's next" to us.
- **Gemini Actions.** Same shape on Android.

This is multi-month work per platform. Prioritize ChatGPT first —
largest user base, most-developed connector ecosystem.

### 4. Content / thought-leadership (light)

The decision-surface-pattern doc is the seed of a public-facing
thesis post. One blog entry per month, written from real product
work, not SEO bait. Topics that are credible from us:
- "Why MCP workflow tools beat CRUD wrappers" (we have the data).
- "What we learned building a deterministic ranker" (technical, real).
- "Why we stopped chasing the productivity flywheel and built a
  decision surface instead" (the pivot story).

Distribution: HN, X, the founder's network. Goal: 1 charter user
per post, on average. Slow burn, real audience.

### 5. Word-of-mouth amplifiers

Two things that compound if the product is good:
- **The booking-widget CTA.** Every public booking page has a
  "Powered by productivity.do — make your own free" link. Already
  shipped. It works because the audience seeing it is people
  *receiving* an invite from one of our users — high-intent, low-
  friction discovery.
- **MCP-as-distribution.** When a user installs our MCP into their
  ChatGPT, anyone they share a ChatGPT conversation with sees that
  the response came from productivity.do. Free brand exposure
  attached to a useful answer.

### What we explicitly DON'T do

- **Paid ads.** Solo founder, narrow ICP, content > ads at this
  stage.
- **Cold outreach to lists.** Charter users get personalized;
  beyond that, distribution is inbound.
- **Affiliate / referral programs.** The math doesn't work pre-PMF.
- **Being on Product Hunt before charter users love it.** PH is a
  one-shot — burns the launch story if the product isn't ready.

## What "winning" looks like

Concrete milestones, in rough order:

1. **Charter users say "I check this every morning."** The behavior
   is the moat, not the data.
2. **A charter user, unprompted, says "I just told ChatGPT to plan
   my day and it called you."** That's the proof the agent surface
   works.
3. **Someone outside the charter group signs up because their
   colleague uses it.** That's the first word-of-mouth signal.
4. **A specific weekly trigger-moment is named by 3+ users
   independently.** That's the buyer-pain anchor we currently
   don't have. (See `productivity-surface-strategy.md` "What's the
   weekly moment that triggers payment.")
5. **Monthly recurring revenue from non-charter users hits a
   threshold that justifies the next vertical.** Not a number to
   write down today; we'll know it when we see it.

**90-day check.** If signals 1-3 land within 90 days post-launch,
the strategy is working. If they don't, *which one did* tells us
which part of the value prop is real:
- 1 lands but not 2-3 → behavior moat is real, but agent surface
  isn't paying off yet. Invest harder in the MCP/AI-assistant
  distribution layer.
- 2 lands but not 1 → people use us through ChatGPT, not directly.
  The destination-app thesis is wrong; rework the value prop
  around being the agent backend.
- 3 lands but not 1-2 → people use us socially / via the booking
  widget, but the daily-decision moment isn't sticky. Different
  product.

If none of 1-3 land in 90 days, the thesis is wrong. Re-evaluate.

## On novelty (the honest framing)

The pattern under this strategy isn't unique. Linear's founders
have written about the shape; a16z's "agent-native vertical
winners" thesis is the same idea; Glean / Granola / productivity.do
are three implementations of one pattern. The decision-surface
lens is borrowed, and we should say so when asked.

What's *not* borrowed:

- **The execution slot is open.** Nobody has shipped a working
  personal-productivity-vertical implementation. Granola did
  meetings, Glean did enterprise search, neither did the
  personal-productivity surface.
- **The integration of all four pillars** (calendar + tasks + notes
  + files) into one decision engine is harder than it looks. We
  already have all four shipped — the substrate is the bet.
- **The solo-founder + AI-leverage execution shape** is genuinely
  novel. Linear was 6 people from day one. Granola raised $20M
  pre-profitability. We're optimizing for a path neither took.

The honest one-liner if asked "is this novel": *"The lens is
recognized. The seat is empty. The execution is the bet."*

This matters not for ego but for **defending the pitch**. Smart
people will ask "isn't this just X?" and the right answer is "yes
in shape, no in execution, here's the difference" — not "no, this
is unique." Confidence comes from the execution claim, not the
novelty claim.

If 1-3 happen within 90 days post-launch, the strategy is working.
If they don't, the loudest signal is which one *did* happen — that
tells us which part of the value prop is real.

## What this doc is for

- Source-of-truth for marketing copy. When we update the home page,
  the language here is the canonical version.
- Demo script reference. The 60-second demo above is the answer to
  "show me what it does."
- Investor / advisor briefing. If we ever pitch, this + the
  decision-surface-pattern doc are the two-page version.
- Anti-feature-creep lens. When tempted to add a feature, ask: does
  it make the one-sentence pitch crisper, or does it dilute it?

## What this doc is NOT

- Not a feature list.
- Not a roadmap (the strategy doc is).
- Not a marketing campaign brief.
- Not contingent on a specific launch date — the vision is durable
  across timing.
