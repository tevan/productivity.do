# productivity.do — strategic briefing for voice conversation

**Date:** 2026-05-02
**Purpose:** A single document the founder can upload to ChatGPT (or Claude) and discuss vocally to (1) test their understanding of the strategy, (2) probe the risks, and (3) work through the founder-fit concerns.

This brief consolidates ~10 internal strategy documents into one self-contained read. It is written for a smart conversation partner who hasn't seen our codebase or memory — the AI assistant should be able to follow along, push back, and answer specific questions.

---

## What productivity.do is

A web-based productivity surface — calendar + tasks + notes + projects + booking pages + voice capture — built solo by a single founder using AI-assisted development. Production today, roughly 6 months in, ~80 internal CLAUDE.md sections of documented architecture.

The surface looks like a standard productivity app on the screen: calendar grid, kanban board, notes editor. That's intentional. Most of what we ship is table stakes (Google Calendar already does 95% of these things). The bet isn't the screen.

**The bet** is that we accumulate ~20 structured signals from the user that no other app captures cleanly, then expose those signals via two channels:
1. A deterministic decision engine (a "ranker") that produces a single "what should I do right now" answer.
2. An MCP server that exposes that engine as a workflow tool any AI assistant (ChatGPT, Claude, Siri) can call.

The user gets one screen with one decision and one Start button. Or they ask ChatGPT *"what should I work on?"* and ChatGPT calls our MCP and returns the same answer. Same logic, two surfaces.

---

## The thesis in one sentence

> **Be the place where someone — and the AI assistants acting for them — make the decision about what to do next.**

Three load-bearing claims under that:

1. **Productivity tools are commoditizing at the storage and connector layers.** AWS Bedrock, Google Vertex, OpenAI + Snowflake all ship "talk to your data" — the AI ↔ DB layer is becoming infrastructure. Plugging GCal + Todoist into ChatGPT directly will be trivially easy within 12-24 months.

2. **What's NOT commoditizing is opinionated decision logic.** The ranker that takes (calendar + tasks + project pins + intent lines + estimation history + focus blocks + recent activity) → one specific recommendation is hundreds of small product judgments tuned against real users. AWS doesn't ship that. Anthropic ships the model, not the product judgment.

3. **The user gives us those structured signals by living in the daily workflow.** A user won't pin projects in a chat. They will in a calendar app. The surface is the data-capture mechanism. Looking like a productivity app earns the right to capture the signals only we can capture.

---

## The four load-bearing investments (in build order)

These are the next 3-4 months of focused work. Everything else is substrate already shipped.

### 1. Files unified across calendar, tasks, notes (4-6 weeks, first)

One file picker, one storage model. Files attach to events, tasks, AND notes via the same mechanism. The same file (e.g., a spec doc) threads across all three: the doc on the meeting, the doc on the prep task, the doc on the meeting notes — once. Drag-drop, paste-from-clipboard, click-to-attach. Per-file "appears in" rail.

