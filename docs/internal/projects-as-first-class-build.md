# Projects-as-first-class — build plan

**Decision date:** 2026-05-02
**Decided by:** owner conversation, captured in `docs/internal/productivity-surface-strategy.md`
**Status:** Tiers A + B + C all shipped, 2026-05-02 (afternoon)
**Related strategy doc:** `productivity-surface-strategy.md` — section "On task project metadata as a priority signal"

This document is the canonical build tracker for the projects-as-first-class
work. Update status fields as work lands. If a conversation summary loses
context, this doc plus the strategy doc are enough to resume.

## Why this work exists

Owner observation: "I want to leverage task projects more. That will help
influence decisions." Projects today are a labeled bucket for tasks
(Todoist's bare metadata: name, color, favorite, sort order, parent). To
let projects influence decisions in the "what should I do right now"
surface, we need (a) more signal per project and (b) a real destination
when a project is the focal thing.

Done in a way that explicitly avoids the Notion-database trap: no custom
fields per project, no formulas, no rollups, no per-project property
schema. Five additions, each minimal:

1. Project as a first-class destination (not just a filter)
2. Project momentum signal (derived, no schema)
3. Project intent line (one optional sentence: "what does done look like")
4. Project rhythm (per-project working windows)
5. Project pin/unpin to the decision surface (1-3 pinned)

Plus, added in same conversation:
6. Project due date

## Storage decision

Single new local table, source-agnostic project IDs. Todoist projects use
their string ID; native projects use `native:<int>` form.

```sql
CREATE TABLE IF NOT EXISTS project_meta (
  user_id      INTEGER NOT NULL,
  project_id   TEXT NOT NULL,
  due_date     TEXT,            -- YYYY-MM-DD, optional
  intent_line  TEXT,            -- one-line "what does done look like"
  rhythm_json  TEXT,            -- {mon:[{start,end}], tue:[...], ...}
  pinned_at    TEXT,            -- non-null = pinned to decision surface
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, project_id)
);
```

Momentum (`moving|stalled|idle`) is **derived**, not stored — pure SQL on
`tasks_cache.completed_at` + open task counts. No drift risk.

## Ranker contract

`backend/lib/ranker.js` — pure function, no DB access of its own; takes
already-fetched data and returns scored tasks.

Two modes:

- **Default mode** (no pins): score uses all six signals.
  ```
  score = due_urgency      // overdue >> due today >> later
        + priority_weight  // task.priority 1..4
        + favorite_boost   // project.is_favorite
        + project_position // project.order from Todoist sidebar
        + recency_weight   // project_last_completed_at within 7d
        + estimation_fit   // estimated_minutes vs free_minutes_now
  ```
- **Pinned mode** (1-3 projects pinned): filter to pinned project IDs
  first, then score with `project_position` term zeroed (everyone's
  pinned, no relative position to weigh).

Project due date acts as a multiplier on `due_urgency` for every task in
the project — proximity to project deadline pulls *all* its tasks
forward, not just tasks with their own due dates.

Project rhythm acts as a boost during the matching window: if the user is
in their declared "Tuesday afternoon" window for project X, tasks in X
get +1 score equivalent.

## Build tiers

Tier A first; evaluate; then B; voice (C) is independent.

### Tier A — substrate (3-4 days)

Goal: project-as-destination working end-to-end with real data, ranker
respecting projects, no fancy editing UI.

| # | Task | Status | Notes |
|---|------|--------|-------|
| A1 | `project_meta` table + applyMigrations | ✅ Done | One CREATE TABLE in `backend/db/init.js` |
| A2 | `GET /api/project-meta` (all rows for user) | ✅ Done | Used by ranker + project page |
| A3 | `PUT /api/project-meta/:projectId` (upsert) | ✅ Done | Body: `{dueDate?, intentLine?, rhythm?, pinned?}` — pin cap 3 enforced |
| A4 | Momentum derivation in `backend/lib/projects.js` | ✅ Done | `getProjectMomentum(userId)` returns Map<projectId, …> |
| A5 | `backend/lib/ranker.js` pure function | ✅ Done | Default + pinned modes; per-task scoreReasons surfaced |
| A6 | Wire ranker into `/api/today` | ✅ Done | `ranked[]` alongside `tasks[]`; rankerMode + pinnedProjectIds in response |
| A7 | New SPA route `/projects/:id` (lazy) | ✅ Done | routeStore + App.svelte branch + server.js bypass |
| A8 | `ProjectPage.svelte` — minimal | ✅ Done | Includes inline edits for intent + due date + rhythm |
| A9 | `GET /api/projects/:id/context` | ✅ Done | tasks + linked events + linked notes + timeSpent + momentum |
| A10 | Sidebar project entries → project page link | ✅ Done | chevron opens page; right-click menu for Pin/Open page |

### Tier B — polish + decision-surface integration (3-4 days)

| # | Task | Status | Notes |
|---|------|--------|-------|
| B1 | Pin/unpin UI in sidebar (right-click) | ✅ Done | Cap 3 pinned enforced server-side |
| B2 | Pinned-mode badge on TodayPanel | ✅ Done | Inline 'focus'/'show all' toggle next to Today meta |
| B3 | Inline intent-line editor on ProjectPage | ✅ Done | Click-to-edit, Enter to commit, Esc to cancel |
| B4 | Inline due-date editor on ProjectPage | ✅ Done | Native date picker + clear button |
| B5 | Rhythm UI on ProjectPage | ✅ Done | Per-weekday windows; ranker honors them in `isInRhythm` |
| B6 | Due-date countdown style (color-shifts as it nears) | ✅ Done | Green > 14d, amber > 3d, red ≤ 3d, overdue red |
| B7 | Weekly review references intent line | ✅ Done | New stagnantProjects payload + project_intent_stagnant headline |

### Tier C — voice (3-5 days, independent)

Two surfaces from the strategy doc's voice section:

| # | Task | Status | Notes |
|---|------|--------|-------|
| C1 | `/api/voice/transcribe` route — Whisper passthrough | ✅ Done | Multipart in, plain text out. 25MB cap. 503 if OPENAI_API_KEY missing. |
| C2 | `/api/voice/route` — capture router | ✅ Done | Claude Haiku classifier (task/event/note/comment/unsure) + structured fields. JSON-only response, tolerant parsing. |
| C3 | Voice button on TodayPanel | ✅ Done | VoiceCapture component in head-actions; preview modal lets user confirm before creating |
| C4 | Voice capture button on the main toolbar | ✅ Done | Same VoiceCapture component, mounted next to search button |
| C5 | MCP tool surface expansion | ✅ Done | New tools: list_pinned_projects, set_project_pin, get_project_context. New resource: productivity://decisions. |

Build order: C1 first (substrate). C3 + C4 in parallel. C2 wraps C4. C5 is independent and can ship anytime.

## Anti-patterns to watch for as we build

- **Per-project custom fields beyond what's listed.** If a charter user
  asks "can I add `client_name` per project," the answer is no — that's
  the Notion-database trap.
- **Project deadlines drifting into milestones, Gantt, burndown.**
  Project due date is a single field. Multiple due dates = milestones =
  out of scope.
- **Momentum trying to predict.** Momentum is observation only. If we
  start saying "this project is at risk of going stalled," we're in
  the predictive-insights territory we already demoted.
- **AI-guessing intent line.** When the field is empty, leave it empty.
  Don't infer it from project name + recent tasks. Empty is honest.

## Open questions

- **Where does pin live in storage** — `project_meta.pinned_at` or
  `users.pinned_project_ids` JSON column? Going with `pinned_at` per-row
  because (a) it composes naturally with the rest of the project_meta
  data, (b) lets us show "pinned since N days" if useful later, (c) no
  JSON-array-mutation hassle. Cap of 3 enforced at write time.
- **Sidebar click — page or filter?** Plan: project name → page; small
  filter icon → keeps existing filter-tasks behavior. Right-click adds
  pin/unpin. Re-evaluate after Tier A use.
- **Native projects vs Todoist projects** — both supported via the
  `native:<int>` ID convention. Todoist projects always present (mirror);
  native projects only present when no Todoist token configured.

## Final status — 2026-05-02

**All three tiers shipped end-to-end.** Commit chain on `main`:

- `c7cfbea` — Tier A substrate (schema, ranker, /api/today wiring, project page, sidebar)
- `019c23c` — strategy doc + Time Ledger filter (separate work)
- `6c8a80d` — Tier B (intent + due-date + rhythm editors), Tier C voice, weekly-review B7
- `f74cfae` — Tier C5 MCP expansion, weekly-review string fix

What works without setup:
- Project page at `/projects/:id` — momentum dot, due-date countdown, intent
  line, rhythm editor, pin button, tasks list, linked events, linked notes
- Right-click on a sidebar project → Pin/Unpin or Open project page
- Decision ranker in `/api/today` — composite score, scoreReasons array
- Pinned-mode toggle in TodayPanel header
- Weekly review surfaces stagnant intent projects
- MCP tools: list_pinned_projects, set_project_pin, get_project_context

What needs API keys to activate:
- Voice transcribe — `OPENAI_API_KEY` (Whisper)
- Voice route classifier — `ANTHROPIC_API_KEY` (Claude Haiku)
- Both already on the LAUNCH-CHECKLIST. UI hides itself when keys absent.

Open follow-ups (not blocking):
- Voice "decision mode" (mode=decision in VoiceCapture) currently just
  returns the transcript. Could pipe through /api/voice/route to act on
  spoken intent (e.g., "show me only pinned").
- The ranker scoreReasons array isn't surfaced in the UI yet. A small
  "why?" pill on each ranked task would expose the explainability we
  already compute.
- The project-page "linked events" query is heuristic. As the timeline
  surface lands, that should consolidate.

## Resume-after-compact instructions

If a future Claude session inherits this work mid-stream:

1. Read this doc top-to-bottom.
2. Read `docs/internal/productivity-surface-strategy.md` — sections
   "On task project metadata as a priority signal" and "Voice."
3. Check the status table above. The first ⏳ Pending row is the next
   thing to ship.
4. Ranker design is the load-bearing piece; if any signal weight needs
   tuning, do it in `backend/lib/ranker.js` and update the contract
   section above to reflect the change.
5. Don't add to scope without a conversation. The strategy doc anti-
   patterns and the "Anti-patterns to watch for as we build" section
   above are both binding.
