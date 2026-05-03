/**
 * Files unified across pillars — upload, serve, link/unlink.
 *
 * Storage model:
 *   - On disk at FILES_DIR (data/files/<hash[0:2]>/<hash>). Sharded by first
 *     two hex chars to keep any one directory under ~256 entries. Filename is
 *     the sha256 of the bytes — collision-free, dedup-friendly.
 *   - DB row in `files` carries (user_id, hash, mime, size, original_name).
 *     UNIQUE(user_id, hash) — re-uploading the same blob returns the existing
 *     row. Different users uploading identical bytes get separate rows but
 *     share the disk file.
 *   - DB row in `file_links` for each "appears in" relationship: the file
 *     attached to a calendar event, task, or note. Compound unique constraint
 *     prevents duplicate attachments.
 *
 * Auth: all routes require a session and scope by req.user.id. Files are
 * private; the serve endpoint is NOT on the requireAuth bypass list.
 */

import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'crypto';
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { getDb } from '../db/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILES_DIR = join(__dirname, '..', '..', 'data', 'files');
if (!existsSync(FILES_DIR)) mkdirSync(FILES_DIR, { recursive: true });

const router = Router();

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB per file
const ALLOWED_SOURCE_TYPES = new Set(['event', 'task', 'note']);
const THUMB_SIZE = 256; // px (longest edge); sharp's `inside` fit preserves AR
const THUMB_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/tiff']);

