---
title: API keys and authentication
description: Generate, rotate, and use productivity.do API keys
---

# API keys and authentication

## Generating a key

Settings → Account → Developer → API keys → "+ New key"

You'll see the secret **once**. Copy it immediately — we store only a
SHA-256 hash; if you lose it we can't recover it.

Format: `pk_live_<prefix>.<secret>`. The prefix lets us identify your
key in logs without exposing the secret.

## Using a key

```
curl -H "Authorization: Bearer pk_live_abc123.xyzdef456" \
  https://productivity.do/api/v1/me
```

## Scopes

A key can have one or more of:
- `read:tasks` / `write:tasks`
- `read:events` / `write:events`
- `read:calendars`
- `read:booking-pages` / `write:booking-pages`
- `read:webhooks` / `write:webhooks`
- `admin` — wildcard, all of the above

Default for new keys is read+write across the user's data.

## Rotating a key

Settings → Account → Developer → click "Rotate". Old secret is invalidated
immediately; new one shown once. Update your scripts before rotating.

## Revoking a key

Settings → Account → Developer → click "Revoke". Permanent.

## Best practices

- One key per integration / script — easier to revoke if compromised
- Set the smallest scope needed
- Rotate any key that's been in a public repo, even briefly
- Use environment variables, never hard-code keys in source
