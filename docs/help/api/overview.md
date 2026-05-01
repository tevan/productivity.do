---
title: Public API overview
description: Build integrations and automations with /api/v1
---

# Public API overview

Base URL: `https://productivity.do/api/v1`

The public API gives you full programmatic access to your tasks, events,
calendars, booking pages, and webhooks. Same endpoints power the
official Zapier/Make/n8n integrations.

## Authentication

Bearer API key in the `Authorization` header:

```
Authorization: Bearer pk_live_<prefix>.<secret>
```

Generate a key at Settings → Account → Developer → API keys.

## Endpoints

### Health
- `GET /api/v1/ping` — health check (no auth)
- `GET /api/v1/openapi.json` — full OpenAPI 3.1 spec
- `GET /api/v1/me` — current key info

### Tasks
- `GET /api/v1/tasks` — list
- `POST /api/v1/tasks` — create
- `PUT /api/v1/tasks/:id` — update
- `POST /api/v1/tasks/:id/complete` — mark complete
- `POST /api/v1/tasks/bulk` — up to 100 per request

### Events
- `GET /api/v1/events?from=&to=` — list in range
- `POST /api/v1/events` — create
- `PUT /api/v1/events/:id` — update
- `DELETE /api/v1/events/:id`
- `POST /api/v1/events/bulk` — up to 100 per request

### Calendars
- `GET /api/v1/calendars` — list

### Booking pages
- `GET /api/v1/booking-pages`
- `GET /api/v1/booking-pages/:id/bookings`

### Webhooks
- `GET /api/v1/webhooks` — list subscriptions
- `POST /api/v1/webhooks` — create
- `DELETE /api/v1/webhooks/:id`

## Rate limits

120 requests per minute per key (sliding window). 429 with
`Retry-After` header when exceeded.

## Webhooks

Subscribe to events: `event.created`, `event.updated`, `event.deleted`,
`task.created`, `task.completed`, `task.updated`, `task.moved`,
`booking.created`, `booking.canceled`, `booking.rescheduled`.

Outbound deliveries are signed with HMAC-SHA256:

```
X-Productivity-Signature: t=<timestamp>,v1=<signature>
```

Reject deliveries older than 5 minutes (replay protection).

## Bulk operations

`/api/v1/events/bulk` and `/api/v1/tasks/bulk` accept `{ items: [...] }`
with up to 100 entries. Returns per-item results so partial failures
don't block the whole batch.