// Multer: in-memory so we can hash before deciding the path. 25MB cap.
const upload = multer({
  limits: { fileSize: MAX_FILE_SIZE },
  // No fileFilter — we accept any MIME for now. Scanning/blocklist would go
  // here if we ever serve untrusted content with executable behavior.
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shardedPath(hash) {
  return join(FILES_DIR, hash.slice(0, 2), hash);
}

function thumbPath(hash) {
  return join(FILES_DIR, hash.slice(0, 2), `${hash}.thumb.webp`);
}

// Generate a 256px-longest-edge webp thumbnail. Honors EXIF orientation.
// Best-effort: failures (corrupt image, unsupported format) are silently
// skipped so the original upload still succeeds.
async function generateThumbnail(buffer, mime, outPath) {
  if (!THUMB_MIMES.has(mime)) return false;
  try {
    await sharp(buffer)
      .rotate() // apply EXIF orientation, then strip it
      .resize({
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toFile(outPath);
    return true;
  } catch {
    return false;
  }
}

function rowToApi(row) {
  const hasThumb = THUMB_MIMES.has(row.mime) && existsSync(thumbPath(row.hash));
  return {
    id: row.id,
    hash: row.hash,
    mime: row.mime,
    size: row.size,
    originalName: row.original_name,
    createdAt: row.created_at,
    url: `/api/files/${row.id}`,
    thumbUrl: hasThumb ? `/api/files/${row.id}?thumb=1` : null,
  };
}

// ---------------------------------------------------------------------------
// POST /api/files — upload (multipart/form-data, field name "file")
// ---------------------------------------------------------------------------
// Optional body fields: sourceType + sourceId, to attach in one round-trip.
router.post('/api/files', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No file uploaded (field name: "file")' });
  }
  const { buffer, mimetype, originalname, size } = req.file;
  if (!buffer || !buffer.length) {
    return res.status(400).json({ ok: false, error: 'Empty file' });
  }

  const hash = createHash('sha256').update(buffer).digest('hex');
  const db = getDb();

  // Dedup by (user_id, hash). If an existing row matches, return it without
  // writing the disk file again.
  const existing = db.prepare(
    'SELECT * FROM files WHERE user_id = ? AND hash = ?'
  ).get(req.user.id, hash);

  let row = existing;
  if (!existing) {
    const onDisk = shardedPath(hash);
    if (!existsSync(dirname(onDisk))) mkdirSync(dirname(onDisk), { recursive: true });
    if (!existsSync(onDisk)) writeFileSync(onDisk, buffer);

    const result = db.prepare(`
      INSERT INTO files (user_id, hash, mime, size, original_name, storage_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, hash, mimetype || 'application/octet-stream',
            size, originalname || 'file', onDisk);
    row = db.prepare('SELECT * FROM files WHERE id = ?').get(result.lastInsertRowid);

    // Best-effort thumbnail. Skipped silently for non-images or on failure.
    const thumbOut = thumbPath(hash);
    if (!existsSync(thumbOut)) {
      await generateThumbnail(buffer, row.mime, thumbOut);
    }
  }

  // Optional same-shot linking.
  const sourceType = req.body?.sourceType;
  const sourceId = req.body?.sourceId;
  if (sourceType && sourceId) {
    if (!ALLOWED_SOURCE_TYPES.has(sourceType)) {
      return res.status(400).json({ ok: false, error: 'Invalid sourceType' });
    }
    db.prepare(`
      INSERT OR IGNORE INTO file_links (user_id, file_id, source_type, source_id)
      VALUES (?, ?, ?, ?)
    `).run(req.user.id, row.id, sourceType, String(sourceId));
  }

  res.json({ ok: true, file: rowToApi(row), deduped: !!existing });
});

// ---------------------------------------------------------------------------
// GET /api/files/search?q= — LIKE match on original_name. Caller-side join
// to the wider search overlay can show files alongside events/tasks/notes.
// ---------------------------------------------------------------------------
router.get('/api/files/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ ok: true, files: [] });
  const rows = getDb().prepare(`
    SELECT * FROM files
    WHERE user_id = ? AND original_name LIKE ?
    ORDER BY created_at DESC LIMIT 20
  `).all(req.user.id, `%${q}%`);
  res.json({ ok: true, files: rows.map(rowToApi) });
});

// ---------------------------------------------------------------------------
// GET /api/files/by-source?sourceType=task&sourceId=123
// Registered BEFORE /api/files/:id so the literal path wins over the param.
// ---------------------------------------------------------------------------
router.get('/api/files/by-source', (req, res) => {
  const { sourceType, sourceId } = req.query;
  if (!ALLOWED_SOURCE_TYPES.has(sourceType)) {
    return res.status(400).json({ ok: false, error: 'Invalid sourceType' });
  }
  if (!sourceId) return res.status(400).json({ ok: false, error: 'sourceId required' });

  // Count of OTHER resources referencing each file (the "appears in N places"
  // hint). Subtracts 1 because the current resource is itself a link.
  const rows = getDb().prepare(`
    SELECT f.*,
           (SELECT COUNT(*) FROM file_links l2
              WHERE l2.user_id = f.user_id AND l2.file_id = f.id) - 1 AS appears_in_others
      FROM files f
      JOIN file_links l ON l.file_id = f.id AND l.user_id = f.user_id
     WHERE f.user_id = ? AND l.source_type = ? AND l.source_id = ?
     ORDER BY l.created_at DESC
  `).all(req.user.id, sourceType, String(sourceId));

  const files = rows.map(r => ({ ...rowToApi(r), appearsInOthers: Math.max(0, r.appears_in_others) }));
  res.json({ ok: true, files });
});

// ---------------------------------------------------------------------------
// GET /api/files/:id — serve bytes (auth-scoped to owner)
// ---------------------------------------------------------------------------
router.get('/api/files/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });

  const row = getDb().prepare(
    'SELECT * FROM files WHERE id = ? AND user_id = ?'
  ).get(id, req.user.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });

  // Thumbnail variant: serves the pre-generated webp if one exists.
  // Falls back to the original image if no thumb (older uploads, non-images).
  if (req.query.thumb) {
    const tp = thumbPath(row.hash);
    if (existsSync(tp)) {
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.sendFile(tp);
    }
    // Fall through to full original.
  }

  if (!existsSync(row.storage_path)) {
    return res.status(410).json({ ok: false, error: 'Blob missing on disk' });
  }

  res.setHeader('Content-Type', row.mime);
  res.setHeader('Content-Length', row.size);
  // Inline for images/pdf, attachment otherwise — preserves the upload name.
  const safeName = row.original_name.replace(/[^\w.\-]/g, '_');
  const inlineable = /^(image|video|audio)\//.test(row.mime) || row.mime === 'application/pdf';
  res.setHeader(
    'Content-Disposition',
    `${inlineable ? 'inline' : 'attachment'}; filename="${safeName}"`
  );
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(row.storage_path);
});

// ---------------------------------------------------------------------------
// GET /api/files — list user's files (paginated by created_at DESC)
// ---------------------------------------------------------------------------
router.get('/api/files', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = getDb().prepare(`
    SELECT * FROM files WHERE user_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(req.user.id, limit);
  res.json({ ok: true, files: rows.map(rowToApi) });
});

// ---------------------------------------------------------------------------
// DELETE /api/files/:id — delete row (and links). Disk file kept if other
// users reference the same hash; pruned otherwise.
// ---------------------------------------------------------------------------
router.delete('/api/files/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });
  const db = getDb();

  const row = db.prepare(
    'SELECT * FROM files WHERE id = ? AND user_id = ?'
  ).get(id, req.user.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });

  db.prepare('DELETE FROM file_links WHERE file_id = ? AND user_id = ?')
    .run(id, req.user.id);
  db.prepare('DELETE FROM files WHERE id = ? AND user_id = ?')
    .run(id, req.user.id);

  // Garbage-collect the disk blob (and thumb) if no other user references
  // the hash.
  const otherRefs = db.prepare(
    'SELECT 1 FROM files WHERE hash = ? LIMIT 1'
  ).get(row.hash);
  if (!otherRefs) {
    try {
      if (existsSync(row.storage_path)) unlinkSync(row.storage_path);
      const tp = thumbPath(row.hash);
      if (existsSync(tp)) unlinkSync(tp);
    } catch {}
  }

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/files/:id/links — attach file to a resource
// Body: { sourceType, sourceId }
// ---------------------------------------------------------------------------
router.post('/api/files/:id/links', (req, res) => {
  const id = Number(req.params.id);
  const { sourceType, sourceId } = req.body || {};
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });
  if (!ALLOWED_SOURCE_TYPES.has(sourceType)) {
    return res.status(400).json({ ok: false, error: 'Invalid sourceType' });
  }
  if (!sourceId) return res.status(400).json({ ok: false, error: 'sourceId required' });

  const db = getDb();
  const owns = db.prepare(
    'SELECT 1 FROM files WHERE id = ? AND user_id = ?'
  ).get(id, req.user.id);
  if (!owns) return res.status(404).json({ ok: false, error: 'Not found' });

  db.prepare(`
    INSERT OR IGNORE INTO file_links (user_id, file_id, source_type, source_id)
    VALUES (?, ?, ?, ?)
  `).run(req.user.id, id, sourceType, String(sourceId));

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// DELETE /api/files/:id/links — detach (does NOT delete the file row)
// Body: { sourceType, sourceId }
// ---------------------------------------------------------------------------
router.delete('/api/files/:id/links', (req, res) => {
  const id = Number(req.params.id);
  const { sourceType, sourceId } = req.body || {};
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });
  if (!ALLOWED_SOURCE_TYPES.has(sourceType)) {
    return res.status(400).json({ ok: false, error: 'Invalid sourceType' });
  }

  getDb().prepare(`
    DELETE FROM file_links
    WHERE user_id = ? AND file_id = ? AND source_type = ? AND source_id = ?
  `).run(req.user.id, id, sourceType, String(sourceId));

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /api/files/:id/appears-in — list every resource referencing this file.
// Useful for the "appears in" rail in the file picker preview.
// ---------------------------------------------------------------------------
router.get('/api/files/:id/appears-in', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });
  const db = getDb();

  const owns = db.prepare(
    'SELECT 1 FROM files WHERE id = ? AND user_id = ?'
  ).get(id, req.user.id);
  if (!owns) return res.status(404).json({ ok: false, error: 'Not found' });

  const rawLinks = db.prepare(`
    SELECT source_type, source_id, created_at
    FROM file_links
    WHERE user_id = ? AND file_id = ?
    ORDER BY created_at DESC
  `).all(req.user.id, id);

  // Enrich with human-readable labels per source_type. Missing rows
  // (e.g., note that was hard-deleted, Google event we no longer have
  // cached) get a null label and the client renders "Unknown".
  const noteIds = rawLinks.filter(l => l.source_type === 'note').map(l => l.source_id);
  const taskIds = rawLinks.filter(l => l.source_type === 'task').map(l => l.source_id);
  const eventIds = rawLinks.filter(l => l.source_type === 'event').map(l => l.source_id);

  const noteLabels = new Map();
  if (noteIds.length) {
    const placeholders = noteIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT id, title, updated_at, archived_at
        FROM notes
       WHERE user_id = ? AND deleted_at IS NULL AND id IN (${placeholders})
    `).all(req.user.id, ...noteIds.map(Number));
    for (const r of rows) {
      noteLabels.set(String(r.id), {
        label: r.title || '(untitled note)',
        url: `/notes/${r.id}`,
        archived: !!r.archived_at,
        timestamp: r.updated_at,
      });
    }
  }

  const taskLabels = new Map();
  if (taskIds.length) {
    const placeholders = taskIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT todoist_id, content, due_date, is_completed
        FROM tasks_cache WHERE user_id = ? AND todoist_id IN (${placeholders})
    `).all(req.user.id, ...taskIds);
    for (const r of rows) {
      taskLabels.set(String(r.todoist_id), {
        label: r.content || '(untitled task)',
        url: null,
        completed: !!r.is_completed,
        timestamp: r.due_date,
      });
    }
  }

  const eventLabels = new Map();
  if (eventIds.length) {
    const placeholders = eventIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT google_event_id, summary, start_time
        FROM events_cache
       WHERE user_id = ? AND google_event_id IN (${placeholders})
    `).all(req.user.id, ...eventIds);
    for (const r of rows) {
      eventLabels.set(String(r.google_event_id), {
        label: r.summary || '(untitled event)',
        url: null,
        timestamp: r.start_time,
      });
    }
  }

  const links = rawLinks.map(l => {
    const m = l.source_type === 'note' ? noteLabels
            : l.source_type === 'task' ? taskLabels
            : l.source_type === 'event' ? eventLabels
            : null;
    const enriched = m?.get(String(l.source_id)) || null;
    return {
      sourceType: l.source_type,
      sourceId: l.source_id,
      attachedAt: l.created_at,
      label: enriched?.label || null,
      url: enriched?.url || null,
      timestamp: enriched?.timestamp || null,
      archived: enriched?.archived || false,
      completed: enriched?.completed || false,
      missing: !enriched,
    };
  });

  res.json({ ok: true, links });
});

// Multer error handler — convert to JSON instead of HTML stack.
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      ok: false,
      error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`,
    });
  }
  if (err) return res.status(400).json({ ok: false, error: err.message });
  next();
});

export default router;
