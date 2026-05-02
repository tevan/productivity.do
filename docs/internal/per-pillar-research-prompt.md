# Per-pillar research prompt

Research request for an LLM with web access (Perplexity, ChatGPT with browse,
Claude with web search, etc.). The goal is to identify, for each of
productivity.do's three pillars (Calendar, Tasks, Notes), the **one thing**
that would let it be honestly described as "the best [pillar] app for X kind
of user."

The product is a Svelte 5 SPA with Express backend, built solo, in private
beta, targeting prosumers who currently cobble together Cron + Todoist +
Calendly + Notion. Stack and capability inventory below; the question isn't
"what features should we add" but "what's the strongest opinionated stake
each pillar can plant?"

---

## The prompt

> I'm building a productivity app at productivity.do — Svelte 5 SPA, solo
> founder, private beta. It bundles three things: a Fantastical-class
> calendar, a Todoist-class task manager, and a notes app. Plus booking
> pages (Calendly), a public dev API, MCP server, Slack app, offline mode,
> and 12 real integrations.
>
> Today the bundle is the pitch. But bundles win only if each pillar is
> defensible on its own. I want to figure out, for each of the three
> pillars, the **single most defensible "best at X" stake** I should plant
> in the next 6 months — something that makes a user who only uses ONE of
> the three pillars say "this is the best [pillar] app for me because of X."
>
> Constraints:
>   - Solo founder. Whatever I pick has to be implementable + maintainable
>     by one person.
>   - I don't want feature parity. I want one signature thing per pillar
>     that's clearly mine. Like Linear's keyboard speed, Bear's typography,
>     Cron's command palette, Things' Today/Anytime/Someday rhythm.
>   - I already have the obvious table-stakes features (see capability
>     inventory below).
>   - I can ship deterministic SQL + small-LLM inference; I don't have ML
>     research budget.
>
> Capability inventory (already shipped):
>
> CALENDAR:
>   - Drag-to-move events (timed + all-day), drag-to-resize
>   - Full keyboard accessibility (WAI-ARIA grid pattern, roving tabindex,
>     keyboard move/resize/delete on focused event)
>   - Find a free time across multiple calendars
>   - Recurring events with instance/series/following scope semantics
>   - 5 color schemes with chip-text contrast computed against bg
>   - Optimistic drag patches (no flicker)
>   - Focus blocks rendered as soft band, treated as busy by auto-schedule
>   - Travel time blocks between consecutive events with locations
>   - Working location + OOO event types from Google Calendar
>   - Multi-cal merge for duplicate events
>   - Cmd+F event search
>   - CSV export
>   - ICS subscription feeds (read-only, RFC 5545 line folding)
>   - Per-event AI meeting prep via Claude Haiku
>   - Right-click context menu (duplicate, move-to-cal, hide, color, template)
>   - Tab-title badge with today's count
>   - Recurring task indicator
>   - Event drag horizontally on all-day row
>   - Drag tasks from sidebar onto a calendar day
>   - Color schemes (Classic/Vibrant/Pastel/Forest/Monochrome)
>   - Per-event timezone display
>   - Attendee response status chips
>   - PWA offline mode with SWR cache + IndexedDB write queue
>
> TASKS (Todoist-backed plus native):
>   - Kanban board with up to 5 custom columns
>   - Auto-schedule to next free slot (creates GCal event + Todoist due_datetime)
>   - Sub-tasks, labels, sections, projects, comments, recurrence
>   - Multi-select with shift-range and cmd-toggle, bulk actions
>   - Drag from sidebar to calendar day
>   - Productivity.do-only "estimated minutes" (not in Todoist)
>   - Per-user "auto-move late tasks to today" (sweeper + inline Move button)
>   - Local kanban status orthogonal to Todoist completion
>   - Filter by Focus / Inbox / Tasks / This Week / Next 7 / Scheduled / etc.
>   - Group by Date / Project / Label / Priority
>   - NL parser (Todoist quick-add)
>   - Email-to-task via Postmark inbound
>
> NOTES:
>   - Full markdown rendering (headings, lists, code, links, images, tables)
>   - Soft-delete with 30-day recovery, per-note revision history (90d)
>   - Author-only comments (overlay panel)
>   - Cross-resource links (note↔task, note↔event)
>   - Search-as-you-type (LIKE against title + body)
>   - Click-to-edit reader, Bear/Notes-style
>   - Pinned + archived states
>   - Color tags
>
> SYNTHESIS LAYER (cross-pillar — already shipped):
>   - /api/today: hero sentence + capacity gauge + slip-risk tasks
>   - /api/weekly-review: completion velocity vs baseline, stale + pushed
>   - /api/observations: pure-function observers ("Tuesdays have averaged
>     10 meetings — block focus time?")
>
> What I want from you:
>
> 1. For each pillar, name the SINGLE most defensible "best at" stake.
>    Should be specific (not "great UX" — something a user can describe
>    to a friend in one sentence).
>
> 2. For each stake, explain (a) the user persona who would care most,
>    (b) the smallest concrete feature that delivers it credibly, (c) the
>    competitive moat (what makes it hard to copy?), and (d) how it
>    composes with the other two pillars (a stake that hurts the bundle
>    is bad).
>
> 3. Specifically include Apple Notes, Bear, Things 3, Cron / Notion
>    Calendar, Fantastical, Akiflow, Sunsama, Motion, Reclaim, Linear,
>    Notion, Obsidian, iA Writer, Logseq, Capacities, Mem in your
>    competitive analysis. Where do they each plant their stake? What
>    seam between them is unclaimed?
>
> 4. Recommend the ORDER to build them — which pillar's stake should
>    ship first to maximize differentiation in the first month of
>    public launch?
>
> 5. For each, name 1-2 things I should NOT do — features that look
>    appealing but would dilute the stake or cost more to maintain than
>    they earn.
>
> Constraints on your answer:
>   - Don't recommend "AI-powered X" generically. If AI fits, name the
>     specific inference model + the specific moment it runs.
>   - Don't recommend "community" or "templates" — those are growth
>     surfaces, not pillar stakes.
>   - Be opinionated. I'd rather hear one strong recommendation per
>     pillar than five weak options.

---

## How to use the answer

Paste the response into a new file at `docs/internal/pillar-stakes.md`.
Then bring it back to me (Claude) and we'll evaluate which to ship first.

The point of going to a Perplexity-class model is the up-to-date competitive
research. Claude can reason about the trade-offs once we have the lay of the
land.
