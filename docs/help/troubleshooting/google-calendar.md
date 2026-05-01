---
title: Google Calendar not syncing
description: Common issues with Google Calendar integration
---

# Google Calendar not syncing

## Most common causes

### 1. Token expired or revoked

Symptoms: events stop updating, manual "Sync now" returns an error.

Fix: Settings → Integrations → Google Calendar → "Reconnect". You'll
re-authenticate via OAuth. Your data stays.

### 2. Calendar visibility is off

Symptoms: events exist in Google Calendar but don't show in
productivity.do.

Fix: Calendar sidebar → click the calendar in the list to toggle
visibility. The dot next to the name should be filled.

### 3. Permission scope changed

Symptoms: read works but writes fail.

Fix: Disconnect → reconnect. The OAuth flow re-requests both read and
write scopes.

### 4. Specific event won't sync

Symptoms: one event appears in Google but not productivity.do, or
vice-versa.

Fix:
1. Force a refresh (click "Sync now" in the integration)
2. Check the event has a valid start/end time
3. Recurring events with malformed RRULEs sometimes fail — try editing
   the event in Google Calendar and re-saving

### 5. All events disappeared

Symptoms: yesterday they were there, today nothing.

Likely cause: Google access token rotation or your Google account
password changed.

Fix: reconnect (Settings → Integrations → Google Calendar). If your
events still don't appear after reconnect, email
support@productivity.do — we'll dig into the sync logs.

## Background sync schedule

We refresh every 5 minutes, on rows older than 15 minutes. Manual "Sync
now" forces an immediate refresh.

## Multiple Google accounts

Yes. Connect each one separately. Each shows up as its own calendar
group in the sidebar.

## When to contact support

If reconnecting doesn't help, or you see specific events behaving
weirdly across multiple sync attempts. Include:
- The Google Calendar event title
- The event's date/time
- What you see in productivity.do vs Google
