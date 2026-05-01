---
title: Versioning and deprecation policy
description: How productivity.do handles API breaking changes
---

# Versioning and deprecation policy

The productivity.do API lives at `/api/v1`. Our commitment: **we will
not break v1**. Code you write today against `/api/v1` will still work
in five years.

## What "backward compatible" means

We may, without notice, do any of these:

- Add new endpoints
- Add new fields to existing response objects
- Add new optional request fields
- Add new error codes (your `default` case in the switch should handle
  unknowns)
- Relax rate limits
- Add new scopes that don't restrict existing ones
- Add new resource types

We will **not** do any of these without bumping the version:

- Remove or rename a field in a response
- Remove or rename an endpoint
- Change the type of a field (string → integer, etc.)
- Change the meaning of a field
- Make an optional field required
- Tighten validation in a way that rejects previously accepted input
- Reduce rate limits
- Remove a scope

## When v2 ships

When v2 launches, v1 will continue to work. We commit to **at least 12
months of overlap** before deprecating any v1 endpoint. During that
window:

- v1 keeps receiving security and reliability fixes
- v1 stops getting new features (those land on v2 only)
- We email you 90 days, 30 days, and 7 days before v1 shutoff
- v1 endpoints will return a `Sunset` HTTP header on every response
  during the deprecation window

After shutoff, v1 endpoints return `410 Gone` with a body pointing at the
v2 equivalent.

## Following our changelog

Every API change lands in our [changelog](/changelog). Subscribe via RSS
or watch the GitHub repo for releases.

## Versioning strategy

We use **perpetual stability** — once an endpoint ships in `/api/v1` it
is frozen. We do not version individual endpoints (no
`/api/v1/tasks-v2`); breaking changes wait for `/api/v2`. We do not use
date-based versions (`/api/2026-05-01/`) because they encourage clients
to pin to a specific date and miss bug fixes.

This is the same model used by Twilio, Slack, and Stripe. It costs us
flexibility — we have to live with our naming choices forever — but it
means you get predictability.

## Mandatory changes (rare)

If a change is forced on us by law (GDPR, SOC2, regional data residency
requirements) or by an upstream provider (Google deprecates an OAuth
flow, Todoist sunsets a field), we follow this order:

1. Try to absorb the change inside our adapter so callers don't see it
2. If that fails, add a new field/endpoint and deprecate the old one
   on the standard 12-month timeline
3. If a hard deadline (e.g. Google sunsets an API in 90 days) makes
   the standard timeline impossible, we email all affected key holders
   immediately and provide migration tooling

We have not yet had to do (3). If we ever do, this section will explain
what happened and what we did to mitigate.
