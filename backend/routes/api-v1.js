/**
 * Public, versioned API surface for third-party developers.
 *
 * Auth: Bearer API key (managed in Settings → Developer). Session auth also
 * works for in-app access. Each route specifies a required scope.
 *
 * Stability: this is /api/v1/* — breaking changes will land on /api/v2.
 */

import { Router } from 'express';
import cors from 'cors';
import { getDb } from '../db/init.js';
import { requireApi } from '../lib/apiKeys.js';
import * as google from '../lib/google.js';
import * as todoist from '../lib/todoist.js';
import {
  listSubscriptions,
  createSubscription,
  updateSubscription,
  rotateSubscriptionSecret,
  deleteSubscription,
} from '../lib/webhooks.js';
import { apiPage } from '../lib/bookingMappers.js';
import { emitEvent } from '../lib/webhooks.js';
import { idempotency } from '../middleware/idempotency.js';

const router = Router();

// CORS for third-party browser clients on /api/v1 only.
// `origin: '*'` is non-reflected — browsers will refuse to send cookies even
// if the SPA's same-origin session cookie exists. Combined with `credentials:
// false` this means the only way to authenticate cross-origin is via a Bearer
// API key (which is the intent for third-party callers).
const v1Cors = cors({
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
});
router.use(v1Cors);

// Per-key rate limiting (rolling 1-minute window). Persisted in SQLite so
// the bucket survives PM2 restarts — a client can't burst over the limit by
// catching the server during a redeploy.
const RL_MAX = 120;
const RL_WINDOW_MS = 60_000;

function rateLimit(key, max = RL_MAX) {
  const db = getDb();
  const now = Date.now();
  // Atomic check-and-increment in a single transaction.
  return db.transaction(() => {
    const row = db.prepare('SELECT window_start, count FROM api_v1_rate_buckets WHERE ratekey = ?').get(key);
    if (!row || now - row.window_start > RL_WINDOW_MS) {
      db.prepare(`
        INSERT INTO api_v1_rate_buckets (ratekey, window_start, count)
        VALUES (?, ?, 1)
        ON CONFLICT(ratekey) DO UPDATE SET window_start = excluded.window_start, count = 1
      `).run(key, now);
      return { allowed: true, remaining: max - 1, max };
    }
    if (row.count >= max) {
      return { allowed: false, remaining: 0, retryMs: RL_WINDOW_MS - (now - row.window_start), max };
    }
    db.prepare('UPDATE api_v1_rate_buckets SET count = count + 1 WHERE ratekey = ?').run(key);
    return { allowed: true, remaining: max - row.count - 1, max };
  })();
}

// Periodically prune stale buckets (don't grow the table forever).
setInterval(() => {
  try {
    const cutoff = Date.now() - 5 * RL_WINDOW_MS;
    getDb().prepare('DELETE FROM api_v1_rate_buckets WHERE window_start < ?').run(cutoff);
  } catch {}
}, 5 * RL_WINDOW_MS).unref?.();

router.use((req, res, next) => {
  // Apply rate limit by api key prefix or by ip. Max varies by plan when we
  // can identify the user; otherwise use the default for anonymous traffic.
  const auth = req.get('authorization') || '';
  const m = auth.match(/^Bearer\s+pk_live_([a-z0-9]{8})/i);
  const ratekey = m ? `key:${m[1]}` : `ip:${req.ip}`;

  // Best-effort per-plan limit lookup. We don't want to verify the key twice
  // per request, so we use a small inline lookup through verifyApiKey only
  // when the bearer prefix matches; on miss we fall back to RL_MAX.
  let max = RL_MAX;
  try {
    if (m) {
      // Quick lookup: SELECT user_id FROM api_keys WHERE prefix=? -> users.plan
      const prefix = m[1];
      const row = getDb().prepare(`
        SELECT u.plan FROM api_keys k
        JOIN users u ON u.id = k.user_id
        WHERE k.prefix = ? AND k.revoked_at IS NULL
      `).get(prefix);
      if (row) {
        const limits = (row.plan === 'team') ? 600
                     : (row.plan === 'pro')  ? 120
                     :                          60;
        max = limits;
      }
    } else if (req.session?.userId) {
      const row = getDb().prepare('SELECT plan FROM users WHERE id = ?').get(req.session.userId);
      if (row) {
        max = (row.plan === 'team') ? 600 : (row.plan === 'pro') ? 120 : 60;
      }
    }
  } catch {}

  const r = rateLimit(ratekey, max);
  res.set('X-RateLimit-Limit', String(max));
  res.set('X-RateLimit-Window', String(RL_WINDOW_MS / 1000));
  res.set('X-RateLimit-Remaining', String(Math.max(0, r.remaining)));
  if (!r.allowed) {
    res.set('Retry-After', String(Math.ceil((r.retryMs || RL_WINDOW_MS) / 1000)));
    return res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
  }
  next();
});

