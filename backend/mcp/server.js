// productivity.do MCP server.
//
// Exposes our data as MCP resources and our actions as MCP tools. Any
// MCP-aware client (Claude Code, Claude Desktop, Cursor, Cline, Continue,
// Aider, etc.) can connect by adding our endpoint to its config and
// pasting an API key.
//
// Transport: streamable HTTP (the modern HTTP+SSE replacement). Mounted
// at `POST /mcp` (server-to-client) and `GET /mcp` (client polls). One
// session per connection.
//
// Auth: Bearer pk_live_<prefix>.<secret> — same scheme as /api/v1. We
// reuse `requireApi()` style validation. Tokens are user-scoped, so each
// MCP session represents the API key's owner.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import crypto from 'node:crypto';
import { getDb, q } from '../db/init.js';

// -------- API key auth --------
// Mirrors /api/v1's auth so the same `pk_live_…` keys work in MCP. Returns
// `{ userId, key }` on success or null.
function authenticateBearer(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  // Format: pk_live_<prefix>.<secret>
  const m = token.match(/^pk_live_([^.]+)\.(.+)$/);
  if (!m) return null;
  const [, prefix, secret] = m;
  const row = q(
    'SELECT user_id, key_hash, scopes FROM api_keys WHERE prefix = ? AND revoked_at IS NULL'
  ).get(prefix);
  if (!row) return null;
  const computed = crypto.createHash('sha256').update(secret).digest();
  const stored = Buffer.from(row.key_hash, 'hex');
  if (computed.length !== stored.length) return null;
  if (!crypto.timingSafeEqual(computed, stored)) return null;
  // Touch last_used_at (cheap; safe to await fire-and-forget)
  q('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE prefix = ?').run(prefix);
  return { userId: row.user_id, scopes: (row.scopes || '').split(',').filter(Boolean) };
}

