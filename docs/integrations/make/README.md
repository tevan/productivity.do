# Make app

`manifest.json` is a forward-looking sketch — the real app is built via
the Make Developer Hub web UI (modules, RPCs, IML expressions). The JSON
here exists so we have triggers/actions catalogued in one place; copy
each module into the Hub when we publish.

## Modules to ship

- **Triggers**: watch events, watch tasks, watch bookings,
  watch task moved, watch task completed
- **Actions**: create task, update task, complete task,
  create event, update event, cancel booking, send to native (no provider)
- **Search**: find task by title, find event by summary, list booking pages

## Auth

API key (we send Bearer). Same `/api/v1/me` ping for `verify`.
