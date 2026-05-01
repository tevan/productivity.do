# productivity.do MCP server

Native Model Context Protocol server. Any MCP-aware client can mount it.

## Endpoint

```
https://productivity.do/mcp
```

Transport: streamable HTTP (the modern standard, replacing HTTP+SSE).

## Auth

Bearer API key, identical to `/api/v1`:

```
Authorization: Bearer pk_live_<prefix>.<secret>
```

Generate one at productivity.do → Settings → Developer.

Each MCP session is scoped to the API key's owner. Tools and resources
operate on that user's data only.

## Tools

| Tool | Description |
|---|---|
| `create_task` | Add a task with optional due date, priority, project, labels |
| `complete_task` | Mark a task complete |
| `list_tasks` | List open tasks (optional project filter, includeCompleted, limit) |
| `create_event` | Create a calendar event |
| `list_events` | List events in a date range |
| `list_booking_pages` | List the user's booking pages |

## Resources

| URI | Description |
|---|---|
| `productivity://tasks` | All open tasks |
| `productivity://today` | Today's events + tasks |

## Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "productivity-do": {
      "url": "https://productivity.do/mcp",
      "headers": {
        "Authorization": "Bearer pk_live_…"
      }
    }
  }
}
```

## Cursor config

Settings → Features → Model Context Protocol → Add server with URL
`https://productivity.do/mcp` and a Bearer header.

## Other clients

Cline, Continue, Aider, Roo Code — same shape. Any MCP client that
supports Streamable HTTP transport will work.

## What this does NOT cover

- VS Code without an MCP-aware extension (Cline does it; raw VS Code
  does not)
- JetBrains IDEs (no MCP yet)
- GitHub Copilot (proprietary; no MCP)

For those, see future plans in `docs/BACKLOG-INTEGRATIONS-AND-PLATFORMS.md`.
