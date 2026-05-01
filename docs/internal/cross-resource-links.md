# Cross-resource links

**Date:** 2026-04-30
**Status:** Implemented (drag note/task → event)

## What

A user can drag a task or note from the sidebar onto an event chip on the
calendar. That creates a **link**, displayed in the event popover as a
chip the user can click to open the linked task/note. Click × to unlink.

## Why a separate links table, not mutating the source records?

We sync to Todoist (tasks) and Google Calendar (events). Notes are local.
Mutating either upstream record to record a link would:

- **Break upstream** — Todoist has no "linked event" field. We'd have to
  smuggle the link into `description`, which corrupts user-visible data.
- **Lose the link on rename/move** — if the user edits the task in
  Todoist's app, our smuggled metadata gets clobbered.
- **Require write scope where read would do** — if a user gives us
  read-only Google access, we can't write metadata to events.

The local `links` table sidesteps all of this:

```sql
CREATE TABLE links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  from_type TEXT NOT NULL,   -- 'task' | 'note' | 'event'
  from_id   TEXT NOT NULL,
  to_type   TEXT NOT NULL,
  to_id     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, from_type, from_id, to_type, to_id)
);
```

Links live forever in our DB regardless of what happens upstream. If a
linked task is deleted in Todoist, the link silently becomes a "dangling
reference" — the popover just doesn't render that chip anymore (the
lookup misses).

## ID conventions

- `task` → Todoist task id (string)
- `note` → our local note id
- `event` → `${calendarId}|${eventId}` (Google IDs aren't unique across
  calendars, so we always need both)

## Canonical ordering

To avoid duplicate rows for "task→event" vs "event→task", we
canonicalize on insert: alphabetical type ordering with `event` > `note`
> `task`. The unique constraint catches dupes regardless.

## What this is NOT

- Not bidirectional sync — there's no "this task is linked to this
  event" field anywhere in Todoist or Google. Only here.
- Not a substitute for proper data modeling — if linking becomes a
  primary feature, we may need to bring tasks and notes fully in-house
  and treat Todoist/Google as read replicas.
- Not magic — if a Google event is deleted, the link still sits in the
  table. A future cron job will reconcile (drop links whose endpoints
  no longer exist) but it's not implemented yet.

## What we considered and rejected

### Embedded `linked_to` arrays on each model

Storing `event.linkedTaskIds = [1, 2, 3]` and `task.linkedEventIds`
would seem natural, but events are read-only on our side (synced from
Google) — we can't add fields without polluting Google's payload. Notes
ARE local, but symmetry is worth it.

### Tags / labels as the linking primitive

"Tag both with #project-foo" works for grouping but doesn't capture
"this specific task is for this specific meeting". Different use case.

### Bidirectional drag both directions

Today only `task→event` and `note→event` (drop tasks/notes onto event
chips). The reverse — drop an event onto a task to schedule it — is
already handled by the auto-schedule feature (`POST
/api/tasks/:id/auto-schedule`). No need to duplicate.

## Future extensions

- **Task ↔ note** — useful for "draft notes that became actionable
  tasks". Same table works.
- **Event ↔ event** — meeting-prep meeting linked to the actual
  meeting. Useful for series/follow-ups.
- **Backlinks in NotesView** — when viewing a note, show "Linked to:
  [event chip] [task chip]" so links surface in both directions.
- **Reconciliation cron** — periodically sweep the links table and drop
  rows whose endpoints no longer exist. Today they're harmless dangling
  refs.
