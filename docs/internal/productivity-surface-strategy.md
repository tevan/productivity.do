# Productivity surface — strategy & moat thinking

**Date:** 2026-05-02
**Decision:** build "the productivity surface," not "a useful productivity app."
**Source:** open conversation between owner and Claude, 2026-05-02 (afternoon).

This document is the strategic anchor for which features we build, and which
we deliberately don't, over the next 6-12 months. It supersedes the framing
in `pillar-stakes` and the per-pillar Perplexity research where they conflict —
that earlier work assumed users would feed the data flywheel consistently.
Most won't. The framing here doesn't depend on that assumption.

## The honest pushback that triggered this

The owner challenged the synthesis-layer + pillar-stakes thesis on three
specific grounds. They're right about all three; they need to be the
*default* lens we apply going forward.

1. **People use calendars and tasks too differently for aggregate insights
   to land.** Some people block focus time with creative event names; some
   pad meetings with buffers; some live in long-horizon tasks with no due
   dates; some live in "today only." Estimation ratios, time-ledger deltas,
   and meeting-density observations all assume a baseline use pattern that
   most users won't share. The data flywheel was designed to spin only if
   users feed it the way we expected. Most don't.

2. **Simplicity is not a moat.** Bear, iA Writer, and Things prove that
   "simple done well" gets cloned within 18 months of getting traction.
   Less surface is good for users; it's not, by itself, defensible.

3. **The case against Notion is bloat — but bloat is also Notion's value.**
   Their database (properties, formulas, relations, rollups, views) is the
   real product. We can't out-flexible them, and we shouldn't try.

The constructive observation that came out of the same conversation: Notion
is terrible at *time*. Their calendar is an afterthought, their reminders
are weak, their task UX is so generic that templates are required to be
functional. That's the wedge.

## What we're NOT building

To stay non-Notion, we explicitly skip:

- **Custom databases / properties / formulas.** Even if users ask. The
  moment we ship "create a custom property on a task," we are competing
  with Notion on their strongest surface. The answer is "use Notion for
  that and link it here."
- **Projects as a top-level pillar.** Tasks already carry a `project_name`
  via Todoist mirroring (and we surface it in groupings, sidebar, and the
  task editor). Promoting projects to a fourth pillar with their own page,
  views, and dashboards is the slope toward Notion. Projects matter as
  *grouping metadata*, not as a surface.
- **Email.** Noise that doesn't pay rent. Email-to-task already exists for
  the narrow inbound case; we don't open the broader inbox.
- **A wiki / docs surface.** Notes are notes, not pages with sub-pages.
  Hierarchy makes the product feel like Notion within a week.
- **Insight dashboards as primary surfaces.** Time Ledger and Estimation
  Intelligence stay shipped — they're interesting, and the SQL is cheap —
  but they don't get more screen real estate, and they don't go on the
  marketing site as the headline pitch. They are second-screen artifacts.

## What we ARE building (the moat shape)

Three load-bearing investments. Each is concrete, demonstrable in under 60
seconds, and gets *more* valuable with use without requiring the user to
adopt a new behavior.

### 1. Files done well — unified attachments across the three pillars

The competitive observation: Google Calendar only allows Drive attachments;
Todoist's are clunky; Notion's are buried under blocks; Apple Notes hides
them. Cron and Notion Calendar handle this slightly better but neither
treats files as first-class.

What we ship:

- One file picker. One file storage. Files attach to events, tasks, AND
  notes via the same mechanism. The same file can thread across all three
  (the spec doc on the meeting, the spec doc on the prep task, the spec
  doc on the meeting notes — once).
- Drag-drop into any of the three editors. Paste-from-clipboard. Click-to-attach.
- Local-first storage with a per-user quota; large files held by reference
  (Drive / Dropbox / OneDrive) for users who already have them there.
- A per-file "appears in" rail showing every event/task/note that
  references it — the file's own context panel, mirroring the Live Context
  Panel pattern we already shipped for notes.

This isn't a moat by itself. It's a strong, demonstrable reason-to-switch.
The moat compounds when files become the connective tissue between the
other two investments.

### 2. The "what should I do right now" surface

The behavioral lock-in. Not insights, not aggregates, not framed sentences.
Given everything on the user's plate (calendar, tasks, attached files,
recent notes), surface *the single next thing* with one click to start.

Implementation discipline:

