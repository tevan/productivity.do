/**
 * Founder thoughts — a private, append-only inbox for the founder's
 * in-the-moment notes about the product. Not a product feature; a
 * dev/founder tool gated to user_id === 1.
 *
 * Storage: JSONL at docs/internal/founder-thoughts.log. Append-only —
 * never edits or deletes existing lines, never re-reads the whole file
 * to mutate it. That keeps the on-disk shape predictable for downstream
 * tooling (grep / wc -l / future Claude reading).
 *
 * Each line:
 *   {
 *     ts: ISO-8601 with milliseconds,
 *     thought: string (max 4000 chars),
 *     context: {
 *       url: string,           // window.location.href at capture time
 *       path: string,          // location.pathname
 *       appView: string|null,  // 'calendar' | 'tasks' | 'notes' | etc.
 *       calendarView: string|null,  // 'day' | 'week' | 'month'
 *       date: string|null,     // YYYY-MM-DD for the calendar's current focal date
 *       resource: { kind, id }|null,  // currently-edited task/note/event
 *       viewport: { w, h },
 *       online: boolean,
 *       theme: 'light'|'dark',
 *       userAgent: string,
 *     }
 *   }
 */

import { Router } from 'express';
import multer from 'multer';
import { mkdirSync, existsSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, '..', '..', 'docs', 'internal', 'founder-thoughts.log');
const ATTACH_DIR = join(__dirname, '..', '..', 'data', 'founder-thoughts');

const MAX_THOUGHT_CHARS = 4000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB per image — screenshots
const MAX_ATTACHMENTS_PER_THOUGHT = 5;
const FOUNDER_USER_ID = 1;

// Multer: in-memory so we can hash + name the file ourselves.
const upload = multer({
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_ATTACHMENTS_PER_THOUGHT },
});

