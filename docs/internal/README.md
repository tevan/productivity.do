# Internal docs

Decisions, scope rationale, and non-public design notes for productivity.do.
These files exist for future-us to recall **why** something was built — or
deliberately not built — without re-deriving the reasoning from scratch.

These are NOT served publicly. nginx's `security.conf` blocks `.md` files,
and the path is outside any served route.

## Files

- `holistic-views.md` — Calendar | Tasks | Notes top-level selector. Why we
  picked these three, why we deferred Email/Scheduling/Storage/Resourcing.
- `admin-system.md` — Operator-admin and team-admin scope, auth model,
  audit/impersonation requirements.
- `routing-and-404.md` — Why we serve real 404s instead of redirecting
  unknown paths to `/`.
- `cross-resource-links.md` — Tasks/notes/events linking model. Why we
  store links separately rather than mutating Todoist/Google records.
- `notes-features.md` — Notes editor roadmap. Tier 1 (now), Tier 2 (next),
  Tier 3 (deferred or rejected). Our take on each major feature from the
  notes-app landscape.
- `weather-api.md` — Why Tomorrow.io, narrative summary approach, fallback
  paths.
- `tasks-board.md` — Kanban model: status as local-only metadata, why we
  don't sync status to Todoist labels, conflict resolution, column limits,
  customization. Also the general view-persistence rule (per form-factor,
  server-stored) that applies app-wide.
