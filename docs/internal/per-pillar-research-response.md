# productivity.do — Per-Pillar Defensive Stakes

> **Bottom line up front:** Calendar should own *time transparency* (estimated vs. actual, per week, surfaced without asking). Tasks should own *honest scheduling* (real-time slip-risk signal driven by your own time estimates). Notes should own *live context* (a note that knows what's on your calendar and task list when you open it). These three stakes are load-bearing for each other — they share the same estimation data, the same synthesis layer you've already shipped, and create a flywheel no single-pillar app can replicate.

***

## Competitive Landscape: Where Each App Plants Its Flag

Before choosing a stake, it helps to map the territory precisely.

### Calendar Competitors

| App | Stake | What makes it hard to copy |
|---|---|---|
| **Fantastical** | Natural-language parsing + beautiful multi-platform views | 12+ years of NLP polish; deep Apple ecosystem integration[^1][^2] |
| **Notion Calendar (Cron)** | Seamless link between calendar events and Notion pages | Network effect: only useful if you're already in Notion[^3][^4] |
| **Vimcal** | Speed + availability sharing for meeting-heavy execs and EAs | Calendar Audit, multi-timezone, EA delegation tools[^5][^6][^7] |
| **Motion** | Full AI auto-scheduling — replaces your entire calendar | ML-heavy continuous rescheduling loop[^8][^9] |
| **Reclaim** | Set-and-forget focus-time defense + habit blocking | Mature PM integrations; habit resilience logic[^8] |
| **Sunsama** | Intentional daily planning ritual with reflection prompts | Emotional commitment to the ritual (creators explicitly refuse auto-scheduling)[^10][^11] |
| **Akiflow** | Keyboard-driven task consolidation into calendar | Aggregates from 15+ PM tools; command-center feel[^9][^10] |

**Unclaimed seam:** None of these apps closes the loop between *what you planned to spend time on* and *what you actually spent time on*, at the individual task/event level, without requiring a separate time-tracking tool. Vimcal's Calendar Audit exists for EAs auditing executives; nobody offers it as a first-class personal feedback loop.[^7]

### Task Manager Competitors

| App | Stake | What makes it hard to copy |
|---|---|---|
| **Things 3** | Beautiful calm design + Today/Anytime/Someday rhythm | Design taste; years of Apple Award polish[^12][^13] |
| **Linear** | Sub-100ms keyboard speed; issue management as craft | Engineering culture; years of performance investment[^8] |
| **Todoist** | Cross-platform ubiquity + natural language | 17 years of users; ecosystem integrations |
| **OmniFocus** | GTD power user depth; review system | Perspective engine complexity[^13][^14] |
| **Motion** | AI fully auto-schedules tasks — zero manual time-blocking | Continuous ML rescheduling[^9][^11] |
| **Reclaim** | Tasks from PM tools auto-blocked into calendar | Mature Jira/Asana/Linear/Todoist integrations[^8] |

**Unclaimed seam:** Every tool either ignores how long tasks *actually* take (Todoist, Things, OmniFocus) or auto-schedules based on availability alone without learning from history (Motion, Reclaim). The gap is *feedback*: estimated minutes → actual minutes → better future estimates. One Reddit builder noticed this and shipped a micro-app specifically to solve it. You already have `estimated_minutes` — you just haven't closed the loop.[^15]

### Notes Competitors

| App | Stake | What makes it hard to copy |
|---|---|---|
| **Bear** | Typography-first writing experience; custom Bear Sans font; zero loading states[^12][^16][^17] | Commission-level typography craft; custom typeface |
| **iA Writer** | Radical focus; AI authorship coloring (human vs. AI text visually distinct)[^18][^19] | Philosophical conviction + Apple Design Award validation |
| **Obsidian** | Local-first, plugin ecosystem, graph view for PKM | 1,000+ community plugins; Markdown vault portability[^20][^21] |
| **Logseq** | Outliner + block references + open-source PKM | Block-level granularity; open source community[^20][^22] |
| **Capacities** | Object-based notes (People, Projects, Quotes as typed objects) | Structured object model; visual team knowledge[^22][^23] |
| **Mem** | Zero-folder AI auto-organization; semantic search across all notes; Mem Chat for querying your own knowledge[^24][^25] | AI infrastructure cost + training on personal note corpus |
| **Notion** | Flexible database-backed workspace for teams[^21][^26] | Relational database engine; team collaboration |
| **Apple Notes** | Zero-friction, instant-open, iCloud native | OS-level integration; zero cost |

**Unclaimed seam:** Every notes app treats a note as a static artifact. None surface *what's happening in your calendar and task list* when you open a note. Mem surfaces related notes; nobody surfaces related *live work items*. A meeting note that shows the event it belongs to, the tasks it spawned, and the overdue items linked to the same project — that's not a PKM trick, it's a working context panel.[^24]

***

## The Three Stakes

***

### 🗓 Calendar Stake: "The calendar that tells you how you actually spent your time — not just how you planned to spend it"

**Single-sentence user pitch:** "It's the only calendar that shows me a weekly breakdown of planned vs. actual hours per category, so I know where my time really went."

#### (a) Persona
The *solo operator or small-team founder* who has a Notion doc full of intentions but no honest feedback mechanism. They use Vimcal or Fantastical to plan, Toggl or Harvest separately to track time, and nothing that connects them. They're not an EA who needs to audit an executive; they're the executive who needs to audit themselves.

#### (b) Smallest Credible Feature: Weekly Time Ledger
A single new view — call it **Time Ledger** — accessible via one keyboard shortcut from any calendar week. It shows:

1. **Per-color-tag / per-calendar category**: planned hours (sum of event durations) vs. actual hours (based on events that occurred in the past, pulled from existing event data — no manual timer needed).
2. **Δ column**: where you ran over or under each week.
3. **12-week sparkline** per category (SQL aggregate over your existing event table).
4. One optional Claude Haiku call — already wired — that fires when you open the Ledger: prompt = *"Given this user's last 4 weeks of planned vs. actual time by category, write one sentence of observation."* Cost: ~$0.001/open. No streaming, no chat interface — just a single sentence, stamped and stored.

This requires **zero new data collection** — your events already have start, end, color, and calendar. You already have CSV export and the `/api/weekly-review` endpoint. Time Ledger is a frontend aggregation of data you already own.

#### (c) Competitive Moat
- Vimcal's Calendar Audit targets EAs auditing *other people's* calendars; this is for self-audit.[^7]
- Motion and Reclaim optimize *future* scheduling based on availability, not *past* time use.[^8][^11]
- Google Calendar has no per-category time tracking.
- The moat is **accumulated personal history** — the longer a user stays, the more accurate the 12-week sparklines become, and the harder it is to leave.

#### (d) Bundle Composition
- The Ledger's category breakdown feeds directly into the Tasks pillar's slip-risk model (see below).
- Notes can display the Ledger summary for the current week in the note header when a note is categorized under a project (see Notes stake).
- The synthesis layer's `/api/weekly-review` already computes velocity — the Ledger is its visual complement.

#### ❌ Do NOT build:
1. **Pomodoro/timer integration** — Vimcal has focus mode; this fragments the stake into a productivity-toy and undercuts the serious time-audit angle.[^6]
2. **"AI-optimized weekly schedule" suggestions** — Motion owns this; you can't win it solo, and it requires an always-on ML loop you can't maintain.

***

### ✅ Tasks Stake: "The task manager that knows when your day is going off the rails — before it does"

**Single-sentence user pitch:** "It's the only task manager that compares how long tasks *actually* took me last time and warns me when today's schedule is already mathematically impossible."

#### (a) Persona
The *prosumer who time-blocks religiously but always lies to themselves about duration*. They put "write proposal — 30 min" on the calendar, it takes 90 min, and the rest of the day cascades. They use Todoist or Things for capture, auto-schedule into Google Calendar, and have no feedback loop on their own estimates. This is the exact user you're already targeting with `estimated_minutes`.

#### (b) Smallest Credible Feature: Estimation Intelligence
Three small additions that form a closed loop:

1. **Completion timer**: When a user marks a task complete, record `actual_minutes = now() - started_at` (where `started_at` is the GCal event start time if the task was scheduled, else the "Move to Today" timestamp). Store `actual_minutes` alongside `estimated_minutes` — one new column, always populated automatically.

2. **Per-task estimate accuracy badge**: On any task with 3+ completions, show a small badge (e.g., "you usually take 2× your estimate on this label"). This is a deterministic SQL query: `AVG(actual_minutes / estimated_minutes) WHERE label = X`. No ML needed.

3. **Day capacity warning**: At the top of the Today view, show a single number: *"Today: 4h 20m estimated across 7 tasks. Your historical ratio for these labels is 1.8×. Realistic load: ~7h 50m."* Show a red indicator if realistic load exceeds available unblocked calendar time (you already have free-slot data from the auto-schedule engine). This runs as a deterministic SQL query each time the Today view loads — no inference, no streaming, instant.

The Claude Haiku call is optional and reserved for the weekly review: once per week, it reads the `estimated vs. actual` table and produces one sentence for the `/api/weekly-review` payload. Trigger: user opens Weekly Review; model: Claude Haiku; input: aggregated stats only (no raw note text).

#### (c) Competitive Moat
- Motion reschedules based on *availability*, not *personal estimation history*. It doesn't know that you always underestimate "writing" tasks by 2×.[^9][^8]
- Reclaim does task blocking but has no estimation feedback loop.[^8]
- Todoist has no `estimated_minutes` at all.[^9]
- Things 3 has no time estimates.
- The moat is **personalized calibration data** — the longer a user stays, the more accurate their ratio badges become. This data is per-user, non-transferable, and accumulated over months.

#### (d) Bundle Composition
- `actual_minutes` feeds the Calendar Time Ledger directly (tasks that were scheduled as events contribute to "actual" time in that category).
- The day-capacity warning pulls from the Calendar's free-slot engine — this only makes sense inside a bundled app.
- Notes can show estimation accuracy for tasks linked to a note's project (see Notes stake).

#### ❌ Do NOT build:
1. **Time tracking with a manual start/stop timer** — this is a context switch that kills capture speed, requires discipline to use, and you'll be competing with Toggl/Harvest on their home turf.
2. **AI-generated task duration estimates for new tasks** — without personal history it's a generic LLM guess; it trains users to distrust the feature before their data matures.

***

### 📝 Notes Stake: "The notes app that shows you what's actually happening in your life when you open a note"

**Single-sentence user pitch:** "Every note I open shows me the calendar event it belongs to, the tasks it's linked to, and what's overdue in the same project — without me building a system."

#### (a) Persona
The *context-switching knowledge worker* who writes a meeting note, then loses the thread three days later because the note is a static document with no connection to what's live. They've tried Obsidian's backlinks (too much manual work), Notion's relational databases (too much schema design), and Mem's AI auto-tagging (impressive but zero structure). They want context *automatically surfaced*, not auto-organized.[^25][^21][^26][^24]

#### (b) Smallest Credible Feature: Live Context Panel
A non-intrusive right-side panel (collapsible, 240px) visible when a note has any of the following cross-links (you already have `note↔task` and `note↔event` linking):

- **Linked event card**: If the note was created from a calendar event (or manually linked), show the event title, date, attendees. If the event is in the future, show a countdown. If in the past, show elapsed time.
- **Live task rail**: All tasks linked to this note, with their current status (overdue shown in red, completed grayed). No navigation required — this is a read-only task rail rendered inline.
- **Project health row**: If linked tasks share a project, show a single row: X tasks complete, Y overdue, next due date. One SQL query.
- **Estimation callout** (once the Tasks stake ships): If linked tasks have estimation data, show a one-liner: "This project is running 1.4× your estimates."

This requires no new data model — you already have cross-resource links, task status, event data, and project groupings. The entire panel is a read-only composite query rendered in Svelte. No AI call needed for the panel itself.

Optional: one Claude Haiku call *per note open* — but only when the note hasn't been opened in 7+ days AND has linked overdue tasks. Prompt: *"This note has [N] overdue linked tasks. Write one sentence re-orienting the user."* Trigger frequency: at most once every 7 days per note. Cost: negligible at beta scale.

#### (c) Competitive Moat
- Bear has no task or event integration.[^12][^17]
- iA Writer is intentionally isolated from task/event data.[^18][^19]
- Obsidian's backlinks are manual and show *other notes*, not live work items.[^20][^21]
- Capacities links objects but has no live calendar/task status feed.[^22][^23]
- Mem's AI surfaces *related notes*, not *related live tasks and events*.[^24][^25]
- Notion has linking but requires you to build a relational schema first — the panel in productivity.do requires zero user setup.[^21][^26]
- The moat is the **bundle itself** — this feature is architecturally impossible for a single-pillar notes app to copy without building a calendar and task manager first.

#### (d) Bundle Composition
- The context panel IS the bundle, made visible. Every time a user opens a note and sees their live tasks and upcoming event, they understand why the three pillars belong together.
- The Time Ledger (Calendar) and the Estimation Intelligence (Tasks) both contribute data to the panel with zero additional work.

#### ❌ Do NOT build:
1. **Bi-directional graph view / knowledge graph** — Obsidian owns this definitively. It's a 2-year implementation for uncertain return; it attracts PKM hobbyists, not your prosumer target.[^20][^22]
2. **AI note summarization on open** — Mem does this, iA Writer does authorship coloring. You can't outspend either. The panel is more useful than a summary because it shows *live* data.[^18][^24]

***

## Build Order Recommendation

**Ship in this order:**

### 1. Tasks → Estimation Intelligence (Month 1, pre-launch)

**Why first:** It requires the smallest surface area change (one new column, two new UI elements, one query), creates the most immediately visceral "aha" moment ("it told me my day was going to blow up — and it was right"), and seeds the data that makes the Calendar and Notes stakes credible. Without `actual_minutes`, the Calendar Time Ledger is incomplete and the Notes context panel has no estimation callout.

**Minimum shippable version:** Record `actual_minutes` on completion. Show the day-capacity warning on Today view. Ship with a single accuracy badge ("You usually take ~2× your estimate on tasks labeled 'writing'"). No ML, no streaming, no AI call at launch.

### 2. Calendar → Time Ledger (Month 2)

**Why second:** Once `actual_minutes` exists for tasks and event durations exist for calendar blocks, the Ledger has real data. The 12-week sparkline is a powerful retention hook — users won't churn once they have 4+ weeks of history. This is also the feature most shareable to "productivity Twitter": a screenshot of your Time Ledger is inherently personal and interesting.

**Minimum shippable version:** The weekly view aggregation by color-tag category. The Δ column. A static summary sentence (Claude Haiku, cached per week — no need for streaming). Skip the 12-week sparkline at launch; ship it in week 2 of the month.

### 3. Notes → Live Context Panel (Month 3)

**Why third:** It depends on the cross-resource links you already have and on the task estimation data from Month 1. It's also the hardest to explain without a demo — users need to *feel* it, which means they need a note with a real linked task and a real linked event. By Month 3, beta users will have enough linked notes to appreciate it immediately.

**Minimum shippable version:** The linked event card and the live task rail only. Skip the estimation callout until Month 4 (let the data mature). Ship the collapse toggle on day 1 — some users will find it distracting before they understand it.

***

## Stake-to-Stake Composition (the bundle flywheel)

```
TASKS:  estimated_minutes ──────────────────────────────────────────────────────────────────────────┐
        actual_minutes (new) ────────────────────────────────────────────────────────────────────┐  │
                                                                                                 │  │
CALENDAR: event durations ──────────────────────────┐                                           │  │
          free-slot engine ──────────────────────────┤                                          │  │
          Time Ledger (planned vs actual by tag) ◄───┘◄──────────────────────────────────────── ┘  │
                                                                                                    │
NOTES: Live Context Panel ◄─────────── linked tasks (status, overdue) + linked events + ──────────┘
                                        estimation callout (ratio from actual/estimated)
```

Each pillar's stake produces data that makes the other two stakes *more* powerful. A single-pillar competitor cannot replicate this without building the entire stack.

---

## References

1. [The ONLY $57 Calendar App Worth Buying](https://www.youtube.com/watch?v=uw3OLWc6v0E) - Is a $57 calendar app really worth it in 2025? Let's dive deep into Fantastical, the premium calenda...

2. [Manage your time in 2025: Fantastical vs. Apple Calendar - Setapp](https://setapp.com/app-reviews/fantastical-vs-apple-calendar) - Fantastical vs. Apple Calendar: I compared features, pricing, and usability in 2025 to find the best...

3. [Cron: Pricing, Free Demo & Features - Software Finder](https://softwarefinder.com/collaboration-productivity-software/cron) - Cron, now Notion Calendar, is the next-generation Calendar Software built for professionals to bridg...

4. [Notion 2025: What to Expect? Exploring New Features and Strategic ...](https://www.simple.ink/blog/notion-2025-what-to-expect-exploring-new-features-and-strategic-directions) - ‍Derived from Cron's intuitive scheduling tools, Notion Calendar integrates advanced scheduling, sha...

5. [Vimcal & Vimcal EA Pricing | Calendar Software Plans](https://www.vimcal.com/pricing) - Vimcal is an ultra-fast personal calendar for founders, execs, and ICs. Vimcal EA is built specifica...

6. [Vimcal | Fastest Calendar for People with Too Many Meetings](https://www.vimcal.com) - The calendar for people with too many meetings. Vimcal is the world's fastest calendar, beautifully ...

7. [Vimcal EA's biggest feature drop of 2025 is here - LinkedIn](https://www.linkedin.com/posts/vimcal_vimcal-eas-biggest-feature-drop-of-2025-activity-7315741533993857025-T7qJ) - ... Calendar Audit feature, which lets you: Choose a custom date range to audit View all meetings an...

8. [Motion vs Reclaim vs Clockwise vs Akiflow vs Sunsama - Temporal](https://temporal.day/blog/motion-vs-reclaim-vs-clockwise-vs-akiflow-vs-sunsama) - A no-fluff comparison of the top AI calendar apps in 2026. What each one is actually good at, who it...

9. [Motion vs Sunsama vs Akiflow: Which Task Planner is Best?](https://blog.rivva.app/p/motion-vs-sunsama-vs-akiflow) - Motion automates your day. Sunsama guides intentional planning. Akiflow consolidates everything. See...

10. [Sunsama vs Akiflow: Which Should You Choose? | Efficient App](https://efficient.app/compare/sunsama-vs-akiflow) - Neither Akiflow nor Sunsama offers AI auto-scheduling. Both require you to manually time block every...

11. [Sunsama vs Motion Comparison: Which Tool is Better? (2026)](https://www.morgen.so/blog-posts/sunsama-vs-motion) - Can't decide between Sunsama vs Motion? Compare their features, pricing, and use cases to find the b...

12. [Bear: Typography-First Writing - Blake Crosley](https://blakecrosley.com/guides/design/bear) - How Bear's typography-first design won Apple Design Awards: nested tags, theme system, focus mode, a...

13. [Comparison Review: OmniFocus vs Things 3 - SaaS Battles](https://www.saasbattles.com/comparison-review-omnifocus-vs-things-3-saas-battle-insights/) - Task management applications play a crucial role in helping individuals and teams stay organized and...

14. [OmniFocus vs Things 3 for Power users | Decision Clarities](https://www.decisionclarities.com/compare/omnifocus-vs-things-3-for-power-user) - Constraint-based tool comparisons: X vs Y for a specific persona. Clear decision rules, not feature ...

15. [I built a task manager that tracks estimated time vs actual ... - Reddit](https://www.reddit.com/r/SideProject/comments/1s3xe0h/i_built_a_task_manager_that_tracks_estimated_time/) - I built a task manager that tracks estimated time vs actual time to help me get better at my estimat...

16. [Meet Bear Sans, the new (type)face of Bear](https://blog.bear.app/2023/08/learn-about-our-new-custom-font-bear-sans/) - Being a writing (and reading) app, we have quite a few users who care about how their text looks whi...

17. [Editor Typography Options - Bear App](https://bear.app/faq/typography-options/) - In the Sidebar → Settings → Typography Preference Panel, you can control various typographic aspects...

18. [iA Winterfest 2025 - iA Writer](https://ia.net/topics/ia-winterfest-2025) - In 2025 we won the Red Dot 'Best of Best' award, the Japan Stationery of the Year award and showed i...

19. [The Benchmark of Markdown Writing Apps - iA Writer](https://ia.net/writer) - iA Writer has fewer features, by design. But each one is intentional, built for focus, and made to h...

20. [Obsidian vs Logseq | Which Knowledge Management Tool is Better in 2025?](https://www.youtube.com/watch?v=lm3OAqimdPE) - Obsidian vs Logseq | Which Knowledge Management Tool is Better in 2025? We dive deep into their UIs,...

21. [Obsidian vs. Notion: Which is best? [2025] - Zapier](https://zapier.com/blog/obsidian-vs-notion/?msockid=324ad656aa53621e3e69c03baba763d3) - I spent weeks testing Notion and Obsidian to see how they stack up and which note-taking app is best...

22. [Tana vs Obsidian vs Capacities vs Logseq (2026)](https://www.youtube.com/watch?v=KYP9XBEcmMQ) - 📝 Tana vs Obsidian vs Capacities vs Logseq (2026) – Best Note-Taking & Knowledge Management App Comp...

23. [Capacities vs. Logseq: Which Obsidian alternative is better for you?](https://www.xda-developers.com/capacities-vs-logseq-which-obsidian-alternative-is-better-for-you/) - Escape from Obsidian without breaking a sweat

24. [Mem.ai Review & Guide: AI-Powered Note-Taking in 2026](https://productivitystack.io/guides/mem-ai-guide/) - A complete guide to Mem.ai — the AI note-taking app that organizes itself. Features, pricing, and wh...

25. [Mem AI Review 2026: Features, Pricing & Alternatives](https://summarizemeeting.com/en/app-reviews/mem-ai) - Mem AI represents a thoughtful approach to AI-powered note-taking, positioning itself as an AI thoug...

26. [Notion vs Obsidian in 2025: Which Note-Taking App Is Right for You?](https://www.productivity-stack.com/notion-vs-obsidian-2025) - Notion vs Obsidian compared in 2025 — features, privacy, pricing, and which is better for personal k...