function ensureFile() {
  const dir = dirname(LOG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function ensureAttachDir() {
  if (!existsSync(ATTACH_DIR)) mkdirSync(ATTACH_DIR, { recursive: true });
}

function safeExt(filename, mime) {
  const e = extname(String(filename || '')).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(e)) return e;
  // Fallback by MIME for paste-from-clipboard images that lack a name.
  if (mime === 'image/png')  return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif')  return '.gif';
  return '';
}

function isFounder(req) {
  return req?.user?.id === FOUNDER_USER_ID;
}

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/founder-thoughts/whoami — boolean check so the SPA can decide
// whether to mount the widget. Returns 200 to everyone authenticated;
// non-founders get {founder: false} so they can no-op silently.
// ---------------------------------------------------------------------------
router.get('/api/founder-thoughts/whoami', (req, res) => {
  res.json({ ok: true, founder: isFounder(req) });
});

// ---------------------------------------------------------------------------
// POST /api/founder-thoughts — append a thought to the log, optionally
// with image attachments.
//
// Two body shapes are accepted:
//   - JSON: { thought, context? }                    — text only
//   - multipart/form-data with fields:
//       thought  (required)
//       context  (JSON-encoded string, optional)
//       file     (one or more attachments; field name "file")
//
// Attachments are saved to data/founder-thoughts/ as
//   <ISO-ts>-<short-hash>-<originalname>
// and the JSONL entry's `attachments` array carries the relative paths.
// ---------------------------------------------------------------------------
router.post('/api/founder-thoughts', upload.array('file', MAX_ATTACHMENTS_PER_THOUGHT), (req, res) => {
  if (!isFounder(req)) return res.status(404).json({ ok: false, error: 'Not found' });

  const thought = String(req.body?.thought ?? '').trim();
  if (!thought) {
    return res.status(400).json({ ok: false, error: 'thought required' });
  }
  if (thought.length > MAX_THOUGHT_CHARS) {
    return res.status(413).json({
      ok: false,
      error: `thought too long (max ${MAX_THOUGHT_CHARS} chars)`,
    });
  }

  // Context arrives as JSON-encoded string when sent via FormData.
  let rawContext = req.body?.context;
  if (typeof rawContext === 'string') {
    try { rawContext = JSON.parse(rawContext); } catch { rawContext = {}; }
  }
  const c = rawContext || {};
  const context = {
    url:          str(c.url, 500),
    path:         str(c.path, 200),
    appView:      str(c.appView, 50),
    calendarView: str(c.calendarView, 30),
    date:         str(c.date, 30),
    resource:     c.resource ? {
      kind: str(c.resource.kind, 30),
      id:   str(c.resource.id, 200),
    } : null,
    viewport: c.viewport ? {
      w: num(c.viewport.w),
      h: num(c.viewport.h),
    } : null,
    online: typeof c.online === 'boolean' ? c.online : null,
    theme:  c.theme === 'dark' ? 'dark' : c.theme === 'light' ? 'light' : null,
    userAgent: str(c.userAgent, 300),
  };

  const ts = new Date().toISOString();
  const tsForFilename = ts.replace(/[:.]/g, '-');

  // Persist attachments. We keep this simple — write straight to disk
  // with a deterministic-ish filename. No dedup, no thumbnails; this is
  // a personal inbox not a CDN.
  const attachments = [];
  if (Array.isArray(req.files) && req.files.length > 0) {
    try {
      ensureAttachDir();
      for (const f of req.files) {
        if (!f?.buffer || !f.buffer.length) continue;
        const hash = createHash('sha256').update(f.buffer).digest('hex').slice(0, 10);
        const safeName = String(f.originalname || 'paste')
          .replace(/[^\w.\-]/g, '_')
          .slice(0, 80);
        const ext = safeExt(safeName, f.mimetype);
        const baseName = ext && safeName.endsWith(ext) ? safeName.slice(0, -ext.length) : safeName;
        const filename = `${tsForFilename}-${hash}-${baseName}${ext || ''}`;
        const fullPath = join(ATTACH_DIR, filename);
        writeFileSync(fullPath, f.buffer);
        attachments.push({
          path:         join('data', 'founder-thoughts', filename),
          originalName: f.originalname || null,
          mime:         f.mimetype || null,
          size:         f.size || f.buffer.length,
        });
      }
    } catch (err) {
      console.error('founder-thoughts attachment write failed:', err.message);
      return res.status(500).json({ ok: false, error: 'Could not save attachments' });
    }
  }

  const entry = {
    ts,
    thought,
    context,
    attachments: attachments.length > 0 ? attachments : undefined,
  };

  try {
    ensureFile();
    appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('founder-thoughts write failed:', err.message);
    return res.status(500).json({ ok: false, error: 'Could not write log' });
  }

  res.json({ ok: true, ts: entry.ts, attachments: attachments.length });
});

// Multer-error → JSON.
router.use('/api/founder-thoughts', (err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      ok: false,
      error: `attachment too large (max ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB)`,
    });
  }
  if (err && err.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({
      ok: false,
      error: `too many attachments (max ${MAX_ATTACHMENTS_PER_THOUGHT})`,
    });
  }
  if (err) return res.status(400).json({ ok: false, error: err.message });
  next();
});

// ---------------------------------------------------------------------------
// GET /api/founder-thoughts?limit=N — read the last N entries (default 20).
// Useful to verify the widget is working without leaving the app.
// ---------------------------------------------------------------------------
router.get('/api/founder-thoughts', (req, res) => {
  if (!isFounder(req)) return res.status(404).json({ ok: false, error: 'Not found' });

  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 20));

  if (!existsSync(LOG_PATH)) return res.json({ ok: true, entries: [] });

  let raw;
  try {
    raw = readFileSync(LOG_PATH, 'utf8');
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Could not read log' });
  }

  const lines = raw.split('\n').filter(Boolean);
  const tail = lines.slice(-limit).reverse(); // newest first
  const entries = tail.map(l => {
    try { return JSON.parse(l); }
    catch { return { ts: null, thought: l, context: null, parseError: true }; }
  });

  res.json({ ok: true, entries, total: lines.length });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function str(v, max) {
  if (typeof v !== 'string') return null;
  return v.length > max ? v.slice(0, max) : v;
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export default router;
