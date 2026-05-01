---
title: Slack app
description: Create tasks from Slack with /productivity slash command
---

# Slack app

A native Slack app with a `/productivity` slash command. Workspace
members link their Slack identity to a productivity.do account once,
then run slash commands from any channel to create tasks.

## Installing

The Slack app isn't yet listed in the Slack App Directory. When it ships,
go to [productivity.do/integrations/slack](/integrations/slack) and click
"Install in Slack".

## Linking your account

After install, in any Slack channel:

```
/productivity link
```

Slack replies with an ephemeral link. Click it while signed into
productivity.do. Your Slack ID is now linked.

## Creating tasks

```
/productivity new task: Buy milk
/productivity new task: Submit timesheet tomorrow
/productivity new task: Review PR 2026-05-15
```

Optional trailing date hint: `today`, `tomorrow`, or `YYYY-MM-DD`.

## Help

```
/productivity help
```

Lists commands, including link/unlink.

## Privacy

We store:
- Your Slack workspace ID + name
- Your Slack user ID
- A one-way mapping from Slack user ID → productivity.do user ID

We do not store messages, channel content, or anything beyond what's
needed for the slash command to work.

## Removing

In Slack workspace settings, uninstall the productivity.do app.
The mapping is deleted on uninstall.
