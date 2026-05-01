# Reference library — index

Books to consult when planning features. Each entry: file path, when this
book is the right one to open, and the chapters/sections most worth
reading first for productivity.do specifically.

When working on a feature, read this index, pick the most-relevant book,
then read the targeted chapter via the Read tool with a `pages:` parameter
(PDFs over 10 pages require it).

---

## UX / interaction design

### About Face — Alan Cooper, Robert Reimann (4th ed.)
- **File:** `About_Face_-_Alan_Cooper.pdf`
- **Open this when:** Designing any new interaction, modal, or workflow. Choosing between modal/modeless. Debating "should this be a button or a menu?"
- **Most useful for productivity.do:**
  - Part 1 (foundations) — goal-directed design, primary/secondary/tertiary users
  - Chapter on "excise" (effort the tool requires of the user) — directly applies to our Settings, integrations directory, booking page editor
  - Chapter on modal/modeless dialogs — applies to EventEditor, BookingPageEditor, ConfirmRoot
  - Chapter on selection patterns — applies to multi-select tasks, calendar event selection
  - Chapter on direct manipulation — applies to drag-to-move events, drag-tasks-to-day

### Don't Make Me Think Revisited — Steve Krug (3rd ed.)
- **File:** `Dont_Make_Me_Think_Revisited__A_Common_S_-_Steve_Krug.pdf`
  *(Note: the older copy `Dont_make_me_think_-_Steve_Krug.pdf` is redundant — same book, earlier edition. Safe to delete.)*
- **Open this when:** Sanity-checking any new screen or flow. Onboarding design. Marketing pages.
- **Most useful for productivity.do:**
  - Chapter 2 ("How we really use the web") — the scanning/satisficing reality every UI must accommodate
  - Chapter 3 ("Billboard design") — applies to home page hero, signup flow, integrations directory tiles
  - Chapter 9 ("Mobile") — applies to MobileBottomNav, booking widget at <640px
  - Chapter on usability testing — when we have users, this is the cheap testing protocol to follow

---

## Information presentation

