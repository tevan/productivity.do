// Trash / soft-delete primitives.
//
// Goal: when the user "deletes" a high-effort resource (note, booking
// page, calendar set, event template) we keep the row for 30 days so a
// misclick is recoverable. After 30 days a sweeper hard-deletes it.
//
// Conventions:
//   - `deleted_at`           — ISO timestamp of soft-delete; NULL = live row
//   - `permanently_purge_at` — ISO timestamp when the sweeper will purge it
//   - LIST queries on each resource MUST add `WHERE deleted_at IS NULL`
//     to keep the trash invisible from normal views
//   - GET on a single row by id is allowed to return deleted rows so the
//     trash view can preview them
//
// Geewax Ch 25 (soft-delete + :undelete + :expunge). Our DELETE flips the
// flag; the explicit hard-delete is `?permanent=1` or POST :purge.

const PURGE_WINDOW_DAYS = 30;

// Whitelist of (resource → table) pairs we trash. Keeping this central
// means a typo in a route doesn't accidentally let a caller soft-delete
// rows we don't want to retain.
export const TRASH_TABLES = {
  notes: 'notes',
  booking_pages: 'booking_pages',
  event_templates: 'event_templates',
  calendar_sets: 'calendar_sets',
};

// Identifier-quote helper — table names are never user-controlled here
// (whitelisted above), but defending against the linter / future drift.
function tbl(resource) {
  const name = TRASH_TABLES[resource];
  if (!name) throw new Error(`unknown trash resource: ${resource}`);
  if (!/^[a-z_]+$/.test(name)) throw new Error('invalid table name');
  return name;
}

export function softDelete(db, resource, id, userId) {
  const t = tbl(resource);
  const now = new Date();
  const deletedAt = now.toISOString();
  const purgeAt = new Date(now.getTime() + PURGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const r = db.prepare(`
    UPDATE ${t}
       SET deleted_at = ?, permanently_purge_at = ?
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `).run(deletedAt, purgeAt, id, userId);
  return r.changes > 0;
}

export function restore(db, resource, id, userId) {
  const t = tbl(resource);
  const r = db.prepare(`
    UPDATE ${t}
       SET deleted_at = NULL, permanently_purge_at = NULL
     WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL
  `).run(id, userId);
  return r.changes > 0;
}

export function purge(db, resource, id, userId) {
  // Used both by the explicit "empty trash now" and by the daily sweeper.
  // Caller is responsible for clearing any related rows / FK cascade
  // (most of our schema doesn't use FK cascades aggressively).
  const t = tbl(resource);
  const r = db.prepare(`DELETE FROM ${t} WHERE id = ? AND user_id = ?`).run(id, userId);
  return r.changes > 0;
}

// Aggregate view — returns deleted rows across all whitelisted tables for
// the trash UI. Selects a small projection (no body/description bloat) so
// the response is fast even with many trashed items. Each row gets a
// `resource` discriminator so the frontend knows which restore endpoint
// to hit.
export function listTrashed(db, userId) {
  const out = [];
  // Notes — keep title + a snippet of body for preview.
  for (const r of db.prepare(`
    SELECT id, title, substr(body, 1, 200) AS body_snippet, deleted_at, permanently_purge_at
      FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
  `).all(userId)) {
    out.push({ resource: 'notes', id: r.id, label: r.title || '(untitled note)',
      preview: r.body_snippet, deletedAt: r.deleted_at, purgeAt: r.permanently_purge_at });
  }
  for (const r of db.prepare(`
    SELECT id, title, slug, deleted_at, permanently_purge_at
      FROM booking_pages WHERE user_id = ? AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
  `).all(userId)) {
    out.push({ resource: 'booking_pages', id: r.id, label: r.title,
      preview: `/${r.slug}`, deletedAt: r.deleted_at, purgeAt: r.permanently_purge_at });
  }
  for (const r of db.prepare(`
    SELECT id, name, summary, deleted_at, permanently_purge_at
      FROM event_templates WHERE user_id = ? AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
  `).all(userId)) {
    out.push({ resource: 'event_templates', id: r.id, label: r.name,
      preview: r.summary || '', deletedAt: r.deleted_at, purgeAt: r.permanently_purge_at });
  }
  for (const r of db.prepare(`
    SELECT id, name, deleted_at, permanently_purge_at
      FROM calendar_sets WHERE user_id = ? AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
  `).all(userId)) {
    out.push({ resource: 'calendar_sets', id: r.id, label: r.name,
      preview: '', deletedAt: r.deleted_at, purgeAt: r.permanently_purge_at });
  }
  // Resort across resources so the user sees deletions in chronological
  // order (most recent first), regardless of which kind it was.
  out.sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  return out;
}

// Daily sweeper: hard-delete rows whose 30-day window has elapsed.
let sweeper = null;
export function startTrashSweeper(getDb, { intervalMs = 24 * 60 * 60_000 } = {}) {
  if (sweeper) return;
  const sweep = () => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      let total = 0;
      for (const t of Object.values(TRASH_TABLES)) {
        const r = db.prepare(`
          DELETE FROM ${t}
           WHERE deleted_at IS NOT NULL
             AND permanently_purge_at IS NOT NULL
             AND permanently_purge_at <= ?
        `).run(now);
        total += r.changes;
      }
      if (total > 0) console.log(`[trash sweeper] purged ${total} expired rows`);
    } catch (err) {
      console.warn('trash sweeper:', err.message);
    }
  };
  sweep();
  sweeper = setInterval(sweep, intervalMs);
  sweeper.unref?.();
}
