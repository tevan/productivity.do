---
title: Integrations directory
description: Connect 100+ external tools to productivity.do
---

# Integrations directory

Browse the full directory at [/integrations](/integrations).

Three relationship modes:

- **Sync** (two-way) — Google Calendar, Notion, Linear, Trello, etc.
  Changes flow both directions
- **Import** (one-way bring-data-in) — Calendly, SavvyCal, Cal.com.
  Migrate from a competitor
- **Read** (read-only context) — Strava, Stripe MRR, Buffer scheduled
  posts, TripIt flights. Surfaces external data on your calendar but
  never writes back

## Categories

Calendar, Tasks, Notes, Email, Storage, Docs, Meetings, Communication,
Time tracking, Forms, Whiteboards, Design, CRM, SMS, Automation.

## Auth types

- **OAuth** — click connect, redirect to provider, return with grant
- **PAT** — paste a personal access token (Notion, Linear, Trello,
  Todoist style)
- **CalDAV** — server URL + username + app-specific password
  (Apple, Fastmail, Proton, Yahoo)

## Native vs connected

You can use productivity.do without any integrations. Native event,
task, and note storage works standalone. Connect integrations to merge
in data from tools you already use.

When you disconnect an integration, native data stays. Synced data from
that integration is removed locally; the source service keeps its own copy.

## Background sync

Connected integrations sync in the background every 5 minutes (rows
older than 15 minutes get refreshed). Manual "Sync now" button per
integration is in the directory.

## Token security

OAuth refresh tokens and PATs are encrypted at rest with AES-256-GCM.
The encryption key never leaves the server.

## Coming soon

About 90% of the directory is "Coming soon" stubs — these are tools we
plan to build but haven't yet. The icon and description appear so you
know what's planned. Vote with your feet — email
support@productivity.do telling us which ones you want first.
