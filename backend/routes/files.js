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
import { getDb } from '../db/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILES_DIR = join(__dirname, '..', '..', 'data', 'files');
if (!existsSync(FILES_DIR)) mkdirSync(FILES_DIR, { recursive: true });

const router = Router();

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB per file
const ALLOWED_SOURCE_TYPES = new Set(['event', 'task', 'note']);

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

function rowToApi(row) {
  return {
    id: row.id,
    hash: row.hash,
    mime: row.mime,
    size: row.size,
    originalName: row.original_name,
    createdAt: row.created_at,
    url: `/api/files/${row.id}`,
  };
}

// ---------------------------------------------------------------------------
// POST /api/files — upload (multipart/form-data, field name "file")
// ---------------------------------------------------------------------------
// Optional body fields: sourceType + sourceId, to attach in one round-trip.
router.post('/api/files', upload.single('file'), (req, res) => {
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

  // Garbage-collect the disk blob if no other user references the hash.
  const otherRefs = db.prepare(
    'SELECT 1 FROM files WHERE hash = ? LIMIT 1'
  ).get(row.hash);
  if (!otherRefs) {
    try {
      if (existsSync(row.storage_path)) unlinkSync(row.storage_path);
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

  const links = db.prepare(`
    SELECT source_type, source_id, created_at
    FROM file_links
    WHERE user_id = ? AND file_id = ?
    ORDER BY created_at DESC
  `).all(req.user.id, id);

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
