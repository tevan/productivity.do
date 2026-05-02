---
title: Error codes
description: Stable error codes returned by /api/v1 — what they mean and how to handle them.
---

# Error codes

Every error response on `/api/v1` follows this shape:

```json
{
  "ok": false,
  "code": "validation_missing_field",
  "message": "Required field is missing",
  "field": "content"
}
```

The `code` is a **stable contract** — once published, it won't be renamed
or repurposed. Pattern-match on `code` in your client; the human-readable
`message` may change wording without warning. The `http` status carries
the broad shape (4xx vs 5xx) and the code carries the precise reason.

## Discovery endpoint

`GET /api/v1/error-codes` returns the full catalog as JSON. Cache it
client-side (5-minute `Cache-Control` is set server-side). SDK
generators can use it to produce a typed enum without scraping prose.

## Categories

The prefix before the first `_` is the **category**. Use it for
broad-stroke handling (e.g. all `validation_*` errors get retried after
the user fixes form input).

| Category | When to retry | Typical handling |
|---|---|---|
| `auth_*` | After re-authentication | Send the user to the sign-in flow |
| `plan_*` | After the user upgrades | Show an upgrade modal — payload includes `requiredPlan`, `feature` |
| `validation_*` | After fixing the input | Highlight the offending `field` and surface `message` |
| `not_found_*` | Don't retry | Treat the resource as gone; refresh local cache |
| `conflict_*` | Maybe — depends on subcode | Read the latest state and decide |
| `rate_*` | Yes, after `Retry-After` | Honor the header before the next call |
| `bulk_*` | Don't retry as-is | Split the batch and retry the individual items |
| `payload_*` | Don't retry as-is | Reduce body size or split into multiple requests |
| `upstream_*` | Yes, with backoff | Try again — third-party providers can be flaky |
| `server_*` | Yes, with backoff | Treat as transient; if persistent, contact support |

## Plan-required code

`plan_required` is special: the response includes
`{ requiredPlan, feature, detail? }` so clients can render an
upgrade prompt. Our official SPA's `api()` wrapper auto-triggers a
modal whenever the backend returns this code. SDK consumers should do
the same — show the user what unlocks the action and where to upgrade.

## Idempotency conflicts

`conflict_idempotency_mismatch` means you reused the same
`Idempotency-Key` header on a request whose body differs from the
original. Generate a new key per logical operation; reuse the same key
*only* when retrying the *same* request.
