# Holistic views: Calendar | Tasks | Notes

**Date:** 2026-04-30
**Status:** Scaffolded (TasksView + NotesView placeholders shipped)

## What we're building

A top-center segmented control with three "workspace" views:

- **Calendar** — time-based events (the existing app)
- **Tasks** — full-screen list/board for tasks (Todoist-backed)
- **Notes** — full-screen markdown notes (local SQLite-backed)

Each view has a **context-aware sidebar** — see "Sidebar by view" below.
The principle: in any view, the sidebar shows the *other two* domains in
compact form so you can cross-reference without leaving the view.

## Sidebar by view

The sidebar's primary domain is whatever's **not** in the main pane. The
active domain has its primary UI in the main pane already; repeating it in
the sidebar is wasted real estate.

| View     | Sidebar shows                                                    |
|----------|------------------------------------------------------------------|
| Calendar | Mini-cal, Calendar sets, Calendars list, Tasks (compact), Notes (compact) |
| Tasks    | Mini-cal, Today's events (read-only chips), Filters, Notes (compact) |
| Notes    | Mini-cal, Today's events, Recent tasks, Pinned notes             |

"Today's events" is a read-only compact chip list scoped to the current
day. Click → opens the EventEditor (same as clicking from the calendar).
This lets a user planning their day from the Tasks view see their
schedule without context-switching.

Sidebar section visibility per view is configurable in Settings →
Sidebar (gated by `appView` so the user can hide e.g. "Today's events"
in the Tasks view while keeping it in Notes).

## Why

Tools like Fantastical, Cron, Amie, Sunsama, and Notion all let you switch
between fundamentally different work contexts in one app. The differentiator
isn't *having* multiple content types — everyone does — it's that none of
them pretend to be primary.

For productivity.do specifically, we already have three full data domains
that deserve their own home:

- Calendar (Google Calendar sync)
- Tasks (Todoist sync + local subtask metadata)
- Notes (local markdown)

The sidebar today crams Tasks and Notes into a small tab toggle. They
deserve full-screen treatment for power use without losing the calendar as
the home.

## What we're NOT building (and why)

### Email

Skipped indefinitely. To be a *primary surface* for email, we'd need:

- IMAP / Gmail OAuth scope (full mailbox)
- Threading + search + attachments + drafts + send
- Spam handling, label sync, snooze, etc.

That's a quarter of work for table-stakes parity, before any
differentiation. The "email-to-task" feature we already have is the right
level of integration: let existing inboxes stay where they are, just give
users a way to forward an email to productivity.do and get a task.

If we ever revisit, the target audience for full email would need to be
clear: support/Zendesk users? Solo founders? Teams? No clear winner today.

### Scheduling (as a top-level view)

The booking-pages feature already exists in Settings. Promoting it to a
top-level view doesn't add much — most users set it up once and forget it.

There IS a useful angle: a **"Today" focus board** that combines calendar
+ tasks + booking availability ("what should I work on right now"). That
might earn a fourth top-level slot eventually, but it's a different
product from Scheduling-as-feature-management.

### Storage / Docs

Drive, Notion, and Dropbox already do this. Notes (markdown) is enough
for productivity.do's audience — the people who want a doc tool will use
a doc tool. Trying to compete here adds bloat and dilutes focus.

### Resourcing

Project management territory (Asana, Monday, ClickUp). Doesn't fit a
calendar-first productivity app. Out of scope.

## The Notion bloat antidote

Notion has become the definition of feature creep — every release adds new
content types that interact in increasingly unpredictable ways. The
cumulative result is slow, complex software.

Our defense against this: **hard limits on what each view does.**

- Calendar = time-based events. Not a database. Not a kanban.
- Tasks = list + kanban + prioritized today. **No databases-of-databases.
  No formulas. No formula references between databases.**
- Notes = markdown + backlinks. **No tables. No AI-summary features that
  require a 200ms server roundtrip per render.**

Each view should:
- Fit on one screen
- Load in <500ms
- Have zero loading skeletons (cache aggressively)

That's the differentiator: **fast** productivity software in a category
that's gone slow.

## Implementation notes

- Top-level view state lives in `src/lib/stores/appView.svelte.js` —
  separate from `view.svelte.js` (which controls calendar's day/week/month
  sub-view). Different concept, different state.
- Persisted in localStorage (`productivity_app_view`) using the
  IIFE-outside-`$state` pattern documented in `theme_fouc_prevention.md`
  to avoid initial-value flicker.
- Toolbar segmented control uses the same pill-style as
  `app-view-toggle` matching the period toggle in BillingTab.
- TasksView (`src/lib/views/TasksView.svelte`) renders list (default) or
  board (priority-grouped) modes. Reuses TaskRow + buildTaskGroups.
- NotesView (`src/lib/views/NotesView.svelte`) is a 320px sidebar list +
  reading pane. Click a note to read; "Edit" opens the modal editor.

## Iteration plan

1. ✅ Scaffold TasksView + NotesView, wire selector
2. Add drag-to-move-priority on the kanban board (calls Todoist `priority`)
3. Add filter chips on Tasks (project, label, due, priority)
4. Add Notes search + tag/folder support
5. Consider a "Today" view if user feedback supports it
