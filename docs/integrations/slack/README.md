# productivity.do Slack app

Native Slack app with `/productivity` slash command. Workspace members
link their Slack identity to a productivity.do account once, then run
slash commands from any channel to create tasks.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/slack/command` | Slash-command receiver (signed by Slack) |
| `GET /api/slack/install` | Begin Slack OAuth install |
| `GET /api/slack/oauth/callback` | Complete Slack OAuth |
| `GET /slack/link?token=…` | Finish user-linking flow (session-auth) |

## Slash command shape

```
/productivity new task: Buy milk
/productivity new task: Submit timesheet tomorrow
/productivity new task: Review PR 2026-05-15
/productivity link
/productivity help
```

## Setup (when ready to publish)

1. Create a Slack app at https://api.slack.com/apps
2. Add the `commands` OAuth scope
3. Add a slash command `/productivity` pointing at
   `https://productivity.do/api/slack/command`
4. Set redirect URL to `https://productivity.do/api/slack/oauth/callback`
5. Set env vars: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`,
   `SLACK_SIGNING_SECRET`, `PUBLIC_ORIGIN=https://productivity.do`
6. Submit to the Slack App Directory

## Security

- All slash-command requests verified with HMAC-SHA256 over the raw
  body + timestamp (Slack-prescribed scheme). Replay window: 5 minutes
- Per-workspace bot tokens stored in `slack_workspaces`; per-user
  mappings in `slack_user_links`
- Linking tokens expire after 10 minutes and are single-use

## Future iterations (not in v1)

- Right-click message → "Send to productivity.do" message-action
- Daily-digest bot post (today's events + tasks)
- Webhook subscriptions to `task.completed` so Slack can react
- Multi-workspace per-user (one Slack identity → multiple
  productivity.do accounts)
