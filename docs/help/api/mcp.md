---
title: MCP server
description: Use productivity.do from Claude, Cursor, Cline, and other AI clients
---

# MCP server

productivity.do hosts a native [Model Context Protocol](https://modelcontextprotocol.io/)
server. Any MCP-aware AI client can mount it and read/write your tasks,
events, and bookings.

## Endpoint

```
https://productivity.do/mcp
```

Transport: streamable HTTP (the modern standard).

## Auth

Bearer API key, same as `/api/v1`:

```
Authorization: Bearer pk_live_<prefix>.<secret>
```

Each MCP session is scoped to the API key's owner.

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "productivity-do": {
      "url": "https://productivity.do/mcp",
      "headers": {
        "Authorization": "Bearer pk_live_..."
      }
    }
  }
}
```

Restart Claude Desktop. The productivity.do tools will appear in the
slash menu.

## Cursor

Settings → Features → Model Context Protocol → Add server

URL: `https://productivity.do/mcp`
Headers: `Authorization: Bearer pk_live_...`

## Other MCP clients

Cline, Continue, Aider, Roo Code — same shape, check each app's docs.

## Available tools

| Tool | Description |
|---|---|
| `create_task` | Add a task with due date, priority, project, labels |
| `complete_task` | Mark a task done |
| `list_tasks` | List open tasks (filter by project, limit) |
| `create_event` | Create a calendar event |
| `list_events` | List events in a date range |
| `list_booking_pages` | List your booking pages |

## Available resources

| URI | Description |
|---|---|
| `productivity://tasks` | All open tasks |
| `productivity://today` | Today's events + tasks |

## Example prompts

After connecting in Claude Desktop:

- "What's on my calendar today?"
- "Add a task to review PR-123 by Friday"
- "Mark task xyz as complete"
- "Find a free 30-minute slot tomorrow afternoon"
- "Create an event for the dentist appointment at 2pm next Tuesday"

## Limitations

- Read scope is per-API-key. The MCP session sees only that user's data.
- No bulk operations via MCP (use the REST API at `/api/v1` for that).
- We don't expose admin endpoints (rotating keys, deleting accounts) via MCP.
