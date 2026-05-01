---
title: Tasks board (kanban)
description: Drag-to-move task management with custom columns
---

# Tasks board

The board is the kanban view of your tasks. Each column groups tasks
by their `local_status`, a productivity.do-specific field that doesn't
sync to Todoist (we keep it local-only).

## Default columns

- **To Do** — new tasks, no status set
- **In Progress** — actively working on
- **Done** — completed (this column reads from your task source's
  completion field; not a writable status)

You can rename To Do and In Progress freely. Done is always rightmost
and can't be removed or renamed (it's special).

## Custom columns

Settings → Tasks → Board columns lets you add up to 2 custom columns
(5 total max). Drag to reorder.

## Drag-to-move

Click and drag any card to another column. Within a column, drag up/down
to reorder.

## Sort within column

Each column has a sort dropdown:
- **Manual** — your drag order (default once you've moved anything)
- **Due** — by due date
- **Priority** — Todoist priority 1 → 4
- **Created** — newest first

## Differences from list view

- The list groups tasks (by date, project, label, or priority)
- The board groups tasks (by status only)
- Multi-select + bulk actions work in list view; not in board view

Toggle between them in the Tasks view header.
