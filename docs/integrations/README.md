# Developer-platform integrations

This directory holds the manifests and design notes for the productivity.do
apps that live inside other automation platforms — Zapier, Make, n8n,
IFTTT, Pipedream, Workato, Activepieces.

## How they connect

All seven hit the productivity.do **public developer API** at `/api/v1`.

- Auth: `Authorization: Bearer pk_live_<prefix>.<secret>` (per-user API key
  generated in Settings → Developer)
- All bodies are JSON
- Rate limit: 120 requests/min per key
- OpenAPI spec: `/api/v1/openapi.json`

## Trigger / action surface

Every platform exposes a similar shape: **triggers** (productivity.do →
their workflow) and **actions** (their workflow → productivity.do).

### Triggers (we emit)

These map 1:1 to webhook events we already publish via
`webhook_subscriptions`. Each platform's app polls or subscribes to the
webhook URL their platform mints for the user.

| Event | Description |
|---|---|
| `event.created` | A new calendar event was created |
| `event.updated` | An event's time/title/location changed |
| `event.deleted` | An event was removed |
| `task.created` | A new task was added |
| `task.completed` | A task was marked done |
| `task.updated` | Title, due, project, label, priority changed |
| `task.moved` | Task moved between board columns |
| `booking.created` | An invitee booked a slot on one of the user's pages |
| `booking.canceled` | An invitee canceled |
| `booking.rescheduled` | An invitee rescheduled |

### Actions (we accept)

| Action | Endpoint |
|---|---|
| Create task | `POST /api/v1/tasks` |
| Update task | `PUT /api/v1/tasks/:id` |
| Complete task | `POST /api/v1/tasks/:id/complete` |
| Create event | `POST /api/v1/events` |
| Update event | `PUT /api/v1/events/:id` |
| Bulk create events | `POST /api/v1/events/bulk` (max 100/req) |
| Bulk create tasks | `POST /api/v1/tasks/bulk` (max 100/req) |
| List bookings on a page | `GET /api/v1/booking-pages/:id/bookings` |

## Per-platform notes

Each subdirectory has its own README and either a manifest (Make, n8n,
Activepieces) or a CLI scaffold (Zapier, Pipedream).

**Submission status:** none submitted yet. These are scaffolds for when we
ship the public developer program.

## What still needs strategy

Before we publish any of these, we need a decision on:

1. **App branding** — name, logo, color, short description (each platform
   imposes a slightly different shape)
2. **Tier eligibility** — Zapier and Make typically charge per task/op. Are
   we OK with users hitting our `/api/v1` from those platforms regardless of
   the user's productivity.do plan, or do we gate on Pro+?
3. **Partner programs** — Zapier Partner Program, Make Featured Apps, n8n
   verified partner. Each requires us to engage with that company. None are
   blocking; all are upside.
4. **Submission/review** — Zapier reviews public apps; Make does too. Plan
   for a 2-4 week review cycle on each.