### The Visual Display of Quantitative Information — Edward Tufte
- **File:** `The_Visual_Display_of_Quantitative_Information_-_Edward_R_Tufte.pdf`
- **Open this when:** Designing any data-dense view (calendar grid, tasks board, analytics dashboards, daily digest layout). Color decisions. "Is this chart actually useful?"
- **Most useful for productivity.do:**
  - Data-ink ratio principle — applies to event chip styling, sidebar density, marketplace tile information
  - Small multiples — applies to multi-day calendar views, calendar set comparisons
  - Chartjunk vs. signal — applies to color schemes, when to add icons vs when they're noise
  - Chapter on graphical integrity — applies to booking-page analytics (don't lie with charts)

---

## Calendar / time / focus

### Deep Work — Cal Newport
- **File:** `Deep_Work_-_Cal_Newport.pdf`
- **Open this when:** Designing focus features, work-hour defaults, the "what is this app for" framing. Notification/interruption philosophy.
- **Most useful for productivity.do:**
  - The four philosophies of deep work — informs our focus-blocks feature design
  - "Quit social media" chapter — informs daily-digest design (we should drive *to* deep work, not *away from* it)
  - Rules for ritualizing focus — informs work-hour defaults, calendar set patterns

### The Time-Block Planner — Cal Newport
- **File:** `The_Time-Block_Planner_-_Cal_Newport.pdf`
- **Open this when:** Working specifically on the time-blocking experience. Scheduling rituals. Day-view layout decisions.
- **Most useful for productivity.do:**
  - The full time-blocking method (the planner's preface explains it) — directly applies to focus-blocks, auto-schedule, day-view design
  - The "shutdown ritual" — could become a daily-digest feature
  - Pairs with *Deep Work* — read both before adding any focus-related feature

---

## Task management / GTD / productivity philosophy

### Getting Things Done — David Allen (revised)
- **File:** `Getting_Things_Done_-_David_Allen.pdf`
- **Open this when:** Any decision about Tasks UX. Inbox design. The "review" pattern. What constitutes a "next action."
- **Most useful for productivity.do:**
  - Chapter on capture (the inbox principle) — informs our email-to-task feature, quick-add input
  - Chapter on processing — informs the kanban "to do / in progress / done" model and why "done" is virtual
  - Chapter on the weekly review — informs the weekly digest feature
  - Chapter on contexts — informs labels, projects, filtering UX

### Team: Getting Things Done with Others — David Allen (2023)
- **File:** `Team_Getting_Things_Done_with_Others_-_David_Allen.pdf`
- **Open this when:** Working on Team-plan features. Round-robin booking. Collective scheduling. Multi-host workflows. Future shared-tasks features.
- **Most useful for productivity.do:**
  - Whole book is about applying GTD principles to teams — directly relevant to our Team booking pages, shared calendar sets, future shared projects
  - Chapters on shared inboxes, shared projects, accountability — informs Team UI patterns

### Building a Second Brain — Tiago Forte
- **File:** `Building_a_Second_Brain_A_Proven_Method_to_Organize_Your_Digital_Life_and_Unlock_Your_Creative_Potential_-_Tiago_Forte.pdf`
- **Open this when:** Working on Notes. PKM integrations (Obsidian, Roam, Logseq). The relationship between notes/tasks/projects. Future search/AI-search features.
- **Most useful for productivity.do:**
  - PARA framework (Projects, Areas, Resources, Archives) — could inform a future Projects view
  - CODE method (Capture, Organize, Distill, Express) — informs the email-to-task → notes pipeline
  - Chapter on progressive summarization — relevant if we add AI note-distillation features
  - Chapter on the link economy — relevant to bidirectional notes/events linking

---

## Habit formation & engagement (read together)

### Hooked — Nir Eyal & Ryan Hoover
- **File:** `Hooked_-_Ryan_Hoover.pdf`
- **Open this when:** Designing notifications, daily digest cadence, return-engagement features, onboarding. Habit-streak design.
- **Most useful for productivity.do:**
  - The hook model (trigger → action → variable reward → investment) — informs digest/reminder timing, notification triggers
  - Chapter on triggers — informs in-app notifications, browser-push, email cadence
  - **Important caveat:** read alongside *Atomic Habits* and (when added) *Indistractable*. We sell productivity, not engagement — designing addictive loops is a betrayal of what users pay us for.

### Atomic Habits — James Clear
- **File:** `Atomic_Habits_-_James_Clear.pdf`
- **Open this when:** Designing habit-tracking, recurring tasks, streaks. Onboarding "stickiness" without being manipulative. The user-side of habit formation (vs. *Hooked*'s product-side).
- **Most useful for productivity.do:**
  - Four laws of behavior change (cue, craving, response, reward) — informs recurring task UX, habit-style features (Habitica/Streaks integrations)
  - Identity-based habits — informs how we frame onboarding ("you're someone who plans their week")
  - Environment design — informs default settings, what's visible vs. hidden

### Workbook for Atomic Habits
- **File:** `Workbook_For_James_Clears_Atomic_Habits_-_James_Clear.pdf`
- **Open this when:** Same context as the main book; the workbook is a supplement with exercises. Skip if you've already read the main book.

---

## Engineering / architecture

### Designing Data-Intensive Applications — Martin Kleppmann
- **File:** `Designing_Data-Intensive_Applications_-_Martin_Kleppmann.pdf`
- **Open this when:** Decisions about caching, sync, conflict resolution, multi-source-of-truth. Database design. Eventual consistency between us and Google/Todoist/Notion.
- **Most useful for productivity.do:**
  - Chapter 5 (replication) — applies to our SWR cache vs server, Google Calendar two-way sync
  - Chapter 7 (transactions) — applies to atomic booking creation, slot-recheck-then-insert
  - Chapter 9 (consistency and consensus) — applies to "what does it mean for a Todoist task to be 'completed' when our cache disagrees?"
  - Chapter 11 (stream processing) — applies to our webhook delivery, retry queue
  - Chapter 12 (the future of data systems) — broad context, useful framing for source-abstraction architecture

### The Pragmatic Programmer — Andy Hunt, Dave Thomas (20th anniversary)
- **File:** `The_Pragmatic_Programmer_-_David_Thomas.pdf`
- **Open this when:** Making architectural decisions. Refactoring. Reviewing your own code. Choosing abstractions.
- **Most useful for productivity.do:**
  - DRY principle — relevant to integration adapter pattern (don't fork stub helper logic), shared TaskListPanel
  - Orthogonality — relevant to the source-abstraction model (one provider's failure shouldn't break others)
  - Tracer bullets — relevant to how we're shipping integrations (real-but-stub adapters first, depth later)
  - Chapter on configuration — relevant to env vars, feature flags
  - Chapter on coupling — relevant to MCP server, API design, why we don't give the LLM tools

---

## API design

### Designing Web APIs — Brenda Jin, Saurabh Sahni, Amir Shevat (O'Reilly)
- **File:** `Designing Web APIs - Brenda Jin, Saurabh Sahni, Amir Shevat-OReilly-9781492026921.pdf`
- **Open this when:** Quick reference for REST shape, auth patterns, webhook basics. Read this first — it's the broader/lighter of the two API books.
- **Most useful for productivity.do:**
  - Chapter 2 (REST principles) — sanity check on `/api/v1` resource design
  - Chapter 3 (designing for developers) — relevant to OpenAPI spec quality, developer docs
  - Chapter 4 (auth patterns) — relevant to Bearer pk_live_… scheme, OAuth for upcoming Slack/Google integrations
  - Chapter 5 (real-time updates) — relevant to webhooks, future SSE/websocket features
  - Chapter 6 (designing platforms) — relevant to MCP server, marketplace strategy
  - Chapter 9 (developer ecosystem) — relevant to Zapier/Make app submission planning

### API Design Patterns — JJ Geewax (Manning)
- **File:** `API Design Patterns (JJ Geewax).pdf`
- **Open this when:** Extending `/api/v1` with anything non-trivial. Bulk endpoints. Partial updates. Soft delete. Pagination. Filtering. Long-running operations. Standard method semantics.
- **Most useful for productivity.do:**
  - Part 2 (design principles) — naming, resource layout; sanity check before adding new resources
  - Part 3 (fundamentals) — standard methods (List, Get, Create, Update, Delete, Replace) — directly maps to our `/api/v1/{tasks,events,booking-pages}` shape
  - Chapters on partial updates / field masks — relevant to PATCH-style endpoints we'll need
  - Chapters on bulk + batch operations — directly applies to `/api/v1/{events,tasks}/bulk` (already shipped, but the book has guidance on transactional vs. partial-failure modes that we should revisit)
  - Chapter on soft delete — directly applies to our 30-day account recovery pattern
  - Chapter on pagination — when our list endpoints grow past trivial sizes
  - Chapters on long-running operations + LRO polling — relevant to AI prep, sync runs, large bulk imports
  - Read this BEFORE extending `/api/v1` further; pair with the O'Reilly book above for the broader context

---

## Information presentation (advanced)

### Envisioning Information — Edward Tufte
- **File:** `Envisioning_Information_-_Edward_R_Tufte.pdf`
- **Open this when:** You've already absorbed *Visual Display* and need to design something with layered/multi-dimensional information. Calendar views with overlays (events + tasks + focus blocks + travel-time), timezone bars, marketplace category grids.
- **Most useful for productivity.do:**
  - Chapter on layering and separation — directly applies to TimeGrid (events, focus blocks, travel chips, tasks-on-calendar all stacked); informs how to keep visual hierarchy when adding overlays
  - Chapter on small multiples — applies to multi-day calendar views, calendar-set comparisons
  - Chapter on color and information — pair with `lib/utils/colorSchemes.js`; informs scheme palette choices, when saturation aids vs. distracts
  - Chapter on narratives of space and time — relevant to timezone bar, recurring-event visualization, travel-time blocks
  - Less essential than *Visual Display* — open this only when you're stuck on a layered/dense view and need a deeper toolkit

### Information Architecture — Louis Rosenfeld, Peter Morville (4th ed.)
- **File:** `Information_Architecture_-_Louis_Rosenfeld.pdf`
- **Open this when:** Designing navigation, taxonomy, search, or content organization. Marketplace categories. Help center structure. Settings-tab grouping. Future projects/labels/tags taxonomy.
- **Most useful for productivity.do:**
  - Part 1 (foundations) — the "anatomy" of IA: organization, labeling, navigation, search; framework for marketplace + help center decisions
  - Chapter on organization systems — informs marketplace category split (16 categories), Settings tab grouping, calendar-set grouping
  - Chapter on labeling — informs adapter-card copy, Settings labels, marketing-page nav, KB article titles
  - Chapter on navigation systems — informs sidebar/toolbar design, app-tabs ordering, breadcrumbs in marketplace deep-links
  - Chapter on search systems — relevant when KB grows past ~50 articles (per `knowledgebase_pattern` memory) and we replace keyword scoring with embeddings
  - Chapter on metadata, controlled vocabularies, thesauri — informs labels/tags taxonomy if we add user-defined hierarchies later
  - Open this before any "we need to reorganize X" conversation

---

## Product strategy

### Inspired — Marty Cagan (2nd ed.)
- **File:** `Inspired__How_To_Create_Products_Customers_-_Marty_Cagan.pdf`
- **Open this when:** Strategic product decisions. "Which integration to deepen first?" "Should we ship feature X or stay focused?" "What does the next quarter look like?" Roadmap discussions.
- **Most useful for productivity.do:**
  - Part 2 (the right product) — discovery techniques, the four risks (value/usability/feasibility/business viability); informs which integrations to deepen vs. leave as stubs
  - Chapters on opportunity assessment — frame for evaluating new feature requests against our SaaS launch goals
  - Chapter on prototyping — informs how we ship marketplace stubs before deep adapters
  - Chapter on product principles — useful for writing/maintaining our own product principles document
  - Chapter on product/market fit and the role of product manager — useful framing as the user is wearing both PM and engineer hats
  - Open this when feature scope is creeping or when prioritizing between competing user requests

---

## Timing & rhythms

### When: The Scientific Secrets of Perfect Timing — Daniel Pink
- **File:** `When_-_Daniel_H_Pink.pdf`
- **Open this when:** Designing anything time-of-day or rhythm related. Work-hour defaults. Focus-block placement. Auto-schedule heuristics. Daily digest send time. Reminder cadence. Energy-aware task scheduling.
- **Most useful for productivity.do:**
  - Chapter 1 (the hidden pattern of everyday life) — peak/trough/recovery cycle; directly applies to auto-scheduling philosophy ("schedule analytical work in morning peak, admin work in afternoon trough, creative work in recovery")
  - Chapter 2 (afternoons and coffee spoons) — informs why focus-blocks default to mornings, why we might suggest blocks against the user's chronotype only with a warning
  - Chapter on chronotypes (lark/owl/third bird) — could become a Settings field that influences auto-schedule placement and digest send time
  - Chapter on beginnings — informs onboarding timing, "fresh start" effects (Mondays, month starts) → relevant to weekly digest framing
  - Chapter on midpoints — informs progress UX (mid-week, mid-project nudges)
  - Chapter on endings — informs shutdown rituals, weekly review, end-of-day summaries
  - Chapter on synchronizing with others — informs Team-plan booking, shared calendar sets, group time-poll design
  - Pair with *Deep Work* and *The Time-Block Planner*: Newport tells us how to focus, Pink tells us *when* to focus

---

## What's NOT in the library yet (recommended additions)

In priority order — none urgent, but worth picking up:

1. **Indistractable — Nir Eyal.** Ethical counterweight to *Hooked*. Pair-read keeps us honest — we sell productivity, not engagement.
2. **The Design of Everyday Things — Don Norman.** Foundational affordance/feedback theory. Useful any time we're debating "is this discoverable?"
3. **Refactoring — Martin Fowler (2nd ed.).** When the codebase grows past ~50k lines and we need shared vocabulary for restructuring.

---

## How to use this index

When planning a feature:
1. Read this index, pick the most-relevant book(s)
2. Read the targeted chapter — use Read tool with `pages: "X-Y"` (PDFs over 10 pages need this)
3. Cite specific sections in design discussions and commit messages so future-us can trace the reasoning

When the index needs updating:
- Add new books here AND under the recommended additions section if any move from "wishlist" to "library"
- Update file paths if PDFs are renamed
- If a book turns out to be more or less useful than expected, revise the "most useful for" hints