// -------- Build the McpServer with our resources + tools --------
function buildServer(userId) {
  const server = new McpServer({
    name: 'productivity.do',
    version: '1.0.0',
  });

  // ----- Tools -----
  server.tool(
    'create_task',
    {
      description: 'Create a new task. Lands in the user\'s default project unless projectId is given.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          dueDate: { type: 'string', description: 'YYYY-MM-DD date (optional)' },
          dueDatetime: { type: 'string', description: 'ISO 8601 datetime (optional)' },
          priority: { type: 'integer', minimum: 1, maximum: 4, description: 'Todoist priority 1 (highest) – 4 (lowest)' },
          projectId: { type: 'string', description: 'Project ID (optional)' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Label names' },
          description: { type: 'string', description: 'Task description (markdown supported)' },
        },
        required: ['title'],
      },
    },
    async (args) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      q(`
        INSERT INTO tasks_native (id, user_id, content, description, due_date, due_datetime, priority, project_id, labels_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, userId, args.title, args.description || null,
        args.dueDate || null, args.dueDatetime || null,
        args.priority || 4, args.projectId || null,
        args.labels ? JSON.stringify(args.labels) : null,
        now, now
      );
      return {
        content: [{ type: 'text', text: `Created task "${args.title}" (id: ${id})` }],
      };
    }
  );

  server.tool(
    'complete_task',
    {
      description: 'Mark a task complete.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Task ID' } },
        required: ['id'],
      },
    },
    async (args) => {
      const r = q(
        `UPDATE tasks_native SET is_completed = 1, completed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`
      ).run(args.id, userId);
      if (r.changes === 0) {
        return { content: [{ type: 'text', text: `No task ${args.id} found.` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Completed task ${args.id}.` }] };
    }
  );

  server.tool(
    'list_tasks',
    {
      description: 'List the user\'s open tasks. Optionally filter by project.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          includeCompleted: { type: 'boolean', default: false },
          limit: { type: 'integer', default: 50, maximum: 200 },
        },
      },
    },
    async (args) => {
      const where = [`user_id = ?`];
      const params = [userId];
      if (args?.projectId) { where.push('project_id = ?'); params.push(args.projectId); }
      if (!args?.includeCompleted) where.push('is_completed = 0');
      const rows = q(
        `SELECT id, content, due_date, due_datetime, priority, project_id, labels_json
         FROM tasks_native WHERE ${where.join(' AND ')}
         ORDER BY due_date IS NULL, due_date, priority LIMIT ?`
      ).all(...params, Math.min(args?.limit || 50, 200));
      const items = rows.map(r => ({
        id: r.id,
        title: r.content,
        due: r.due_datetime || r.due_date,
        priority: r.priority,
        projectId: r.project_id,
        labels: r.labels_json ? JSON.parse(r.labels_json) : [],
      }));
      return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
    }
  );

  server.tool(
    'create_event',
    {
      description: 'Create a calendar event.',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          start: { type: 'string', description: 'ISO 8601 datetime' },
          end: { type: 'string', description: 'ISO 8601 datetime' },
          description: { type: 'string' },
          location: { type: 'string' },
        },
        required: ['summary', 'start', 'end'],
      },
    },
    async (args) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      q(`
        INSERT INTO events_native (id, user_id, summary, description, location, start_at, end_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, userId, args.summary, args.description || null, args.location || null, args.start, args.end, now, now);
      return { content: [{ type: 'text', text: `Created event "${args.summary}" (id: ${id})` }] };
    }
  );

  server.tool(
    'list_events',
    {
      description: 'List events in a date range.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'ISO 8601 datetime' },
          to: { type: 'string', description: 'ISO 8601 datetime' },
        },
        required: ['from', 'to'],
      },
    },
    async (args) => {
      const rows = q(
        `SELECT id, summary, start_at, end_at, location
         FROM events_native
         WHERE user_id = ? AND start_at < ? AND end_at > ?
         ORDER BY start_at LIMIT 200`
      ).all(userId, args.to, args.from);
      const items = rows.map(r => ({
        id: r.id, summary: r.summary,
        start: r.start_at, end: r.end_at, location: r.location,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
    }
  );

  server.tool(
    'list_booking_pages',
    {
      description: 'List the user\'s booking pages and recent bookings.',
      inputSchema: { type: 'object', properties: {} },
    },
    async () => {
      const pages = q(
        'SELECT id, slug, title FROM booking_pages WHERE user_id = ?'
      ).all(userId);
      return { content: [{ type: 'text', text: JSON.stringify(pages, null, 2) }] };
    }
  );

  // ----- Resources -----
  // Static enumeration of resource collections, each addressable by URI.
  server.resource(
    'tasks',
    'productivity://tasks',
    { description: 'All open tasks for the authenticated user' },
    async (uri) => {
      const rows = q(
        'SELECT id, content, due_date, priority FROM tasks_native WHERE user_id = ? AND is_completed = 0 ORDER BY due_date'
      ).all(userId);
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(rows, null, 2) }],
      };
    }
  );

  server.resource(
    'today',
    'productivity://today',
    { description: 'Today\'s schedule — events + tasks due today' },
    async (uri) => {
      const start = new Date(); start.setHours(0,0,0,0);
      const end = new Date(); end.setHours(23,59,59,999);
      const events = q(
        `SELECT id, summary, start_at, end_at FROM events_native
         WHERE user_id = ? AND start_at < ? AND end_at > ? ORDER BY start_at`
      ).all(userId, end.toISOString(), start.toISOString());
      const today = start.toISOString().slice(0, 10);
      const tasks = q(
        `SELECT id, content AS title, priority FROM tasks_native
         WHERE user_id = ? AND is_completed = 0 AND due_date = ?`
      ).all(userId, today);
      const data = { date: today, events, tasks };
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  return server;
}

// -------- Express handler --------
// Sessions are kept in memory keyed by the MCP session ID, since each one
// is a streamable HTTP connection that can span multiple requests. The SDK
// handles the actual session protocol; we just wire transports up to the
// authenticated McpServer instance.
const sessions = new Map(); // sessionId -> { transport, server, userId }

export async function handleMcpRequest(req, res) {
  // Auth first — unauthenticated MCP connections are rejected.
  const auth = authenticateBearer(req.headers.authorization);
  if (!auth) {
    res.status(401).json({ error: 'Bearer pk_live_… token required' });
    return;
  }
  const sessionId = req.headers['mcp-session-id'];

  let session = sessionId ? sessions.get(sessionId) : null;

  // New session — create transport + server
  if (!session) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, server, userId: auth.userId });
      },
    });
    const server = buildServer(auth.userId);
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // Existing session — reuse transport. Verify the session belongs to the
  // same user (defense in depth — sessionId guessing should be impossible
  // but we shouldn't trust IDs alone).
  if (session.userId !== auth.userId) {
    res.status(403).json({ error: 'Session belongs to a different user' });
    return;
  }
  await session.transport.handleRequest(req, res, req.body);
}
