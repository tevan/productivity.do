---
title: Webhooks
description: Subscribe to productivity.do events and react in real time
---

# Webhooks

Subscribe to events via `POST /api/v1/webhooks`. We POST a JSON payload
to your URL whenever a matching event happens.

## Subscribing

```bash
curl -X POST https://productivity.do/api/v1/webhooks \
  -H "Authorization: Bearer pk_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-server.example/webhook",
    "events": ["task.completed", "booking.created"]
  }'
```

Returns the subscription ID and a signing secret you'll use to verify deliveries.

## Available events

| Event | When |
|---|---|
| `event.created` | Calendar event created |
| `event.updated` | Time/title/location/etc. changed |
| `event.deleted` | Event removed |
| `task.created` | New task added |
| `task.updated` | Task field changed |
| `task.completed` | Task marked done |
| `task.moved` | Moved between board columns |
| `booking.created` | Invitee booked a slot |
| `booking.canceled` | Booking canceled |
| `booking.rescheduled` | Booking moved to a new time |

## Signature verification

Every delivery includes:

```
X-Productivity-Signature: t=<unix-ts>,v1=<hex-sha256>
```

The signature is `HMAC-SHA256(signing_secret, "${ts}.${rawBody}")`.

Verify before processing:

```js
const computed = crypto
  .createHmac('sha256', signingSecret)
  .update(`${ts}.${rawBody}`)
  .digest('hex');
if (computed !== signatureHex) throw new Error('bad signature');
if (Date.now()/1000 - Number(ts) > 300) throw new Error('replay');
```

## Retry behavior

Failed deliveries (non-2xx response, timeout >8s) retry on this schedule:

- 1 minute
- 5 minutes
- 30 minutes
- 2 hours
- 12 hours

Then we give up and mark the delivery as failed.

## URL safety

We validate the target URL on subscribe and on every delivery. URLs
that resolve to:
- Loopback (`127.0.0.0/8`)
- RFC1918 private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
- CGNAT (`100.64.0.0/10`)
- IPv6 internal

…are rejected. Webhooks can only target public addresses (SSRF guard).
