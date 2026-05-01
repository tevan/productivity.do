---
title: Frequently asked questions
description: Quick answers to common questions about productivity.do
---

# Frequently asked questions

## What is productivity.do?

A web calendar and task manager that combines Fantastical-style calendar
UX, kanban tasks, notes, and Calendly-style booking pages into a single
app. It connects to Google Calendar, Todoist, Notion, Linear, Trello,
Microsoft 365, and ~100 other tools, but works standalone too.

## Do I need to connect external apps?

No. Native event, task, and note storage means you can use productivity.do
without any third-party accounts. Connect integrations to merge in data
from tools you already use.

## How much does it cost?

- **Free** — single user, basic calendar + tasks + 1 booking page
- **Pro** — $12/mo (or $10/mo annual) — unlimited booking pages, AI prep,
  recurring events, custom branding
- **Team** — $20/user/mo (or $16/user/mo annual) — round-robin booking,
  collective availability, team workflows

## Can I cancel anytime?

Yes. Cancel from Settings → Account. You keep access through the end of
your billing period; data stays accessible during that window.

## Do you offer refunds?

For monthly plans, no — cancel before your renewal date instead. For
annual plans, contact support within 30 days of the charge for a prorated
refund.

## Is my data encrypted?

Yes. All connections use TLS in transit. Integration tokens (Google
OAuth, Todoist PATs, etc.) are encrypted at rest with AES-256-GCM.
Database backups are encrypted via restic.

## Where is my data stored?

On servers in the United States. Database backups go to multiple
locations (Hostinger remote, local SSD).

## Can I export my data?

Yes. CSV exports for events and bookings; ICS feeds for calendar; full
JSON via the public API at `/api/v1`. There's no lock-in.

## Do you support Apple Calendar / iCloud?

Yes, via CalDAV. Settings → Integrations → Apple Calendar. You'll need
an app-specific password from your Apple ID.

## Does Google Calendar sync work both ways?

Yes. Events created in productivity.do appear in Google Calendar, and
vice-versa. Edits sync in both directions.

## Why isn't my Todoist task showing up?

The most common cause: the task is in a project you've filtered out.
Check the Tasks view sidebar — make sure no project filter is active.
If the task still doesn't appear after a manual sync, see the
[Todoist troubleshooting guide](troubleshooting/todoist).

## What integrations do you have?

Over 100. Browse the directory at [/integrations](/integrations).
Notable ones: Google Calendar, Todoist, Notion, Linear, Trello,
Microsoft 365, CalDAV (Apple/Fastmail/Proton), Slack, Zoom, Stripe,
Strava, Airtable, plus Zapier/Make/n8n/IFTTT/Pipedream/Workato/Activepieces
for automation platforms.

## Do you have an iOS app?

Not yet. The web app is mobile-friendly and works on iOS Safari. Native
iOS, iPadOS, and Android apps are planned after the web app is stable.

## Can I use this with Claude / Cursor / other AI tools?

Yes. We have an MCP (Model Context Protocol) server. Add
`https://productivity.do/mcp` to Claude Desktop, Cursor, Cline, or any
MCP-aware client with your API key. See the
[MCP guide](api/mcp).

## How do I delete my account?

Settings → Account → Danger zone → Delete account. Soft-deletes for 30
days (recoverable by signing in or contacting support). Click "Delete
permanently" instead for immediate, irreversible purge.

## How do I contact support?

Email support@productivity.do, or use the AI assistant in Settings → Help.
The AI handles most questions; if it can't, your conversation is
forwarded to a human.
