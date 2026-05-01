---
title: Idempotency keys
description: Safely retry write requests without creating duplicates
---

# Idempotency keys

Every write request to `/api/v1` (POST, PUT, PATCH, DELETE) accepts an
`Idempotency-Key` header. If you send the same key twice, the second
request returns the cached response from the first — no second side effect.

This protects you from a class of subtle bug: your POST succeeded on the
server but the connection died before you got the response. Without
idempotency, a retry creates a duplicate task / event / booking. With
idempotency, the retry returns the original response and your client
proceeds correctly.

## How to use it

Send any 8–128 character string as `Idempotency-Key`. Use a UUID — it's
the simplest thing that works:

```
curl -X POST https://productivity.do/api/v1/tasks \
  -H "Authorization: Bearer pk_live_abc123.xyzdef456" \
  -H "Idempotency-Key: 8f9a3c2e-7b4d-4a1e-9c5f-6d8e2a3b4c5d" \
  -H "Content-Type: application/json" \
  -d '{"content":"Buy milk","priority":3}'
```

If you retry that exact request — same key, same body, after a network
failure — the second response will be byte-identical to the first and
carry an extra response header:

```
Idempotent-Replayed: true
```

## Generating keys

Anything random and high-entropy works. UUIDs are conventional. Hashes of
a logical operation (e.g. `sha256(userId + ":create-task:" + clientRequestId)`)
also work and let your client deduplicate retries that survive across
process restarts.

**Don't use sequential counters.** If two of your processes pick the same
counter value for different operations, you'll get the wrong response.

## What gets cached

Only successful (2xx) responses are cached. If your first request returned
a 4xx validation error, a retry with the same key processes the request
fresh — so you can fix the body and try again without picking a new key.

The cache is scoped per API key (and per user for session-authenticated
calls). Two different clients can't collide on the same key.

## How long does the cache last

Cached responses expire after **24 hours**. Clients that want to dedupe
across longer windows should track their own request log.

## Errors

- `400 Bad Request — Idempotency-Key must be 8-128 chars` — your key is
  too short, too long, or not a string. Pick a UUID.

## Limitations and divergences from Stripe

If you're familiar with Stripe's idempotency: ours is intentionally
simpler.

- **We don't fingerprint the request body.** A retry with the same key
  but a different body returns the cached response, not a 409. We trust
  callers to pair each `Idempotency-Key` with one logical operation.
- **We don't cache 4xx/5xx.** Stripe caches all responses; we re-process
  on retry so a fixed-up retry can succeed.
- **24h TTL** vs Stripe's 24h — same.
