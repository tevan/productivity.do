// Revision history.
//
// Captures per-mutation snapshots so the user can scroll back through
// versions of a note or task and restore one. Geewax doesn't cover this
// (it's a product feature, not an API pattern); the inspiration is
// Notion/Linear/Google-Docs version history.
//
// Storage shape: a single `revisions` table holds rows for every
// resource we track. `op` is one of 'create' | 'update' | 'delete' |
// 'restore' | 'soft_delete'. `before_json` / `after_json` are the
// per-resource projection (exactly what the user sees / edits — not the
// raw DB row, which can have internal fields like `local_status`).
//
// Retention: 90 days, swept by startRevisionsSweeper(). For active
// resources that exceeds the 50-revision cap (oldest dropped first) we
// also hard-cap per-resource to keep the table from growing without
// bound on a single hot row.
//
// Why a single table instead of `note_revisions` / `task_revisions`:
//   - the read pattern is the same shape regardless (id-based scroll)
//   - the activity-log surface in Settings benefits from a unified feed
//   - one sweeper covers everything
//
// Why store the projection rather than the diff:
//   - simpler restore (overwrite back to the projection's fields)
//   - simpler diff rendering — the viewer computes the diff on demand
//   - storage cost is low (notes <200KB, tasks <2KB; we cap at 50/row)

import { getDb } from '../db/init.js';

const RETAIN_DAYS = 90;
const PER_RESOURCE_CAP = 50;

export function recordRevision({ userId, resource, resourceId, op, before, after }) {
  // Skip no-op updates: if before == after, don't store a row. Saves
  // table churn from autosaves that touch nothing meaningful.
  if (op === 'update') {
    try {
      if (JSON.stringify(before) === JSON.stringify(after)) return;
    } catch {}
  }
  const db = getDb();
  db.prepare(`
    INSERT INTO revisions (user_id, resource, resource_id, op, before_json, after_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    userId, resource, String(resourceId), op,
    before == null ? null : JSON.stringify(before),
    after  == null ? null : JSON.stringify(after),
  );
  // Trim oldest revisions for this resource above the per-resource cap.
  // Cheap because the index covers (user_id, resource, resource_id).
  const overflow = db.prepare(`
    SELECT COUNT(*) AS n FROM revisions
     WHERE user_id = ? AND resource = ? AND resource_id = ?
  `).get(userId, resource, String(resourceId));
  if (overflow && overflow.n > PER_RESOURCE_CAP) {
    db.prepare(`
      DELETE FROM revisions
       WHERE id IN (
         SELECT id FROM revisions
          WHERE user_id = ? AND resource = ? AND resource_id = ?
          ORDER BY created_at ASC
          LIMIT ?
       )
    `).run(userId, resource, String(resourceId), overflow.n - PER_RESOURCE_CAP);
  }
}

// List revisions for one resource, most recent first.
export function listRevisions({ userId, resource, resourceId, limit = 50 }) {
  return getDb().prepare(`
    SELECT id, op, before_json, after_json, created_at
      FROM revisions
     WHERE user_id = ? AND resource = ? AND resource_id = ?
     ORDER BY created_at DESC
     LIMIT ?
  `).all(userId, resource, String(resourceId), limit).map(r => ({
    id: r.id,
    op: r.op,
    before: r.before_json ? JSON.parse(r.before_json) : null,
    after: r.after_json ? JSON.parse(r.after_json) : null,
    createdAt: r.created_at,
  }));
}

// Cross-resource recent activity feed for Settings → Activity.
export function recentActivity({ userId, limit = 100 }) {
  return getDb().prepare(`
    SELECT id, resource, resource_id, op, after_json, created_at
      FROM revisions
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?
  `).all(userId, limit).map(r => ({
    id: r.id,
    resource: r.resource,
    resourceId: r.resource_id,
    op: r.op,
    label: extractLabel(r.resource, r.after_json),
    createdAt: r.created_at,
  }));
}

function extractLabel(resource, afterJson) {
  if (!afterJson) return '';
  try {
    const a = JSON.parse(afterJson);
    if (resource === 'notes')  return a.title || a.body?.slice(0, 60) || '(untitled)';
    if (resource === 'tasks')  return a.content || '(task)';
    return '';
  } catch { return ''; }
}

// Daily sweeper.
let sweeper = null;
export function startRevisionsSweeper({ intervalMs = 24 * 60 * 60_000 } = {}) {
  if (sweeper) return;
  const sweep = () => {
    try {
      const r = getDb().prepare(`
        DELETE FROM revisions WHERE created_at < datetime('now', ?)
      `).run(`-${RETAIN_DAYS} days`);
      if (r.changes > 0) console.log(`[revisions sweeper] dropped ${r.changes} expired revisions`);
    } catch (err) {
      console.warn('revisions sweeper:', err.message);
    }
  };
  sweep();
  sweeper = setInterval(sweep, intervalMs);
  sweeper.unref?.();
}