**Why first:** substrate. The next-thing surface is shallower without it ("we ranked this meeting first, but we can't show you the doc Sara sent"). The cross-pillar timeline is incomplete without it ("file" is a row type that's missing).

### 2. MCP workflow tools (~1 week, second — promoted from parallel after a contrarian steelman)

Four agent-callable tools:
- `plan_today` — wraps the existing ranker, returns ranked decision list with explanations.
- `triage_inbox` — classifies free-text into task/event/note/comment with confidence.
- `summarize_project` — momentum + intent + open tasks + recent activity for one project.
- `rebalance_week` (v2) — proposed reschedule diff over events + tasks + focus blocks.

Each is **workflow-named** (verb-driven), not table-named. CRUD parity (`create_task` / `list_events`) loses agent routing to workflow uniqueness — when ChatGPT picks which MCP server to route a productivity intent to, "plan today" beats "list tasks" by orders of magnitude.

The cost calculus is asymmetric: when ChatGPT calls our MCP, **we run the deterministic ranker (SQL, $0/call) and return structured data; ChatGPT pays its own LLM cost to wrap the response in conversation.** We're the structured backend; the agent eats the LLM bill.

### 3. The "what should I do right now" surface (2-3 weeks, third)

Press space anywhere → one screen, one sentence, one Start button. Deterministic ranker (50-200ms, $0/call). Auditable: every recommendation explainable in one sentence. Click Start: focus block lands on calendar, note opens to the right place, attached file is right there.

This uses the *same ranker* as `plan_today` MCP — UI and agent surface read from one source.

### 4. Cross-pillar timeline (3-4 weeks, fourth)

Every event, task, note, file, comment, edit becomes a row on a unified per-day or per-project timeline. Notion can't do this (page-centric). Todoist can't (task-only). Apple Notes can't (only notes are in Apple Notes).

Cheap to build (we already have `revisions`, `links`, `tasks_cache`, `events_cache`). Pure SQL.

---

## Why each load-bearing investment together is harder to clone than any one alone

A competitor cloning files-done-well doesn't get the value. They have to clone all four, and at that point they've copied the product. The pieces compound:

- The "what should I do" surface needs files to expose attached prep material.
- The cross-pillar timeline needs files to be a row type.
- Files done well needs the timeline to make their connectedness visible.
- The MCP workflow tools need the next-thing surface's ranker to expose meaningfully.

---

## What we deliberately do NOT build

This list is at least as important as the build list. Each item is a temptation we resist:

- **Custom databases / properties / formulas.** The Notion trap. We don't compete on flexibility; we compete on time.
- **A "Projects" pillar with its own dashboards / views.** Projects are grouping metadata, not a surface. Adding a fourth pillar is the slope toward Notion.
- **Email integration beyond opt-in forwarding.** Inboxes are noise that doesn't pay rent.
- **Wiki / docs hierarchy.** Notes are notes, not pages with sub-pages.
- **Insight dashboards as primary surfaces.** Time Ledger and Estimation Intelligence stay shipped, but they're second-screen artifacts, not the headline pitch.
- **Always-on listening / wake words.** Push-to-talk only.
- **Multi-step voice orchestration.** Voice is capture + confirm + simple commands. Documented failure mode in the Perplexity research (Gemini Live, Limitless).
- **CRDT-based sync / full local-first.** Our offline mode is the right amount of local-first. Server-of-record is fine.
- **Streak counters, "your week in review" engagement scrolls, completion badges.** These are TikTok-shape (engagement-maxxing). We optimize for time-to-close.
- **Building "the universal productivity agent that connects all your apps."** Three companies tried (Rube/Composio, Zapier Central, IFTTT AI). All retreated. Vertical-with-strong-MCP is what survives.

---

## The pattern under the strategy (it generalizes)

The shape isn't unique to productivity. It's:

> A structured surface that compresses domain state into one decision, callable by humans and AI alike.

Three required ingredients: specific domain with structured state, deterministic decision engine, agent-readable MCP interface.

**Productivity is the first vertical execution.** The pattern generalizes to:
- Personal finance (*"what should I do with this paycheck?"*) — Mint died, the category is open.
- Health / fitness (*"what's my workout / meal / recovery today?"*).
- Sales / CRM (*"who should I reach out to next, what should I say?"*) — Salesforce is the Notion of CRM.
- Recruiting (same shape).
- Customer support triage (Linear-for-support).
- Cooking, learning, anything with structured state and recurring decisions.

The pattern doesn't fit creative work (writing, design — wrong question), browsing/discovery (recommendation feeds), or real-time collaboration.

**This isn't novel thinking.** Linear's founders, a16z's "agent-native vertical winners" thesis, and several public essays describe the same shape. We're not inventing the lens. We're executing the productivity slot, which is currently empty.

The implication: if the productivity execution works, the natural follow-on is an adjacent vertical, not more productivity features. The substrate (MCP workflow tools, deterministic ranker, agent-readable schemas, provenance metadata) is portable. The data model and product aren't.

---

## Same shape as a social media algorithm — opposite incentives

A natural question: *"Are we building TikTok's algorithm but for productivity?"*

**Same shape, opposite incentives.** The mechanism (weighted scoring over captured user signals → ranked output) rhymes. Five differences invert the optimization target:

1. **Inverted incentive.** TikTok maximizes time-in-app; we minimize time-to-close. Success on the next-thing surface = "user opens, clicks Start within 5s, leaves." That's a TikTok failure.
2. **Explicit vs. implicit signals.** TikTok captures dwell, scroll, micro-engagement (user doesn't know they're training). We capture pins, intent lines, priorities (user explicitly tells us). Implicit drifts toward lowest common denominator (cat videos, outrage). Explicit reflects deliberate intent.
3. **Stated vs. revealed preference.** TikTok's bet: revealed preference (what you watch) beats stated preference (what you say). True in entertainment; poisonous in productivity. A user *says* they want to ship; they actually scroll Twitter. Revealed-preference ranking would surface "scroll Twitter." Useless product.
4. **Open vs. closed deployment.** TikTok's algorithm only runs inside TikTok. Our ranker runs inside our app *and* exposes its result via MCP to ChatGPT/Claude/Siri. We don't trap the user; we travel with them.
5. **Deterministic explanation is a feature.** TikTok is opaque by design. Our ranker is explainable in one sentence per item — by architectural choice (no LLMs at the decision moment).

The cleaner pitch: *"Same shape, opposite incentives. Social media uses your behavior to maximize time spent. We use your stated preferences to minimize it. Opaque and addictive vs. explainable and built to get you out the door."*

---

## What we capture (signals) — concrete inventory

Already capturing today:

| Signal | Where the user gives it |
|---|---|
| Project favorited | Star icon next to a project |
| Project pinned (cap of 3) | Pin button on project page |
| Project intent line | Sentence at top of project page |
| Project due date | Date picker on project page |
| Project rhythm (per-day work hours) | Settings on project |
| Manual task ordering | Drag within column |
| Manual project ordering | Drag in sidebar |
| Task priority (P1-P4) | Picker in task editor |
| Task estimated minutes | Number field in task editor |
| Task completed | Checkmark |
| Focus blocks (per-day windows) | Settings |
| Calendar visibility | Eye icon next to calendar |
| Working hours | Settings |
| Estimation accuracy | Implicit — completion timing |
| Note→project link | Field on note |
| Event→task link | Field on event |
| File attachments | Drag-drop into editors |
| Color/theme preferences | Settings |
| Hidden events | Right-click → Hide |
| Subscribed (read-only) calendars | Settings |

Coming with the four investments:
- Files unified across pillars
- Cross-pillar links
- Voice routing accept/reject
- "Start" click validation on the next-thing surface
- "x" dismissals on recommendations
- Re-rank requests

What we deliberately do NOT capture: always-on listening, screen recording / OCR (Recall-style), email ingestion, app-tracking, location, dwell-time analytics. The "AI watches everything" approach is contested (Microsoft Recall, Limitless, Rewind all face friction). Our approach is uncontested.

---

## AI cost architecture (deterministic-first)

The decision-moment surfaces (ranker, timeline, momentum, ledger) run on **pure SQL + arithmetic, NOT LLMs**. ~50-200ms per call, $0 in API fees, runs offline.

LLMs are only on three narrow paths:
1. **Voice routing** — Haiku classifies utterances. ~$0.0001/call.
2. **Meeting prep** — Haiku synthesizes briefs. ~$0.0005/uncached call (cached by content hash).
3. **AI support chat** — Haiku answers KB-grounded questions. ~$0.001-0.003/turn (rate-limited 25/UTC-day per user).

**At 10K daily active users: ~$30/day = ~$11K/year in AI costs. Revenue at 10K DAU on $12/mo Pro = $1.44M ARR. AI is 0.8% of revenue.**

**MCP calls cost us $0** — the calling agent (ChatGPT, Claude) pays the LLM bill.

The strategic reason isn't the cost — it's the **moat**. If we put an LLM in the daily-grind ranking loop, anyone could clone us by piping data into Claude. Pure SQL + arithmetic over our specific signals is the durable surface.

---

## Risks the strategy faces

### 1. Anthropic / OpenAI ship "plan my day" first-party

This could land in 2 months, not 5 years. They have the LLMs, the user base, and the funding. Three reasons we'd survive:
- Big platforms don't ship opinionated verticals (Apple Reminders is fine; Things and Todoist are better — never best in any vertical).
- Their "plan my day" reads raw GCal/Todoist via OAuth — no project pins, intent lines, or estimation history. Generic answers vs. our specific answers.
- We become an integration target, not a competitor — their feature calls our MCP for users who use us.

Mitigation: **the race is structured-data accumulation, not feature parity.** Every charter user who pins three projects this week is data Claude can't replicate.

### 2. AI commoditization erodes single-purpose tools

Otter saw this. Mem saw this. "AI summarizes your meetings" became table stakes. Our hedge: don't ship a feature whose moat is "we use AI to do X." Ship features whose moat is "your stuff is here and connected."

### 3. Big-platform consolidation (Apple, Google, Microsoft)

Apple Intelligence + App Intents make our app a capability provider. If we don't ship strong intents, Apple Intelligence routes to Reminders / Calendar by default. Mitigation: prioritize MCP workflow tools (cross-platform) over App Intents (Apple-only) for now; revisit Intents post-launch.

### 4. Founder fit — "am I the right person for this"

Real concern. Honest answers in the next section.

### 5. Distribution

Hardest unsolved problem. Charter users (6-10 personalized) are the answer for the first 60 days. MCP catalog submissions (Composio, smithery, glama, mcp.so) are free reach when `plan_today` ships. ChatGPT Connectors store, Apple Intents, Gemini Actions are multi-month per platform. Content (1 post/month, real product writing) is slow burn. No paid ads pre-PMF.

### 6. Scope creep / Notion-shape drift

Every charter user request to "add custom properties" or "let me make sub-projects" is the slope toward Notion. The strategy doc encodes the answer: no, even when asked.

---

## Founder-fit concerns (the honest version)

The founder is concerned about three things:

> **1. "I'm entering an area filled with technical experts; they'll crush me if I try to enter the space."**

This concern conflates two different races:
- The race for *technical novelty* (best LLM, best vector search, best CRDT) — yes, full of experts.
- The race for *product judgment in a specific vertical* (which signals to capture, which to ignore, what the daily decision moment feels like) — fundamentally about taste and execution, not technical expertise.

Linear didn't beat Jira because they had better engineers. They beat Jira because they had taste. Granola didn't beat Otter because they had better transcription (they don't) — they had a better product. Bear didn't beat Evernote because they had better sync. They had taste.

The category isn't a Kaggle leaderboard. There's no objective "best." The signal that matters is: do users open the next-thing surface and consistently say *"yes, that's what I should be working on"*? That's a product judgment question, not a technical one. The technical pieces are commodities (Anthropic / OpenAI / AWS ship them).

**The founder's edge:** the founder has used productivity tools as a power user for years. The founder has built one with real users (the existing product). The founder has shipped ~80 documented architectural decisions in 6 months solo. That's the bar. Technical experts who build a competing app won't build it with this much accumulated taste.

> **2. "Maybe my moat is fast execution? But AI levels that."**

Partly true. AI does shrink the gap between a 1-person and a 10-person team on shipping features. It does not shrink the gap on:
- **Knowing what to build.** The strategy work (deciding to ship voice in the way we ship it, deciding NOT to ship CRDTs, deciding to make the surface look like a calendar app on purpose) is still scarce.
- **Owning the decision space.** A 10-person team has 10 opinions and ships compromises. A 1-person team has 1 opinion and ships convictions. Linear's founders deliberately stayed small for this reason.
- **Founder-as-customer.** The founder is the first user. Every pain the founder feels gets fixed in the next deploy. That's faster than any user research loop.

Fast execution is necessary but not sufficient. **Fast execution + taste + AI-leverage is the actual moat.** The combination is rare.

> **3. "When I understand something, I believe I can compete by having different ideas."**

Yes. The "different ideas" claim has two flavors:
- **Different idea about implementation** (we'll build this faster / cheaper / cleaner) — gets commoditized.
- **Different idea about what the product should be** (we'll build a fundamentally different shape) — durable.

The strategy laid out here is in the second category. "Productivity surface as decision destination + agent backend + structured-signal capture" is a different *shape* of product than ClickUp / Notion / Linear / Todoist. Specifically: those companies optimize for time-in-app; we optimize for time-to-close. That's not a tactical difference; it's a different bet about what users want.

---

## What this looks like 12 months out

The end-state vision: a user opens productivity.do (or asks ChatGPT/Claude/Siri "what should I work on?"). They see one screen with one sentence:

> *"Right now: prep for the 2pm sync with Anne. You have 50 minutes free. Sara sent the spec doc Tuesday — it's attached. Three open questions in your notes from last week's meeting are still unresolved. Start →"*

Click Start. Focus block lands on calendar from now until 1:55. Note opens, scrolled to unresolved questions. Spec doc is right there. When the meeting starts, the focus block ends naturally.

Same answer reachable from ChatGPT. Same answer reachable from Siri. Same answer reachable from any AI that calls our MCP. The user can be wherever they want; the answer follows them.

---

## How we explain it to a customer

**One sentence:**
> productivity.do is the place where you — and the AI assistants you trust — decide what you should work on next.

**Three sentences:**
> Most productivity apps make you do the work of figuring out what matters. productivity.do compresses your calendar, tasks, notes, and files into a single recommended next action — and exposes that same logic to ChatGPT, Claude, and Siri so the answer is wherever you are. You stop staring at a list of 47 things; you start working on the right one.

**60-second demo:**
1. Open the app. *"This is your day, decided."* Show the one screen.
2. Click Start. *"Schedules the focus block, opens the note, surfaces the file."* Three things in one click.
3. Open ChatGPT. Ask "what should I work on?" ChatGPT calls our MCP. Same answer.
4. *"Same answer, wherever you are. We're the brain; ChatGPT is the voice."*

---

## Distribution plan

Five layers, cheapest-and-highest-conviction first:

1. **Charter users (60 days post-launch).** 6-10 specific people, personalized outreach, 14-day Pro comp. Goal: product feedback, not revenue. Founder's phone number for bugs.

2. **MCP catalogs (after `plan_today` ships).** Composio For You, smithery.ai, glama.ai/mcp, mcp.so. Each is one form. Free reach.

3. **Direct AI-assistant integrations.** ChatGPT Connectors store first (largest user base). Then Claude Apps directory, Apple App Intents, Gemini Actions. Multi-month per platform.

4. **Light content (1 post/month).** Real product writing. Topics with credibility: "Why MCP workflow tools beat CRUD," "What we learned building a deterministic ranker," "Why we stopped chasing the productivity flywheel." Distribution: HN, X, founder's network.

5. **Word-of-mouth amplifiers.** Booking-widget CTA on every public booking page. MCP-as-distribution (when a user installs our MCP into ChatGPT, anyone they share a conversation with sees us as the answer source).

What we don't do: paid ads, cold outreach to lists, affiliate programs, Product Hunt before charter users love it.

---

## What "winning" looks like (90-day check)

If signals 1-3 land within 90 days post-launch, the strategy is working:

1. Charter users say *"I check this every morning."*
2. A charter user, unprompted, says *"I just told ChatGPT to plan my day and it called you."*
3. Someone outside the charter group signs up because their colleague uses it.

If they don't, *which one DID land* tells us which part of the value prop is real and where to invest:
- Only 1 lands: behavior moat works, agent surface needs more investment.
- Only 2 lands: people use us through ChatGPT, not directly — destination thesis is wrong.
- Only 3 lands: social discovery works but daily-decision moment isn't sticky — different product.
- None land: thesis is wrong. Re-evaluate.

Later signals: weekly trigger-moment named by 3+ users independently (buyer-pain anchor), MRR threshold that justifies the next vertical.

---

## Things to talk about with ChatGPT in voice chat

This is a list of probes — questions the founder might ask the assistant to make sure they understand the strategy. The assistant should be able to answer all of these from the brief above.

1. *Walk me back through the four load-bearing investments. Why is the order what it is?*
2. *Why is the surface the data-capture mechanism, and why does that matter against AWS Bedrock?*
3. *What's the difference between CRUD MCP tools and workflow MCP tools, and why does it matter?*
4. *Explain "same shape as TikTok algorithm, opposite incentives" in plain words.*
5. *If Claude ships a "plan my day" feature in 2 months, what happens to us?*
6. *Why don't we just become a connector / aggregator and let users plug in everything?*
7. *What signals do we capture that GCal + Todoist alone don't carry?*
8. *Why is the ranker pure SQL and not an LLM? What's the strategic reason?*
9. *What's the 90-day winning check?*
10. *What's the "decision-surface pattern" and which other verticals does it fit?*
11. *What's our distribution plan in order, and what do we explicitly NOT do?*
12. *What are three temptations the strategy resists, and why?*
13. *What's the difference between the founder's edge and a technical-expert team's edge?*
14. *Why did Notion's growth NOT slow down, and what does that mean for us?*
15. *Why is fast execution alone not enough, and what's the third ingredient?*

---

## What this brief is NOT

- Not the full architecture. The codebase has ~80 documented sections; this is the strategic layer only.
- Not a roadmap with dates. The build order is in the strategy doc; the dates depend on real shipping.
- Not a fundraising pitch. It's a thinking tool, written for the founder's understanding.
- Not contingent on a specific launch date. The strategy is durable across timing.

---

## File pointers (for the ChatGPT assistant if it asks)

If the assistant wants to drill into a specific area, the founder has these internal docs:

- `docs/internal/productivity-surface-strategy.md` — the full strategic anchor (~30K words).
- `docs/internal/perplexity-research-synthesis.md` — synthesis of 3,100-line market research.
- `docs/internal/decision-surface-pattern.md` — pattern that productivity.do is one execution of.
- `docs/internal/end-state-vision.md` — what the surface looks like 12 months out.
- `docs/internal/captured-signals.md` — concrete inventory of every signal captured.
- `docs/internal/ai-cost-architecture.md` — when we use LLMs, when we don't, the rule.
- `docs/internal/SESSION-CONTEXT-2026-05-02.md` — running session breadcrumb.

This brief is the strategic compression of all of those.
