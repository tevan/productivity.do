---
title: Deleting your account
description: How account deletion works and what happens to your data
---

# Deleting your account

Settings → Account → Profile → Danger zone → "Delete account"

## What happens

By default, deletion is **soft**:

- Account is marked deleted immediately
- You're signed out everywhere
- Login is disabled
- Public booking pages return 404
- API keys stop working
- All integrations are disconnected (third-party services keep their
  copies of synced data — you'll need to remove those separately)

For 30 days after that:

- Data is retained but not accessible
- You can recover by signing in (entering your old credentials brings
  the account back) or emailing support@productivity.do
- Email/username can't be reused for signup

After 30 days:

- All your data is permanently purged
- Email becomes available again

## Immediate purge

Click "Delete permanently" instead. Skips the 30-day window. Irreversible.
Data is gone immediately.

## What's purged

- User row and authentication
- All events, tasks, notes, projects
- All booking pages and bookings
- All API keys
- All webhooks and webhook delivery history
- All integrations and their tokens
- Stripe customer (cancellation; we don't auto-refund — email us)

## What's retained even after purge

- Anonymized aggregate analytics (no personal data)
- Webhook delivery logs to your URL (we keep these for our system
  health monitoring; they don't contain your data)
- Server access logs for the period required by law

## Third-party data

Things synced from Google Calendar, Todoist, etc. remain in those
services. We don't have permission to delete them on your behalf.
Disconnect each integration first if you want a clean break.

## GDPR / data export

Want a copy of your data first? Settings → Account → Profile →
"Download data" — gets you JSON dumps of everything we have. Combine
with `/api/v1` exports for completeness.
