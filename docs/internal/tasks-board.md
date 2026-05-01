# Tasks board (kanban) + view persistence

**Date:** 2026-04-30
**Status:** Designed; not yet implemented

## Why this doc

The Tasks holistic view today renders a 4-column priority board (P1/P2/P3/None)
and a list view. We're rebuilding the board into a true kanban with user-
named columns mapped to a "status" concept that Todoist itself doesn't expose.

This doc captures the model so future-us doesn't relitigate the trade-offs
(especially around Todoist sync semantics and how we avoid clobbering the
user's data in their other Todoist clients).

## The core question: where does "in progress" live?

Todoist has exactly two task states: open or completed. There's no native
"doing" / "blocked" / "review" field. So a multi-column kanban needs that
state stored *somewhere*. Options we considered:

1. **Todoist labels** (`@in-progress`). Visible everywhere, syncs both ways.
   Rejected: clutters every Todoist client's label list and pollutes the
   per-task chip with internal-state pills. Bad citizenship across clients.
2. **Hijack the priority field**. Rejected: priority means priority.
3. **Local-only metadata.** Picked. We store status in our SQLite; Todoist
   sees only open/closed. Decoupled.

## The model

### Statuses

Two open-task statuses we own:

- `todo` — the default for any open task we haven't seen on the board yet
- `in_progress` — set when the user drags a card into the In Progress column

`done` is NOT a status we store. **Done = Todoist completed.** When a task
gets `completed=true` in Todoist (from any client), it auto-renders in our
Done column. When it's reopened in Todoist, it returns to whichever local
status it had (or `todo` if we lost track).

This means we never own a writable "done" state. There's nothing to sync up
to Todoist for "completion" — the user marks it done in our UI, we call
Todoist's complete endpoint, and the task moves to Done because Todoist now
says completed.

### Conflict resolution

Because we own `local_status` exclusively and Todoist owns everything else,
**there is no real conflict surface**. Concretely:

- User completes a task on Todoist mobile while it sits in our In Progress
  column → next sync, Todoist says completed=true → we render it in Done.
  Todoist wins because completion is Todoist's domain. No merge needed.
- User edits a title in Todoist while we have a stale cache → next sync we
  refresh from Todoist. We never let users edit titles offline so there's
  no client-side write to merge.
- User drags a card on desktop A while desktop B is also open → both write
  `local_status` to our backend. Last-write-wins on the row's `updated_at`.
  Acceptable — the staleness window is short and the field's intent is
  user-visible state, not transactional data.

We deliberately did NOT implement field-level vector clocks or CRDTs.
Productivity-app sync rarely needs them; the surface area where two writers
race on the same field is tiny.

## Schema

```sql
ALTER TABLE tasks_cache ADD COLUMN local_status TEXT;     -- 'todo' | 'in_progress' | NULL
ALTER TABLE tasks_cache ADD COLUMN local_position INTEGER; -- manual sort within column

CREATE TABLE task_columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  position INTEGER NOT NULL,        -- left-to-right order
  name TEXT NOT NULL,                -- display name; user can rename freely
  status_key TEXT NOT NULL,          -- 'todo' | 'in_progress' | 'done' (stable)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, status_key)
);
```

**Why `status_key` separate from `name`:** the user can rename "In Progress"
to "WIP" or "Doing" without breaking the underlying mapping. The key stays
`in_progress` forever; the name is just a label.

**Default columns** seeded on first board open:

| position | name        | status_key    |
|---------:|-------------|---------------|
| 0        | To Do       | `todo`        |
| 1        | In Progress | `in_progress` |
| 2        | Done        | `done`        |

The Done column reads from Todoist's `completed` flag (last 14d window to
keep it bounded), not from `local_status`. The other columns filter
`tasks_cache` rows where `completed=false AND local_status=<key>`.

## Column limits

**Cap at 5 columns.** Rationale:

- 3 covers To Do / In Progress / Done (the default).
- 5 leaves room for "Backlog" and "Waiting" without crowding.
- At 800px viewport, 5 columns ≈ 150px each — readable.
- Past 5, the UI starts looking like a Linear/Jira engineering board, which
  isn't this app's audience (productivity users, not engineering teams).

## Customization UX

Two paths to rename a column, both writing to `task_columns`:

1. **Settings → Tasks → Board Columns.** List with rename, reorder via
   drag, add/remove. Save on blur. This is the discoverable path.
2. **Double-click the column header in the board.** Inline rename input.
   Enter saves, Esc cancels. Faster for one-off tweaks.

**Add column:** picks a fresh `status_key` (we generate `custom_<n>` for
user-created statuses). Up to the 5-column cap.

