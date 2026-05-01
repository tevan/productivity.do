# IFTTT service

IFTTT calls our HTTPS endpoints. We register a service via the IFTTT
Platform; each trigger and action is its own IFTTT endpoint that hits
back into us with a service key + the user's OAuth token.

## Auth

IFTTT uses **OAuth 2.0**. We need to expose:
- `/oauth/authorize` (we redirect the user to login + consent, then back
  to IFTTT's callback)
- `/oauth/token` (exchange code for access token)
- `/ifttt/v1/user/info` (returns `{ data: { id, name } }`)

This is a different OAuth surface than our existing user login. We'd add
a thin `routes/ifttt-oauth.js` that mints API keys (Bearer pk_live_…) under
the hood and represents them as OAuth tokens to IFTTT.

## Triggers (IFTTT calls us via webhooks for each user)

Each trigger has an endpoint like:
```
POST /ifttt/v1/triggers/new_task
  { "trigger_identity": "...", "triggerFields": {...}, "limit": 50 }
  → 200 { data: [ {created_at, ...ingredients} ] }
```

We implement `new_task`, `task_completed`, `new_event`, `new_booking`.

## Actions

```
POST /ifttt/v1/actions/create_task
  { "actionFields": { "title": "...", "due_date": "..." } }
  → 200 { data: [ { id: "..." } ] }
```

Plus `complete_task`, `create_event`.

## Submission

IFTTT has a partner program. Free tier publishes up to 5 triggers + 5
actions; paid tier removes the cap. Plan to use the free tier for the
launch surface.