- Deterministic ranking. No ML at the decision moment. Inputs: due dates,
  current calendar block, focus blocks, in-progress task status, last-touched
  resource. The ranker is auditable and explainable in one sentence per
  ranked item ("In a focus block until 11am — your highest-priority task
  due today is X. Click to begin.").
- One-click to commit. The verb depends on the resource: "Start" creates a
  GCal event right now and opens the task. "Open" jumps to the linked
  meeting prep. "Resume" returns to the in-progress note.
- Hotkey: `space` from anywhere → reveal it. Keyboard-first.
- This becomes the homepage replacement on small screens — phone in pocket,
  tap, see the answer, do.

The lock-in isn't the data; it's the muscle memory. Once "open
productivity.do → see the answer → act" is the workflow, switching cost is
the workflow itself.

### 3. The cross-pillar timeline

Every event, task, note, file, comment, edit becomes a row on a unified
per-day and per-project timeline. Notion can't do this because their data
model is page-centric. Todoist can't because they only have tasks. Apple
Notes can't because nothing else is in Apple Notes.

Two views:

- **Per-day timeline.** Top of TodayPanel and as a standalone surface.
  "On 2026-05-02 you completed 4 tasks, attended 2 meetings, edited 3
  notes, attached 1 file." Each row is the resource itself, clickable
  back to the full view.
- **Per-project timeline.** Filtered by `project_name` (which we already
  have via Todoist) — pulls every linked event, task, note, and file in
  chronological order. This is the answer to "tasks need to mean something
  to be useful" without needing a top-level Projects pillar.

Cheap to build (we already have `revisions`, `links`, `tasks_cache`,
`events_cache`, and the per-resource activity log). Deterministic SQL. No
ML. Compounds with use without asking the user to do anything different.

### Why these three together

They reinforce each other.

- The "what should I do" surface needs files to expose attached prep
  material when ranking a task or meeting.
- The cross-pillar timeline needs files to be a row type, otherwise the
  timeline is incomplete.
- Files done well needs the timeline to make their *connectedness* visible
  ("this file appears in 4 things — here's where").

A competitor cloning one of the three doesn't get the value. They have to
clone all three, and at that point they've copied the product.

## On projects (the question raised in the same conversation)

Owner observed: "tasks in isolation are hard to see how they matter. The
case for projects is tasks meaning something."

Resolution: **we already have projects, via Todoist mirroring.** Tasks
carry `project_name`. The sidebar groups by project. The board view filters
by project. The task editor exposes the project field. We surface project
name on the synthesis Live Context Panel.

What we should add (cheap, in scope):

- Filtered cross-pillar timeline by project (the per-project view above).
- Project as a filter / chip across the unified search (Cmd+F).
- Project shown alongside each task and event in the "what should I do
  right now" surface so the user knows *which project* a candidate
  belongs to.

What we should NOT add (out of scope):

- A `/projects` route with a project page per project.
- Project dashboards, project-level metrics, project-level docs.
- A project create/edit UI separate from Todoist's. (Todoist is
  authoritative for project metadata. We surface, we don't own.)

## On the AI-leverage advantage

Owner identified: as a one-person AI-native team, you can ship things at a
speed competitors can't match. This is real, but only matters if it shows
up as something users *feel*. Not "we use AI" features — features that
nobody else can build at your speed because you have AI-leverage.

Concrete plays for this advantage:

- **One-shot importers.** Notion → productivity.do, Asana → productivity.do,
  Roam → productivity.do, Obsidian → productivity.do. Each is ~4 hours
  with Claude. Each is a competitive blocker against the source tool.
  Switching cost goes from "rebuild from scratch" to "paste your export."
- **Adapter speed.** When a charter user asks "can it talk to X," the
  answer is yes within a week. Not a stub — a real adapter. The 102-row
  catalog already exists; promoting stubs to stable is the bottleneck.
- **Bug-fix and polish velocity.** Owner ships fixes the same hour they're
  reported. This is invisible until it isn't — a charter user notices "I
  reported this at 10am and saw it in the next deploy" and tells one
  other person.

These are not moats by themselves. They are *trust* signals — the kind
that compound when a small group of users tells the next group.

## Exit framing (acknowledged but not load-bearing)

Owner wants $20-50k+ as a possible outcome. Acquirers at that band buy
distribution and tech, not philosophy. So the moat work above is *not*
contingent on the exit number. The exit number is contingent on having
paying users and showing 6+ months of growth, which is its own track.

Stretch target ($300k+ band) requires an actual product moat. The three
investments above are aimed at that band; the $20-50k band is reachable
without them. Building toward the higher target dominates the lower one
(everything that moves toward a moat also moves toward MRR).

## Implementation order

1. **Files done well** (4-6 weeks). Concrete, demonstrable, smallest
   surface. Single-user storage first; multi-user / shared file ACLs later.
2. **The "what should I do right now" surface** (2-3 weeks once files
   exist). Deterministic ranker, one-click commit, hotkey. Reuses the
   synthesis store + the Live Context Panel patterns.
3. **The cross-pillar timeline** (3-4 weeks). Per-day first (cheap, the
   data is already there). Per-project second.

Estimation Intelligence and Time Ledger stay shipped but stop getting
investment. The Live Context Panel keeps getting investment because it's
the only one of the three pillar stakes that's an everyday surface.

## What this changes about previously-shipped work

- **Synthesis panel (Y key).** Stays. But the Today section becomes the
  primary surface; Time Ledger and Patterns sections don't get marketing
  emphasis. Today section evolves toward "the next thing" — section #2
  above will eventually displace the current "load gauge + plate" framing.
- **Pillar-stakes thesis** (`pillar-stakes` memory + `synthesis-layer.md`).
  Demoted from "the moat" to "interesting features." The actual moat is
  the three investments in this document.
- **Marketing site copy.** When we update it, lead with *files unified
  across calendar/tasks/notes* and *the next thing surface*. Don't lead
  with insights, ratios, or aggregations.

## Anti-pattern to watch for

The slope toward Notion. Every time we're tempted to add "and you can
configure X per project" or "and you can have sub-Y inside Z" — that's the
slope. The answer is no, even if a user asks. The flexibility we offer is
**flexibility about time**, not flexibility about structure. Notion owns
structure. We own time.

## Ideas under consideration (not load-bearing yet)

These came up during the same 2026-05-02 conversation. They aren't part of
the three primary investments above, but they're aligned with the
"productivity surface" thesis enough to keep on the list. Re-evaluate after
files / next-thing / timeline ship.

### Importable workflow files (community contribution, no marketplace)

Owner asked: how do we get the community contributing things others want?

The Notion-style answer (host a template gallery with browsing, ratings,
forks) is wrong for us. Marketplace overhead requires moderation, abuse
prevention, hosted content, search, and an active user base big enough to
populate the long tail. With <100 charter users it would be an empty
storefront making the product look smaller, not bigger.

The narrow version that *is* worth shipping: a portable file format —
`.productivity.json` or similar — that bundles event templates, focus
blocks, booking-page config, kanban columns, and project structure into a
single artifact. Anyone can email / Slack / tweet one to anyone else.
Click → preview → import. Distribution happens outside our product; we
own the format and the importer/exporter. No hosted content, no
moderation surface, no marketplace.

Three force-multiplying side effects:

1. **AI-leverage compounds.** Claude (or any LLM) can generate these
   files from a prose description: "give me a setup for a freelance
   designer with 3 clients." The LLM *becomes* the marketplace without us
   hosting one. Users prompt their way to a setup; we provide the format
   and the import path.
2. **Pairs naturally with files done well.** A workflow file is itself a
   file. Attach to a note titled "Onboarding pack for new hires," share
   the note's link. The unified-files investment carries this.
3. **Optional curated tail.** If we want a small starter gallery later,
   it lives as 10-20 files in `docs/templates/` linked from the marketing
   site. Curated by owner. No DB, no UGC, no moderation, no abuse
   surface.

Build cost: 1-2 weeks once files-done-well exists. Don't build before then;
the format is more valuable when files are first-class.

### In-product automations ("if X, then Y")

Owner asked: a setting that says "every time I add a note, attach it to
a day" or similar internal/external rules. Out of scope for the three
primary investments but worth thinking about as a *layer* on top of them.

The framing that makes this fit our strategy without becoming
Zapier-shaped: **automations are deterministic rules that run on
events emitted by the existing data model — they don't introduce new
schema, they don't add new pillars, and they don't open the surface
to user-authored code.**

Two tiers we could ship and stop:

1. **A small fixed catalog of opinionated rules** (one toggle each, no
   builder UI). Examples that match the way we already think about the
   product:
   - "Auto-attach new notes to today's date"
   - "When I move a task to 'In Progress' on the board, create a focus
     block on my calendar for its estimated time"
   - "When a meeting ends, prompt me to attach a note"
   - "When a task gets a new comment, bump it to the top of its column"
   - "When I complete the last task in a project, ask if the project is
     done"

   These are decisions WE make about how the surface should behave. The
   user opts each one on or off. No DSL, no conditions UI, no debugging
   experience to support. Each rule is one if-statement in code, and
   each only ships if it survives the "would I actually use this?" bar.

2. **External-side hooks via the existing webhook surface.** We already
   have outbound webhooks (`/api/webhooks`) emitting `task.created`,
   `event.created`, `booking.created`, etc. with HMAC-signed payloads and
   retry queues. Anyone wiring Zapier, Make, or n8n already has the path.
   We don't need to build a Zapier clone — we ARE the source of truth
   they integrate with. Documenting this better is the work, not adding
   more infra.

What we should NOT build:

- A general-purpose rule builder UI (conditions, branches, transforms).
  That's Zapier's terrain. Same trap as the Notion-database trap: their
  product, our liability.
- User-authored JS / formulas. Sandboxing pain, support burden, and we
  lose the ability to evolve the data model freely.
- Cron / scheduled rules. The opinionated catalog covers the cases we
  want; cron is the slope toward Zapier.

Build order: revisit AFTER the three primary investments ship. The
opinionated catalog is the small one (1-2 weeks). Webhook docs upgrade is
its own ~1-day pass.

## Next-decision triggers

Re-open this strategy when ANY of:

- A charter user describes the product as "a lighter Notion" — that's a
  signal we've drifted.
- An acquirer offer comes in below the $20-50k floor — adjust the moat
  investment vs. exit-prep balance.
- The "what should I do right now" surface fails A/B against the current
  Today panel after 30 days — the moat thesis is wrong and we revisit.
- Someone ships unified-files in a way that beats us before we ship —
  rare but possible; if Linear or Cron does it, we have a different
  problem.
