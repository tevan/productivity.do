# Captured signals — what the app records, where, and why

**Date:** 2026-05-02
**Status:** Reference doc; update when adding a new signal-capturing feature.

This is the inventory of every structured signal productivity.do
captures from the user, where in the UI it gets captured, and why each
matters for the decision engine. It's the concrete answer to:

> "What does our app capture, and how?"

The strategic framing this document underwrites is captured in
`productivity-surface-strategy.md` ("Why connectors aren't enough —
and why the surface IS the moat") and the `surface_is_substrate_capture.md`
memory entry. Plain version: the surface looks like a calendar/tasks
app on purpose. The user gives us structured preferences by living in
the daily workflow. Those preferences are what make the ranker's
answer specific instead of generic. None of this is captured by AWS
Bedrock or Anthropic-direct integration with raw GCal/Todoist.

## Vocabulary cleanup

Earlier strategy docs used the word *substrate* loosely. Cleaner terms:

- **Surface** — what the user sees and clicks (calendar grid, kanban,
  notes editor, project page).
- **Captured signals** — what gets stored in our database when the
  user uses the surface. Sometimes called "structured preferences"
  or "structured signals."
- **Decision engine** — the ranker (`backend/lib/ranker.js`) that
  consumes captured signals to produce the next-action recommendation.

The word "substrate" is fine in casual conversation, but in docs and
memory we should prefer "captured signals" or "structured signals" —
clearer, less jargon, less mystical-sounding.

## Already capturing today

Every entry: what we capture, where in the UI the user provides it,
and why it matters for the ranker.

| Signal | Where the user gives it to us | Why it matters |
|---|---|---|
| **Project favorited** | Star icon next to a project in the sidebar | "I care more about this project than the others." Boosts every task in it via `favorite_boost`. |
| **Project pinned** | Pin button on the project page (cap of 3) | "These are my top 1-3 projects right now — show me their tasks first." Drives "pinned mode" in the TodayPanel. |
| **Project intent line** | One sentence at the top of the project page (e.g., "Ship the redesign by Friday") | Used to summarize *why* a project matters when ranking, especially in the weekly review and `summarize_project` MCP. |
| **Project due date** | Date picker on the project page | A project with a due date in 5 days outranks one with no deadline. `project_due_soon` weight in the ranker. |
| **Project rhythm** | Working-hour windows set per-project | "I work on this project Mon/Wed/Fri morning." Ranker honors via `in_rhythm` weight. |
| **Manual task ordering** | Drag tasks to reorder within a column | "I want this one before that one, regardless of due date." Stored in `tasks_cache.local_position`. |
| **Manual project ordering** | Drag projects to reorder in the sidebar | "First project = primary; last = vestigial." Cheapest priority signal we have. `project_position_weight`. |
| **Task priority** | P1/P2/P3/P4 picker in task editor | Direct boost to score (`priority_weight`). Mirrored from Todoist. |
| **Task estimated minutes** | Number field in task editor | Lets us match tasks to free time slots — "you have 50 min, this task is 90, pick a different one." Drives `estimation_fit`. |
| **Task completed** | Checkmark | Builds completion history per project (the momentum signal — moving/stalled/idle). |
| **Focus blocks** | Settings → Focus Blocks (per-day windows) | "9-11am Mon = creative work, no admin." Ranker won't suggest admin tasks during creative blocks. |
| **Calendar visibility toggles** | Eye icon next to each calendar in the sidebar | Tells us which calendars are "real work" vs. ambient (e.g., holiday calendar). |
| **Working hours** | Settings → Work Hours | "Don't suggest tasks at 9pm." Used by `findFreeSlots` and the ranker. |
| **Task completion timing** | Implicit — when the user checked it off | Estimation accuracy: did they finish a 30-min task in 25 or 90? Compounds over time. |
| **Note attachment to a project** | Project field on the note | "This research note belongs to the Q3 project." Surfaces in project context. |
| **Event linked to a task** | "Link" field on event | "This meeting prep is for that task." Surfaces in the next-thing surface as related material. |
| **File attached to event/task/note** | Drag-drop or paste in editors | "This doc is relevant when ranking this thing." Will compound when files-done-well ships. |
| **Color scheme + theme** | Settings → Appearance | Personal taste; not used by ranker but reinforces the "this is my home" feeling. |
| **Color of an event/calendar** | Calendar settings + event editor | Visual scaffolding the user imposes; signals which calendars are which kind of work. |
| **Hidden events** | Right-click event → Hide | "This event is noise to me." Filtered out of decision surfaces. |
| **Subscribed (read-only) calendars** | Settings → Subscribed Calendars | "These are real but I can't edit them." Counted as busy time. |
| **Notification preferences** | Settings → Notifications | When the user wants to be poked. |
| **Sidebar section visibility** | Settings → Sidebar | Which features they want surfaced. |

## What's coming with the four investments

These signals don't exist yet but will be captured by the load-bearing
investments in the strategy doc.

| Signal | Where the user gives it (planned) | What it unlocks |
|---|---|---|
| **Files unified across pillars** | One file picker, drag-drop into events/tasks/notes via the same mechanism | When ranking a meeting, we can show "the doc Sara sent" alongside the title. The same file threading across event/task/note becomes the connective tissue for the cross-pillar timeline. |
| **Cross-pillar links** | Auto-derived when files/projects/notes touch the same thing | "This file appears in 3 things — here's where" timeline view. |
| **Voice routing classifications** | User speaks → preview card → user accepts/rejects | The accept/reject signal can train the next routing pass (when did we get it right? when did we miss?). |
| **"Start" clicks on the next-thing surface** | Implicit — user pressed Start on a recommendation | Validates ranking. If the user always skips our top recommendation, we learn the ranker is wrong for them. |
| **"x" dismissals on the next-thing surface** | Small dismiss button on a recommendation | "Don't suggest this kind of thing again right now." |
| **Re-rank requests** | "Show me something else" button | Implicit signal that the current top isn't right for this moment. |

## What's NOT captured (and shouldn't be)

Both for privacy and product clarity. These are deliberately
off-limits, even though competitors ship them.

- **Always-on listening.** Push-to-talk only. No background mic. No
  wake words.
- **Screen recording / OCR / Recall-style capture.** Microsoft tried,
  got burned. We don't.
- **Reading user emails to extract things.** Email-to-task is opt-in
  via a forwarding address; we don't ingest inboxes.
- **Tracking which other apps they have open.** Not a concept in our
  product.
- **"AI watches you work."** Capture is intentional acts the user
  performs, not surveillance.
- **Tab/browser activity.** Not relevant; not captured.
- **Mouse / keystroke / dwell-time analytics.** Not captured beyond
  what's needed for the optimistic-drag pattern (which is local-only).
- **The user's location.** Not captured. Calendar event location is
  user-provided text; we don't geolocate.

This isn't paranoia — it's strategy. The "AI watches everything"
approach is contested (Recall, Limitless, Rewind all face friction).
The "user gives us structured signals via the workflow they already
do" approach is uncontested and comfortable.

## The honest comparison

A user just connecting GCal + Todoist to ChatGPT gives ChatGPT:

- Events with titles, times, attendees.
- Tasks with titles, priorities, due dates, projects.

A user using productivity.do for 60 days gives our ranker
**additionally**:

- Which 3 projects they care about most this week (pins).
- A one-sentence intent for each project.
- Manual ordering within each project.
- Estimation accuracy (do their 30-min tasks usually run 30 or 90?).
- Focus-block boundaries.
- Project momentum (active vs. stalled).
- Files that connect across multiple things.
- A history of which recommendations they took vs. skipped.
- Working-hour rhythms per project.
- Hidden / dismissed events.
- Their preferred sidebar configuration (which signals they want
  surfaced).

That extra layer is what makes the difference between a generic answer
("focus on a high-priority task today") and a specific one ("In your
9-11am creative block, your top-pinned project's intent says 'ship
the redesign by Friday' — the spec doc is here, three open questions
are still unresolved. Start there.").

## How this doc maps to other strategy docs

- `productivity-surface-strategy.md` — *why* the surface captures
  these signals (the strategic framing).
- `decision-surface-pattern.md` — *what kind of pattern* this is
  (and which other verticals it generalizes to).
- `end-state-vision.md` — *what the user sees* once these signals
  feed the next-thing surface.
- `ai-cost-architecture.md` — *what runs against these signals*
  (deterministic ranker, not LLMs).
- **This doc** — *what specifically gets captured, and where.*

## When to update this doc

- New feature ships that captures a structured signal → add a row.
- Existing feature changes how it captures signal → update the row.
- A signal stops being used by the ranker → strike-through with a
  date, don't delete (the history matters for understanding why we
  captured it).
- Privacy posture changes → update the "What's NOT captured" section
  with reasoning.

## Anti-patterns this doc resists

- **"Let's just have an LLM analyze their data and figure out
  preferences."** No — preferences the user expressed explicitly are
  a stronger signal than guesses, and they don't drift. Stay with
  intentional capture.
- **"Let's add a 'priority' field to projects."** Already covered by
  pin + favorite + manual ordering + due date. Adding a fifth signal
  is Notion-database trap.
- **"Let's automatically infer project priority from completion
  recency."** We already do this in the ranker. Don't show it back
  to the user — they'll game it.
- **"Let's track time spent in each app."** Crosses into
  surveillance. Not captured.
