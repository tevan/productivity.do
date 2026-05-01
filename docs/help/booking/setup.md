---
title: Booking pages
description: Calendly-style scheduling pages — share a link, accept bookings
---

# Booking pages

Share a public link. Invitees pick a time. The booking lands on your
calendar.

## Creating a booking page

Settings → Bookings → "+ New booking page"

Required:
- **Slug** — your page lives at `productivity.do/book/<slug>`
- **Title** — what invitees see at the top
- **Duration** — single duration (e.g. 30 min) or multiple event types
- **Availability windows** — per weekday + per-date overrides

## Multiple event types

A page can offer several meeting durations (e.g. "15-min intro",
"30-min deep dive", "60-min strategy"). Invitees pick one before
booking. Each lives at `/book/<slug>/<typeSlug>`.

## Custom questions

Add fields to the booking form: text, textarea, dropdown, checkbox.
Per-page or per-type.

## Workflows

Auto-trigger webhooks on:
- Booking created
- Booking canceled
- Booking rescheduled
- 24h reminder

## Invite tokens

Single-use links (Settings → page → Invites). Useful for vetted
audiences. Each token redeems exactly once.

## Time polls

Doodle-style multi-time proposals. The page proposes 3-5 times;
invitee picks one or none. You confirm later.

## Routing forms

Pre-booking questionnaire that maps answers to different booking pages.
Example: "What kind of help do you need?" → routes sales questions to
sales page, support questions to support page.

## Team booking pages

Plans permitting. Round-robin (load-balanced across hosts) or
collective (all hosts free for the slot). Settings → page → Hosts.

## Branding

Per-page logo, cover image, and brand color (8 presets + custom).

## Analytics

Per-page view counter, conversion rate, no-show rate, revenue (if
Stripe-paid). Settings → page → Analytics.
