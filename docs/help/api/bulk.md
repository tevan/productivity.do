---
title: Bulk endpoints
description: Send up to 100 operations in one request — and what to do when some fail
---

# Bulk endpoints

Two endpoints accept batches:

- `POST /api/v1/tasks/bulk`
- `POST /api/v1/events/bulk`

Each takes a body of `{ "items": [...] }` with up to **100 items**. They
return a per-item result array so you can tell which items succeeded and
which failed.

## Important: bulk operations are NOT atomic

This is the most important thing to know about our bulk endpoints. They
process items **serially** and return per-item results. **Some items can
succeed while others fail.** Your code must handle that.

This is a deliberate divergence from the typical "all-or-nothing" batch
pattern. Tasks and events ultimately land in third-party systems (Todoist,
Google Calendar) that don't support cross-resource transactions, so we
can't roll back a partial batch. Instead of pretending atomicity that
isn't real, we surface per-item status and let you decide what to do.

## Response shape

```json
{
  "ok": true,
  "results": [
    { "index": 0, "ok": true,  "task": { "id": "abc", "content": "..." } },
    { "index": 1, "ok": true,  "task": { "id": "def", "content": "..." } },
    { "index": 2, "ok": false, "error": "content required" },
    { "index": 3, "ok": true,  "task": { "id": "ghi", "content": "..." } }
  ]
}
```

The top-level `"ok": true` means *the batch was processed*, not *every
item succeeded*. Always iterate `results` and check `ok` per item.

## Example: tolerating partial failure

```javascript
const res = await fetch('/api/v1/tasks/bulk', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Idempotency-Key': crypto.randomUUID(),
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    items: [
      { content: 'Task A' },
      { content: 'Task B' },
      { content: '' }, // will fail validation
      { content: 'Task D' },
    ],
  }),
});

const { results } = await res.json();
const succeeded = results.filter(r => r.ok);
const failed = results.filter(r => !r.ok);

console.log(`Created ${succeeded.length}, failed ${failed.length}`);
if (failed.length) {
  // Decide: retry the failures? Surface to the user? Log?
  for (const f of failed) {
    console.warn(`item ${f.index}: ${f.error}`);
  }
}
```

## Limits

- **Max 100 items per request.** 101+ returns `400 Bad Request`.
- The whole batch counts as **1 request** against your rate limit, but
  internally each item makes its own provider call. A 100-item batch can
  take 5–30 seconds.
- Per-item write scopes apply (`write:tasks`, `write:events`). Missing
  scope fails the whole batch with `403`, not per-item.

## Idempotency

Always send an [Idempotency-Key](./idempotency) with bulk writes. If your
client retries a partially-succeeded batch, the same items will deduplicate
correctly — you'll get the same `results` array back, replayed from cache.

Without idempotency, retrying a partially-succeeded batch creates
duplicates of the items that succeeded the first time.

## Why not atomic?

Atomic batch operations require all participants to support multi-resource
transactions. Google Calendar and Todoist don't expose that. We could fake
atomicity by deleting earlier-created items when later ones fail, but that
introduces a *different* class of bug (the deletes can themselves fail,
leaving the data even more inconsistent than the partial-success path).

The honest contract is "we'll process everything we can; you handle the
partial result." That's what we ship.