// Idempotency-Key replay/cache for write requests. Runs after rate-limit so
// replayed responses still count against the bucket (clients can't bypass
// rate limits by retrying with the same key).
router.use(idempotency);

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------
router.get('/api/v1/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), version: 'v1' });
});

router.get('/api/v1/me', requireApi(), (req, res) => {
  if (req.apiKey) {
    return res.json({ ok: true, kind: 'api_key', key: req.apiKey });
  }
  return res.json({ ok: true, kind: 'session' });
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
router.get('/api/v1/tasks', requireApi(['read:tasks']), async (req, res) => {
  try {
    const tasks = await todoist.listTasks(req.user.id);
    // Merge local-only fields (estimatedMinutes, localStatus, localPosition)
    // from tasks_cache so consumers see the full task shape.
    const localRows = getDb().prepare(
      'SELECT todoist_id, estimated_minutes, local_status, local_position FROM tasks_cache WHERE user_id = ?'
    ).all(req.user.id);
    const localMap = new Map(localRows.map(r => [r.todoist_id, r]));
    res.json({ ok: true, tasks: tasks.map(t => mapTask(t, localMap.get(t.id))) });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/api/v1/tasks', requireApi(['write:tasks']), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.content) return res.status(400).json({ ok: false, error: 'content required' });
    const t = await todoist.createTask({
      content: b.content,
      description: b.description,
      priority: b.priority,
      due_date: b.dueDate,
      due_datetime: b.dueDatetime,
      labels: b.labels,
      project_id: b.projectId,
    }, req.user.id);
    // Persist any local-only fields the client provided alongside creation.
    const db = getDb();
    if (b.estimatedMinutes !== undefined || b.localStatus !== undefined) {
      const v = Number(b.estimatedMinutes);
      const status = b.localStatus === '' ? null : b.localStatus;
      db.prepare(`
        INSERT INTO tasks_cache (user_id, todoist_id, content, priority, is_completed, estimated_minutes, local_status, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?, datetime('now'))
        ON CONFLICT(user_id, todoist_id) DO UPDATE SET
          estimated_minutes = excluded.estimated_minutes,
          local_status = excluded.local_status,
          updated_at = datetime('now')
      `).run(
        req.user.id, t.id, t.content, t.priority || 1,
        Number.isFinite(v) && v > 0 ? Math.round(v) : null,
        status ?? null,
      );
    }
    const local = db.prepare(
      'SELECT estimated_minutes, local_status, local_position FROM tasks_cache WHERE user_id = ? AND todoist_id = ?'
    ).get(req.user.id, t.id);
    res.json({ ok: true, task: mapTask(t, local) });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.put('/api/v1/tasks/:id', requireApi(['write:tasks']), async (req, res) => {
  try {
    const b = req.body || {};
    const db = getDb();

    // Local-only fields (board status / position / time estimate). Never
    // round-trip through Todoist. See docs/internal/tasks-board.md.
    if (b.estimatedMinutes !== undefined) {
      const v = Number(b.estimatedMinutes);
      db.prepare(
        "UPDATE tasks_cache SET estimated_minutes = ?, updated_at = datetime('now') WHERE user_id = ? AND todoist_id = ?"
      ).run(Number.isFinite(v) && v > 0 ? Math.round(v) : null, req.user.id, req.params.id);
    }
    if (b.localStatus !== undefined) {
      const v = b.localStatus === '' ? null : b.localStatus;
      const allowed = v === null || v === 'todo' || v === 'in_progress' || /^custom_[A-Za-z0-9_-]{1,32}$/.test(v);
      if (!allowed) return res.status(400).json({ ok: false, error: 'Invalid localStatus' });
      const prev = db.prepare(
        'SELECT local_status FROM tasks_cache WHERE user_id = ? AND todoist_id = ?'
      ).get(req.user.id, req.params.id)?.local_status || null;
      db.prepare(
        "UPDATE tasks_cache SET local_status = ?, updated_at = datetime('now') WHERE user_id = ? AND todoist_id = ?"
      ).run(v, req.user.id, req.params.id);
      if (prev !== v) {
        emitEvent('task.moved', { id: req.params.id, fromStatus: prev, toStatus: v }, req.user.id).catch(() => {});
      }
    }
    if (b.localPosition !== undefined) {
      const v = Number(b.localPosition);
      db.prepare(
        "UPDATE tasks_cache SET local_position = ?, updated_at = datetime('now') WHERE user_id = ? AND todoist_id = ?"
      ).run(Number.isFinite(v) ? Math.round(v) : null, req.user.id, req.params.id);
    }

    const updates = {};
    if (b.content !== undefined) updates.content = b.content;
    if (b.description !== undefined) updates.description = b.description;
    if (b.priority !== undefined) updates.priority = b.priority;
    if (b.dueDate !== undefined) updates.due_date = b.dueDate;
    if (b.dueDatetime !== undefined) updates.due_datetime = b.dueDatetime;
    if (b.labels !== undefined) updates.labels = b.labels;
    let t = null;
    if (Object.keys(updates).length) t = await todoist.updateTask(req.params.id, updates, req.user.id);
    if (b.projectId) t = await todoist.moveTask(req.params.id, { projectId: b.projectId }, req.user.id);

    const local = db.prepare(
      'SELECT estimated_minutes, local_status, local_position FROM tasks_cache WHERE user_id = ? AND todoist_id = ?'
    ).get(req.user.id, req.params.id);
    res.json({ ok: true, task: t ? mapTask(t, local) : { id: req.params.id, ...mapLocal(local) } });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/api/v1/tasks/:id/complete', requireApi(['write:tasks']), async (req, res) => {
  try { await todoist.completeTask(req.params.id, req.user.id); res.json({ ok: true }); }
  catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

router.post('/api/v1/tasks/:id/reopen', requireApi(['write:tasks']), async (req, res) => {
  try { await todoist.reopenTask(req.params.id, req.user.id); res.json({ ok: true }); }
  catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

router.delete('/api/v1/tasks/:id', requireApi(['write:tasks']), async (req, res) => {
  try { await todoist.deleteTask(req.params.id, req.user.id); res.json({ ok: true }); }
  catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// Task columns (kanban configuration)
// Read-only for third parties. Adding / renaming / removing columns is an
// in-app concern; we don't surface mutation endpoints here to keep the
// public API focused on the data plane.
// ---------------------------------------------------------------------------
router.get('/api/v1/task-columns', requireApi(['read:tasks']), (req, res) => {
  try {
    const cols = getDb().prepare(
      'SELECT id, position, name, status_key FROM task_columns WHERE user_id = ? ORDER BY position'
    ).all(req.user.id);
    res.json({
      ok: true,
      columns: cols.map(c => ({ id: c.id, position: c.position, name: c.name, statusKey: c.status_key })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Projects — full CRUD. Tasks reference projects by id; renaming/recoloring
// here flows through the user's Todoist directly.
// ---------------------------------------------------------------------------
router.get('/api/v1/projects', requireApi(['read:tasks']), async (req, res) => {
  try {
    const projects = await todoist.listProjects(req.user.id);
    res.json({ ok: true, projects: projects.map(mapProject) });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

router.post('/api/v1/projects', requireApi(['write:tasks']), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim()) return res.status(400).json({ ok: false, error: 'name required' });
    const project = await todoist.createProject({
      name: b.name.trim(), color: b.color, parentId: b.parentId, isFavorite: b.isFavorite,
    }, req.user.id);
    res.json({ ok: true, project: mapProject(project) });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

router.put('/api/v1/projects/:id', requireApi(['write:tasks']), async (req, res) => {
  try {
    const project = await todoist.updateProject(req.params.id, req.body || {}, req.user.id);
    res.json({ ok: true, project: mapProject(project) });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

router.delete('/api/v1/projects/:id', requireApi(['write:tasks']), async (req, res) => {
  try {
    await todoist.deleteProject(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// Sections — Todoist columns within a project.
// ---------------------------------------------------------------------------
router.get('/api/v1/sections', requireApi(['read:tasks']), async (req, res) => {
  try {
    const sections = await todoist.listSections({ projectId: req.query.projectId }, req.user.id);
    res.json({ ok: true, sections: sections.map(mapSection) });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

router.post('/api/v1/sections', requireApi(['write:tasks']), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim() || !b.projectId) return res.status(400).json({ ok: false, error: 'name + projectId required' });
    const section = await todoist.createSection({ name: b.name.trim(), projectId: b.projectId, order: b.order }, req.user.id);
    res.json({ ok: true, section: mapSection(section) });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

router.put('/api/v1/sections/:id', requireApi(['write:tasks']), async (req, res) => {
  try {
    const section = await todoist.updateSection(req.params.id, req.body || {}, req.user.id);
    res.json({ ok: true, section: mapSection(section) });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

router.delete('/api/v1/sections/:id', requireApi(['write:tasks']), async (req, res) => {
  try {
    await todoist.deleteSection(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// Labels — full CRUD for the label registry.
// ---------------------------------------------------------------------------
router.get('/api/v1/labels', requireApi(['read:tasks']), async (req, res) => {
  try {
    const labels = await todoist.listLabels(req.user.id);
    res.json({ ok: true, labels: labels.map(mapLabel) });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

router.post('/api/v1/labels', requireApi(['write:tasks']), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim()) return res.status(400).json({ ok: false, error: 'name required' });
    const label = await todoist.createLabel({ name: b.name.trim(), color: b.color, isFavorite: b.isFavorite }, req.user.id);
    res.json({ ok: true, label: mapLabel(label) });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

router.put('/api/v1/labels/:id', requireApi(['write:tasks']), async (req, res) => {
  try {
    const label = await todoist.updateLabel(req.params.id, req.body || {}, req.user.id);
    res.json({ ok: true, label: mapLabel(label) });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

router.delete('/api/v1/labels/:id', requireApi(['write:tasks']), async (req, res) => {
  try {
    await todoist.deleteLabel(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// Filters (read-only, Pro feature; returns [] silently for free accounts).
// ---------------------------------------------------------------------------
router.get('/api/v1/filters', requireApi(['read:tasks']), async (req, res) => {
  try {
    const filters = await todoist.listFilters(req.user.id);
    res.json({ ok: true, filters });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// Comments — per-task threaded comments.
// ---------------------------------------------------------------------------
router.get('/api/v1/tasks/:id/comments', requireApi(['read:tasks']), async (req, res) => {
  try {
    const comments = await todoist.listTaskComments(req.params.id, req.user.id);
    res.json({ ok: true, comments: comments.map(mapComment) });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

router.post('/api/v1/tasks/:id/comments', requireApi(['write:tasks']), async (req, res) => {
  try {
    const { content } = req.body || {};
    if (!content?.trim()) return res.status(400).json({ ok: false, error: 'content required' });
    const comment = await todoist.createTaskComment({ taskId: req.params.id, content: content.trim() }, req.user.id);
    res.json({ ok: true, comment: mapComment(comment) });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

router.put('/api/v1/comments/:id', requireApi(['write:tasks']), async (req, res) => {
  try {
    const { content } = req.body || {};
    if (!content?.trim()) return res.status(400).json({ ok: false, error: 'content required' });
    const comment = await todoist.updateComment(req.params.id, content.trim(), req.user.id);
    res.json({ ok: true, comment: mapComment(comment) });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

router.delete('/api/v1/comments/:id', requireApi(['write:tasks']), async (req, res) => {
  try {
    await todoist.deleteComment(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// Quick add — natural-language task creation.
// Body: { text: string }. Returns the parsed/created task.
// ---------------------------------------------------------------------------
router.post('/api/v1/tasks/quick', requireApi(['write:tasks']), async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ ok: false, error: 'text required' });
    const task = await todoist.quickAddTask(text.trim(), req.user.id);
    res.json({ ok: true, task: mapTask(task, null) });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// Reminders (read-only, Pro feature).
// ---------------------------------------------------------------------------
router.get('/api/v1/reminders', requireApi(['read:tasks']), async (req, res) => {
  try {
    const reminders = await todoist.listReminders(req.user.id);
    res.json({ ok: true, reminders });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// Bulk update — apply patches to many tasks. Body: { items: [{id, ...patch}] }.
// ---------------------------------------------------------------------------
router.put('/api/v1/tasks/bulk', requireApi(['write:tasks']), async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items) return res.status(400).json({ ok: false, error: 'items array required' });
    if (items.length > 100) return res.status(400).json({ ok: false, error: 'max 100 items per request' });
    const results = await todoist.bulkUpdateTasks(items, req.user.id);
    res.json({ ok: true, results });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

function mapProject(p) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    parentId: p.parent_id || null,
    order: p.order,
    isFavorite: !!p.is_favorite,
    isInboxProject: !!p.is_inbox_project,
    url: p.url,
  };
}
function mapSection(s) {
  return { id: s.id, name: s.name, projectId: s.project_id, order: s.order };
}
function mapLabel(l) {
  return { id: l.id, name: l.name, color: l.color, order: l.order, isFavorite: !!l.is_favorite };
}
function mapComment(c) {
  return { id: c.id, content: c.content, postedAt: c.posted_at, attachment: c.attachment || null };
}

function mapLocal(local) {
  return {
    estimatedMinutes: local?.estimated_minutes || null,
    localStatus: local?.local_status || null,
    localPosition: local?.local_position ?? null,
  };
}

function mapTask(t, local) {
  return {
    id: t.id,
    content: t.content,
    description: t.description,
    projectId: t.project_id,
    priority: t.priority,
    dueDate: t.due?.date || null,
    dueDatetime: t.due?.datetime || null,
    labels: t.labels || [],
    isCompleted: !!t.is_completed,
    parentId: t.parent_id || null,
    url: t.url,
    ...mapLocal(local),
  };
}

// ---------------------------------------------------------------------------
// Calendars + events
// ---------------------------------------------------------------------------
router.get('/api/v1/calendars', requireApi(['read:calendars']), async (req, res) => {
  try {
    const cals = await google.listCalendars(req.user.id);
    res.json({
      ok: true,
      calendars: cals.map(c => ({
        id: c.id,
        summary: c.summary,
        primary: !!c.primary,
        timeZone: c.timeZone,
        backgroundColor: c.backgroundColor,
        foregroundColor: c.foregroundColor,
      })),
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/api/v1/events', requireApi(['read:events']), async (req, res) => {
  try {
    if (!req.query.calendarId) return res.status(400).json({ ok: false, error: 'calendarId required' });
    if (!req.query.timeMin || !req.query.timeMax) return res.status(400).json({ ok: false, error: 'timeMin and timeMax required (ISO)' });
    const evs = await google.listEvents(req.user.id, req.query.calendarId, req.query.timeMin, req.query.timeMax);
    res.json({ ok: true, events: evs.map(mapEvent) });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/api/v1/events', requireApi(['write:events']), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.calendarId) return res.status(400).json({ ok: false, error: 'calendarId required' });
    const ev = await google.createEvent(req.user.id, b.calendarId, {
      summary: b.summary,
      description: b.description,
      location: b.location,
      start: b.allDay ? { date: b.start } : { dateTime: b.start, timeZone: b.timezone },
      end:   b.allDay ? { date: b.end }   : { dateTime: b.end,   timeZone: b.timezone },
      attendees: b.attendees,
    });
    res.json({ ok: true, event: mapEvent(ev) });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.put('/api/v1/events/:calendarId/:eventId', requireApi(['write:events']), async (req, res) => {
  try {
    const ev = await google.updateEvent(req.user.id, req.params.calendarId, req.params.eventId, req.body || {});
    res.json({ ok: true, event: mapEvent(ev) });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.delete('/api/v1/events/:calendarId/:eventId', requireApi(['write:events']), async (req, res) => {
  try {
    await google.deleteEvent(req.user.id, req.params.calendarId, req.params.eventId);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Bulk endpoints — POST [{...}, ...], cap 100/request, partial success allowed.
// Returns { ok, results: [{ index, ok, ...resource | error }] }.
// Each item counts toward rate limit equally; the request itself is one bucket.
// ---------------------------------------------------------------------------
const BULK_MAX = 100;

router.post('/api/v1/events/bulk', requireApi(['write:events']), async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) return res.status(400).json({ ok: false, error: 'items array required' });
  if (items.length > BULK_MAX) return res.status(400).json({ ok: false, error: `max ${BULK_MAX} items per request` });

  const results = [];
  for (let i = 0; i < items.length; i++) {
    const b = items[i] || {};
    if (!b.calendarId) {
      results.push({ index: i, ok: false, error: 'calendarId required' });
      continue;
    }
    try {
      const ev = await google.createEvent(req.user.id, b.calendarId, {
        summary: b.summary,
        description: b.description,
        location: b.location,
        start: b.allDay ? { date: b.start } : { dateTime: b.start, timeZone: b.timezone },
        end:   b.allDay ? { date: b.end }   : { dateTime: b.end,   timeZone: b.timezone },
        attendees: b.attendees,
      });
      results.push({ index: i, ok: true, event: mapEvent(ev) });
    } catch (err) {
      results.push({ index: i, ok: false, error: err.message });
    }
  }
  res.json({ ok: true, results });
});

router.post('/api/v1/tasks/bulk', requireApi(['write:tasks']), async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) return res.status(400).json({ ok: false, error: 'items array required' });
  if (items.length > BULK_MAX) return res.status(400).json({ ok: false, error: `max ${BULK_MAX} items per request` });

  const results = [];
  for (let i = 0; i < items.length; i++) {
    const b = items[i] || {};
    if (!b.content) {
      results.push({ index: i, ok: false, error: 'content required' });
      continue;
    }
    try {
      const t = await todoist.createTask({
        content: b.content,
        description: b.description,
        priority: b.priority,
        due_date: b.dueDate,
        due_datetime: b.dueDatetime,
        labels: b.labels,
        project_id: b.projectId,
      }, req.user.id);
      results.push({ index: i, ok: true, task: mapTask(t, null) });
    } catch (err) {
      results.push({ index: i, ok: false, error: err.message });
    }
  }
  res.json({ ok: true, results });
});

function mapEvent(ev) {
  return {
    id: ev.id,
    summary: ev.summary,
    description: ev.description,
    location: ev.location,
    start: ev.start?.dateTime || ev.start?.date,
    end: ev.end?.dateTime || ev.end?.date,
    allDay: !ev.start?.dateTime,
    htmlLink: ev.htmlLink,
    status: ev.status,
  };
}

// ---------------------------------------------------------------------------
// Booking pages + bookings (read access via API)
// ---------------------------------------------------------------------------
router.get('/api/v1/booking-pages', requireApi(['read:bookings']), (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM booking_pages WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ ok: true, pages: rows.map(apiPage) });
});

router.get('/api/v1/booking-pages/:id', requireApi(['read:bookings']), (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM booking_pages WHERE (id = ? OR slug = ?) AND user_id = ?').get(req.params.id, req.params.id, req.user.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, page: apiPage(row) });
});

router.get('/api/v1/booking-pages/:id/bookings', requireApi(['read:bookings']), (req, res) => {
  const db = getDb();
  const page = db.prepare('SELECT id FROM booking_pages WHERE (id = ? OR slug = ?) AND user_id = ?').get(req.params.id, req.params.id, req.user.id);
  if (!page) return res.status(404).json({ ok: false, error: 'Page not found' });
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const rows = db.prepare(`
    SELECT id, page_id, type_id, invitee_name, invitee_email, invitee_phone,
           start_iso, end_iso, timezone, status, created_at
    FROM bookings WHERE page_id = ?
    ORDER BY start_iso DESC LIMIT ?
  `).all(page.id, limit);
  res.json({ ok: true, bookings: rows });
});

// ---------------------------------------------------------------------------
// Webhook subscriptions
// ---------------------------------------------------------------------------
router.get('/api/v1/webhooks', requireApi(['read:webhooks']), (req, res) => {
  res.json({ ok: true, subscriptions: listSubscriptions(req.user.id) });
});

router.post('/api/v1/webhooks', requireApi(['write:webhooks']), (req, res) => {
  const b = req.body || {};
  if (!b.url) return res.status(400).json({ ok: false, error: 'url required' });
  if (!Array.isArray(b.events) || b.events.length === 0) {
    return res.status(400).json({ ok: false, error: 'events[] required (e.g. ["booking.created"])' });
  }
  const sub = createSubscription({ url: b.url, events: b.events, secret: b.secret, userId: req.user.id });
  res.json({ ok: true, subscription: sub });
});

router.put('/api/v1/webhooks/:id', requireApi(['write:webhooks']), (req, res) => {
  const sub = updateSubscription(req.params.id, req.body || {}, req.user.id);
  if (!sub) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, subscription: sub });
});

router.post('/api/v1/webhooks/:id/rotate-secret', requireApi(['write:webhooks']), (req, res) => {
  const result = rotateSubscriptionSecret(req.params.id, req.user.id);
  if (!result) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, ...result });
});

router.delete('/api/v1/webhooks/:id', requireApi(['write:webhooks']), (req, res) => {
  deleteSubscription(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// OpenAPI spec
// ---------------------------------------------------------------------------
router.get('/api/v1/openapi.json', (req, res) => {
  res.json(buildOpenApi(req));
});

function buildOpenApi(req) {
  const origin = process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
  return {
    openapi: '3.1.0',
    info: {
      title: 'productivity.do API',
      version: '1.0.0',
      description: [
        'Calendar, tasks, and booking-pages API for third-party integrations.',
        '',
        '**Idempotency:** all write requests (POST/PUT/PATCH/DELETE) accept an',
        '`Idempotency-Key` header (8–128 chars). The first successful response',
        'is cached per (user, key) for 24h; retries with the same key return',
        'the same status + body without re-executing the side effect. The',
        'replay carries an `Idempotent-Replayed: true` response header. Only',
        '2xx responses are cached — validation errors are not.',
      ].join('\n'),
    },
    servers: [{ url: `${origin}/api/v1` }],
    components: {
      securitySchemes: {
        BearerAuth: { type: 'http', scheme: 'bearer', description: 'API key in `Authorization: Bearer pk_live_...` header.' },
      },
    },
    security: [{ BearerAuth: [] }],
    paths: {
      '/ping': { get: { summary: 'Liveness check', security: [], responses: { '200': okJson() } } },
      '/me': { get: { summary: 'Identify the calling principal', responses: { '200': okJson() } } },
      '/tasks': {
        get: {
          summary: 'List active tasks',
          description: 'Returns Todoist-backed tasks with productivity.do-only fields merged in (estimatedMinutes, localStatus, localPosition, parentId).',
          responses: { '200': okJson() },
        },
        post: {
          summary: 'Create a task',
          description: 'Creates a Todoist task. Optional `estimatedMinutes` and `localStatus` (`todo` | `in_progress` | `custom_<n>`) are stored locally on productivity.do — Todoist never sees them.',
          requestBody: jsonBody({
            content: 'string',
            description: 'string',
            priority: 'integer (1-4)',
            dueDate: 'string (YYYY-MM-DD)',
            dueDatetime: 'string (ISO)',
            labels: 'string[]',
            projectId: 'string',
            estimatedMinutes: 'integer (optional, productivity.do-only)',
            localStatus: "'todo' | 'in_progress' | 'custom_<n>' (optional, productivity.do-only)",
          }),
          responses: { '200': okJson() },
        },
      },
      '/tasks/{id}': {
        put: {
          summary: 'Update a task',
          description: 'Patches Todoist fields and/or productivity.do-only fields. Setting `localStatus` to "todo" or "in_progress" moves the card on the kanban board without affecting Todoist. Setting it to null clears the status. To mark a task done, use POST /tasks/{id}/complete — done is NOT a writable localStatus.',
          parameters: [pathParam('id')],
          requestBody: jsonBody({
            content: 'string',
            description: 'string',
            priority: 'integer (1-4)',
            dueDate: 'string',
            dueDatetime: 'string',
            labels: 'string[]',
            projectId: 'string',
            estimatedMinutes: 'integer (optional)',
            localStatus: "'todo' | 'in_progress' | 'custom_<n>' | null",
            localPosition: 'integer (optional, manual sort order within column)',
          }),
          responses: { '200': okJson() },
        },
        delete: { summary: 'Delete a task', parameters: [pathParam('id')], responses: { '200': okJson() } },
      },
      '/tasks/{id}/complete': { post: { summary: 'Complete a task (canonical "done" action)', parameters: [pathParam('id')], responses: { '200': okJson() } } },
      '/tasks/{id}/reopen':   { post: { summary: 'Reopen a completed task', parameters: [pathParam('id')], responses: { '200': okJson() } } },
      '/task-columns': {
        get: {
          summary: 'List the kanban board columns configured for the calling user',
          description: 'Returns columns ordered left-to-right. Each column has a stable `statusKey` (`todo`, `in_progress`, `done`, or `custom_<n>`) and a user-customizable `name`. Use the statusKey when writing `localStatus` on /tasks/{id}.',
          responses: { '200': okJson() },
        },
      },
      '/tasks/quick': {
        post: {
          summary: "Create a task from natural-language text (Todoist's quick-add parser)",
          description: 'Body: `{ text: "Buy milk tomorrow at 5pm @errands p1" }`. Date, label, and priority are parsed by Todoist. Useful for command-bar UX.',
          requestBody: jsonBody({ text: 'string (required)' }),
          responses: { '200': okJson() },
        },
      },
      '/tasks/{id}/comments': {
        get: { summary: 'List comments on a task', parameters: [pathParam('id')], responses: { '200': okJson() } },
        post: {
          summary: 'Add a comment to a task',
          parameters: [pathParam('id')],
          requestBody: jsonBody({ content: 'string (required, markdown-supported)' }),
          responses: { '200': okJson() },
        },
      },
      '/comments/{id}': {
        put: { summary: 'Update a comment', parameters: [pathParam('id')], requestBody: jsonBody({ content: 'string' }), responses: { '200': okJson() } },
        delete: { summary: 'Delete a comment', parameters: [pathParam('id')], responses: { '200': okJson() } },
      },
      '/projects': {
        get: { summary: 'List Todoist projects', responses: { '200': okJson() } },
        post: {
          summary: 'Create a project',
          requestBody: jsonBody({ name: 'string (required)', color: 'string', parentId: 'string', isFavorite: 'boolean' }),
          responses: { '200': okJson() },
        },
      },
      '/projects/{id}': {
        put: {
          summary: 'Update project (rename, recolor, favorite)',
          parameters: [pathParam('id')],
          requestBody: jsonBody({ name: 'string', color: 'string', isFavorite: 'boolean' }),
          responses: { '200': okJson() },
        },
        delete: { summary: 'Delete a project', parameters: [pathParam('id')], responses: { '200': okJson() } },
      },
      '/sections': {
        get: { summary: 'List sections (optionally scoped to a projectId query param)', responses: { '200': okJson() } },
        post: {
          summary: 'Create a section in a project',
          requestBody: jsonBody({ name: 'string (required)', projectId: 'string (required)', order: 'integer' }),
          responses: { '200': okJson() },
        },
      },
      '/sections/{id}': {
        put: { summary: 'Rename a section', parameters: [pathParam('id')], requestBody: jsonBody({ name: 'string' }), responses: { '200': okJson() } },
        delete: { summary: 'Delete a section', parameters: [pathParam('id')], responses: { '200': okJson() } },
      },
      '/labels': {
        get: { summary: 'List labels', responses: { '200': okJson() } },
        post: {
          summary: 'Create a label',
          requestBody: jsonBody({ name: 'string (required)', color: 'string', isFavorite: 'boolean' }),
          responses: { '200': okJson() },
        },
      },
      '/labels/{id}': {
        put: {
          summary: 'Update a label (rename, recolor, favorite)',
          parameters: [pathParam('id')],
          requestBody: jsonBody({ name: 'string', color: 'string', isFavorite: 'boolean' }),
          responses: { '200': okJson() },
        },
        delete: { summary: 'Delete a label', parameters: [pathParam('id')], responses: { '200': okJson() } },
      },
      '/filters': {
        get: { summary: "List Todoist saved filters (Pro). Returns [] for free accounts.", responses: { '200': okJson() } },
      },
      '/reminders': {
        get: { summary: 'List Todoist reminders (Pro). Returns [] for free accounts.', responses: { '200': okJson() } },
      },
      '/calendars': { get: { summary: 'List calendars', responses: { '200': okJson() } } },
      '/events': {
        get: { summary: 'List events', parameters: [queryParam('calendarId', true), queryParam('timeMin', true), queryParam('timeMax', true)], responses: { '200': okJson() } },
        post: { summary: 'Create event', requestBody: jsonBody({ calendarId: 'string', summary: 'string', description: 'string', location: 'string', start: 'string (ISO)', end: 'string (ISO)', allDay: 'boolean', timezone: 'string', attendees: 'array' }), responses: { '200': okJson() } },
      },
      '/events/{calendarId}/{eventId}': {
        put: { summary: 'Update event', parameters: [pathParam('calendarId'), pathParam('eventId')], responses: { '200': okJson() } },
        delete: { summary: 'Delete event', parameters: [pathParam('calendarId'), pathParam('eventId')], responses: { '200': okJson() } },
      },
      '/events/bulk': {
        post: { summary: 'Bulk-create events (max 100/request)', requestBody: jsonBody({ items: 'array of event objects (same fields as POST /events)' }), responses: { '200': okJson() } },
      },
      '/tasks/bulk': {
        post: { summary: 'Bulk-create tasks (max 100/request)', requestBody: jsonBody({ items: 'array of task objects (same fields as POST /tasks)' }), responses: { '200': okJson() } },
        put: {
          summary: 'Bulk-update tasks. Each item is `{ id, ...patch }` and may include `projectId` to move.',
          requestBody: jsonBody({ items: 'array of { id, ...patch } (max 100 per request)' }),
          responses: { '200': okJson() },
        },
      },
      '/booking-pages': { get: { summary: 'List booking pages', responses: { '200': okJson() } } },
      '/booking-pages/{id}': { get: { summary: 'Get a booking page (id or slug)', parameters: [pathParam('id')], responses: { '200': okJson() } } },
      '/booking-pages/{id}/bookings': { get: { summary: 'List bookings on a page', parameters: [pathParam('id'), queryParam('limit')], responses: { '200': okJson() } } },
      '/webhooks': {
        get: { summary: 'List webhook subscriptions', responses: { '200': okJson() } },
        post: { summary: 'Create webhook subscription', requestBody: jsonBody({ url: 'string', events: 'string[]', secret: 'string (optional)' }), responses: { '200': okJson() } },
      },
      '/webhooks/{id}': {
        put: { summary: 'Update webhook', parameters: [pathParam('id')], responses: { '200': okJson() } },
        delete: { summary: 'Delete webhook', parameters: [pathParam('id')], responses: { '200': okJson() } },
      },
      '/webhooks/{id}/rotate-secret': { post: { summary: 'Rotate webhook signing secret', parameters: [pathParam('id')], responses: { '200': okJson() } } },
    },
  };
}

function okJson() { return { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } }; }
function pathParam(name) { return { name, in: 'path', required: true, schema: { type: 'string' } }; }
function queryParam(name, required = false) { return { name, in: 'query', required, schema: { type: 'string' } }; }
function jsonBody(props) { return { required: true, content: { 'application/json': { schema: { type: 'object', properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, { description: v }])) } } } }; }

export default router;
