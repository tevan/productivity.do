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

  // Project surface — added with the projects-as-first-class work. These
  // expose the metadata productivity.do owns (pin state, due date, intent
  // line, rhythm) plus the derived ranker output for "what should I do
  // right now" so an external agent can drive the same decision surface
  // a human uses.
  server.tool(
    'list_pinned_projects',
    {
      description: 'List the user\'s pinned projects (the ones that get top billing in the decision surface). Includes project name, due date, and intent line if set.',
      inputSchema: { type: 'object', properties: {} },
    },
    async () => {
      const rows = q(`
        SELECT pm.project_id, pm.due_date, pm.intent_line, pm.pinned_at,
               (SELECT project_name FROM tasks_cache
                  WHERE user_id = pm.user_id AND project_id = pm.project_id LIMIT 1) AS name
          FROM project_meta pm
         WHERE pm.user_id = ? AND pm.pinned_at IS NOT NULL
         ORDER BY pm.pinned_at
      `).all(userId);
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    }
  );

  server.tool(
    'set_project_pin',
    {
      description: 'Pin or unpin a project from the decision surface. Cap of 3 pinned at a time. projectId is the Todoist project id (string) or "native:<int>" for native projects.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID' },
          pinned: { type: 'boolean', description: 'true to pin, false to unpin' },
        },
        required: ['projectId', 'pinned'],
      },
    },
    async ({ projectId, pinned }) => {
      const existing = q(
        'SELECT * FROM project_meta WHERE user_id = ? AND project_id = ?'
      ).get(userId, projectId);
      if (pinned && (!existing || !existing.pinned_at)) {
        const c = q(
          'SELECT COUNT(*) AS n FROM project_meta WHERE user_id = ? AND pinned_at IS NOT NULL'
        ).get(userId).n;
        if (c >= 3) {
          return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'Pin cap reached (3). Unpin one first.' }) }] };
        }
      }
      const pinnedAt = pinned ? (existing?.pinned_at || new Date().toISOString()) : null;
      q(`
        INSERT INTO project_meta (user_id, project_id, pinned_at, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, project_id) DO UPDATE SET
          pinned_at = excluded.pinned_at,
          updated_at = datetime('now')
      `).run(userId, projectId, pinnedAt);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, projectId, pinned: !!pinnedAt }) }] };
    }
  );

  server.tool(
    'get_project_context',
    {
      description: 'Get the full picture of a project: open tasks, momentum, due date, intent line, and recent activity. Mirrors what a user sees on the project page.',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string', description: 'Project ID' } },
        required: ['projectId'],
      },
    },
    async ({ projectId }) => {
      // Reuse the same query shape /api/projects/:id/context uses, but
      // condensed to the agent-relevant slice.
      const meta = q(
        'SELECT due_date, intent_line, rhythm_json, pinned_at FROM project_meta WHERE user_id = ? AND project_id = ?'
      ).get(userId, projectId) || {};
      const tasks = q(`
        SELECT todoist_id AS id, content, due_date, priority, is_completed
          FROM tasks_cache
         WHERE user_id = ? AND project_id = ?
         ORDER BY is_completed ASC, priority DESC
         LIMIT 50
      `).all(userId, projectId);
      const completed7d = q(`
        SELECT COUNT(*) AS n FROM tasks_cache
         WHERE user_id = ? AND project_id = ?
           AND is_completed = 1 AND completed_at >= datetime('now', '-7 days')
      `).get(userId, projectId).n;
      const data = {
        projectId,
        meta: {
          dueDate: meta.due_date || null,
          intentLine: meta.intent_line || null,
          pinnedAt: meta.pinned_at || null,
        },
        openTaskCount: tasks.filter(t => !t.is_completed).length,
        completed7d,
        recentTasks: tasks.slice(0, 20),
      };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
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

  // The ranked decision surface — what the "what should I do right now"
  // surface returns to the user, served as a resource so an agent can
  // read it and propose actions.
  server.resource(
    'decisions',
    'productivity://decisions',
    { description: 'Ranked tasks for the user to do next, with score reasons. Mirrors /api/today\'s ranker output.' },
    async (uri) => {
      // Pull a thin slice — overdue + due-today, ranked by priority +
      // due as a fallback. Full ranker requires today.js context; this
      // resource is the cheap version. Agents that want the full
      // composite should call GET /api/today via HTTP.
      const today = new Date().toISOString().slice(0, 10);
      const rows = q(`
        SELECT todoist_id AS id, content, due_date AS dueDate,
               priority, project_id AS projectId, project_name AS projectName,
               estimated_minutes AS estimatedMinutes
          FROM tasks_cache
         WHERE user_id = ?
           AND (is_completed = 0 OR is_completed IS NULL)
           AND (due_date <= ? OR due_datetime <= datetime('now', '+24 hours'))
         ORDER BY (CASE WHEN due_date < ? THEN 0 ELSE 1 END), priority DESC, due_date
         LIMIT 50
      `).all(userId, today, today);
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ date: today, tasks: rows }, null, 2) }],
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