**Remove column:** removes the row from `task_columns`. Tasks with
`local_status=<that key>` get reset to `todo` on next read so they don't
disappear. We do NOT delete or modify anything in Todoist — Todoist only
knows open/completed. Removing a column is purely a productivity.do
operation.

## Manual ordering + optional sort

Each column shows tasks ordered by `local_position` (manual drag-to-reorder)
when the user has dragged anything. Sort dropdown per column:

- `manual` — `local_position ASC`
- `due` — soonest due first
- `priority` — P1 → P4 → none
- `created` — newest first

Default is `due` for fresh users (most actionable). Switches to `manual`
the moment the user drags a card. They can override back via the dropdown.

## View persistence (general principle: any view toggle, per form-factor)

**The rule:** any user-selectable view in the app — top-level domain
selector, sub-view toggles like list/board, calendar view (Day/Week/Month),
notes split modes, and any future view chooser we add — persists
**server-side, per form-factor**. Two buckets: desktop and mobile.

This means:

- Switch desktops → preferences follow.
- Use mobile differently than desktop → each remembers its own state.
- New laptop / cleared browser → nothing is lost.

### Convention

Every view-state pref name follows `<viewName>_<formFactor>`:

```
appView_desktop      = 'calendar' | 'tasks' | 'notes'   default 'calendar'
appView_mobile       = 'calendar' | 'tasks' | 'notes'   default 'calendar'
tasksView_desktop    = 'list' | 'board'                 default 'list'
tasksView_mobile     = 'list' | 'board'                 default 'list'
calendarView_desktop = 'day' | 'next' | 'week' | 'month' default 'week'
calendarView_mobile  = 'day' | 'next' | 'week' | 'month' default 'day'
notesMode_desktop    = 'edit' | 'split' | 'preview'     default 'split'
notesMode_mobile     = 'edit' | 'split' | 'preview'     default 'edit'
```

When we add a new view toggle anywhere in the app, follow this pattern —
don't fall back to localStorage-only or a single shared pref.

### Form-factor detection

Viewport width breakpoint: `<768px = mobile`, otherwise desktop. Read once
on app load. Tablets in landscape count as desktop; tablets in portrait
count as mobile. Don't add a "tablet" bucket — the user's behavior on a
tablet typically mirrors one or the other based on orientation, and a
third bucket is more taxonomy than benefit.

If the user resizes past the breakpoint mid-session (rare on real devices,
common in dev), we re-read the preference and switch view. No animation,
no warning — just adopt the other form factor's pref.

### Why server-stored over localStorage

- New laptop / cleared browser → preference survives.
- Matches the user's mental model: "I have a desktop habit and a mobile
  habit," not "every browser is its own preference universe."
- Trade-off: a user with two distinct desktops (work, home) collapses to
  one preference. Rare; they can flip the toggle and it'll persist.

## Migration order

1. Add columns to `tasks_cache` and `user_prefs` via `applyMigrations()`
   (column-level idempotent migrations already supported).
2. Create `task_columns` table on first board open if missing; seed
   defaults for the user.
3. Update `TasksView.svelte` to render columns from `task_columns` rather
   than the hardcoded P1/P2/P3/None.
4. Wire drag-to-move → PATCH `local_status` (no Todoist call).
5. Add Settings UI for column management.
6. Add inline rename (double-click header).
7. Add per-column sort dropdown.
8. Add view persistence (`tasksView_<form-factor>` + `appView_<form-factor>`).

## Webhooks

Outbound webhook event types (see `backend/views/developers.html` § Event types):

- `task.moved` — fires when `localStatus` changes (kanban board move).
  Payload: `{ id, fromStatus, toStatus }`. `fromStatus` / `toStatus` are
  status keys (`'todo'`, `'in_progress'`, `'custom_<n>'`, or `null`).
  Does NOT fire on Done — that's `task.completed`.

Notification suppression: `task.moved` deliberately doesn't write an
in-app notification row (the bell would explode during a drag-heavy
session). Webhook subscribers still get every move.

## What we deliberately did NOT build

- **Bidirectional status sync to Todoist.** Adds a label-clutter problem
  with no clear win. See "Why this doc" above.
- **Field-level conflict resolution.** Last-write-wins is fine for our
  surface area.
- **More than 5 columns.** Hard cap. Engineering teams who want 7 columns
  are not the audience.
- **Manual ordering across columns.** `local_position` is per-column.
  Cross-column ordering would need a global ordinal that's painful to
  maintain on drag-between.
- **Per-board templates / multiple boards.** One board per user. Adding
  multiple boards is a Pro-tier feature for later, not v1.
