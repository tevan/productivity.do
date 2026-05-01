---
title: Retry behavior
description: When to retry productivity.do API calls and how
---

# Retry behavior

The productivity.do API will occasionally return errors that are
transient — a deploy is in flight, a downstream provider (Google,
Todoist) had a momentary blip, or you tripped a rate limit. This page
spells out exactly when to retry and how.

## Quick rules

| Status | Retry? | How |
|---|---|---|
| 2xx | No (success) | — |
| 400 | No | Fix the request body and resend. |
| 401 | No | Your key is invalid or revoked. Don't loop on this. |
| 403 | No | Missing scope or feature gate. Don't loop. |
| 404 | No | The resource doesn't exist. |
| 408, 425 | Yes | Exponential backoff, max 5 attempts. |
| 409 | No | Idempotency-Key collision or version conflict. |
| 429 | Yes | Honor `Retry-After`. Don't retry sooner. |
| 5xx | Yes | Exponential backoff, max 5 attempts. |

**Never retry a 4xx without changing something** — except 408 (request
timeout), 425 (too early), and 429 (rate limit), which are transient.

## Backoff

Use exponential backoff with jitter. A reasonable schedule:

```
attempt 1 → wait 1s + jitter(0-1000ms)
attempt 2 → wait 2s + jitter(0-1000ms)
attempt 3 → wait 4s + jitter(0-1000ms)
attempt 4 → wait 8s + jitter(0-1000ms)
attempt 5 → wait 16s + jitter(0-1000ms)
attempt 6 → give up
```

Jitter prevents the "thundering herd" — many clients waking simultaneously
after an outage and re-DOSing the recovering server.

## Honor Retry-After

When you see `429 Too Many Requests` or `503 Service Unavailable`, the
response includes a `Retry-After` header (in seconds). Wait at least that
long before retrying. The server knows things you don't (e.g. window
remaining on the rate-limit bucket). A partly informed guess from the
server beats a blind guess from your client.

```
HTTP/1.1 429 Too Many Requests
Retry-After: 17
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Window: 60
```

## Retries are dangerous without idempotency

If you're retrying a write request (POST/PUT/DELETE), pair it with an
[Idempotency-Key](./idempotency). Otherwise a retry of a request that
*succeeded* on the server but died on the wire creates a duplicate.

```javascript
const idemKey = crypto.randomUUID();

async function createTask(body) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch('/api/v1/tasks', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Idempotency-Key': idemKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    if (res.status >= 400 && res.status < 500 &&
        ![408, 425, 429].includes(res.status)) {
      throw new Error(await res.text());
    }
    const retryAfter = Number(res.headers.get('Retry-After')) * 1000;
    const backoff = retryAfter || (2 ** (attempt - 1)) * 1000 + Math.random() * 1000;
    await new Promise(r => setTimeout(r, backoff));
  }
  throw new Error('exhausted retries');
}
```

## Webhook delivery retries

Outbound webhooks (where productivity.do calls you) follow our own retry
schedule: 1m, 5m, 30m, 2h, 12h, then we give up and surface the failure
in your webhook deliveries log. See [Webhooks](./webhooks).
