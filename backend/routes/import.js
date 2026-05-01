// /api/import — bulk import of calendar/tasks/notes from foreign formats
// into the user's native tables. Multipart upload; backend dispatches
// based on filename + content sniffing.
//
// Two-step flow recommended on the front-end:
//   1. POST with `?dryRun=1` — backend parses and returns counts only
//   2. POST without dryRun — actually writes to native tables
//
// The same parsed payload from the dry-run is NOT replayed by the second
// call; we re-parse. That's intentional — the user might edit the file
// between calls. Cheap to re-parse.

import { Router } from 'express';
import multer from 'multer';
import { parseAny, writeNative } from '../import/index.js';
import { captureError } from '../lib/sentry.js';

const router = Router();

// In-memory buffer — files are tiny (calendar exports rarely exceed a
// few MB). Cap at 25MB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

router.post('/api/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
  try {
    const text = req.file.buffer.toString('utf8');
    const hint = req.body?.kind || null;
    const parsed = parseAny(req.file.originalname || 'upload', text, hint);
    if (req.query.dryRun === '1') {
      return res.json({
        ok: true,
        format: parsed.format,
        counts: {
          events: parsed.events?.length || 0,
          tasks: parsed.tasks?.length || 0,
          projects: parsed.projects?.length || 0,
          notes: parsed.notes?.length || 0,
        },
        // Show the user what we're about to import — capped to avoid
        // returning megabytes of data when they upload a huge file.
        preview: {
          events: (parsed.events || []).slice(0, 5),
          tasks: (parsed.tasks || []).slice(0, 5),
          notes: (parsed.notes || []).slice(0, 5).map(n => ({ title: n.title })),
        },
      });
    }
    const counts = writeNative(req.user.id, parsed);
    res.json({ ok: true, format: parsed.format, counts });
  } catch (e) {
    captureError(e, { route: '/api/import', userId: req.user.id, filename: req.file?.originalname });
    res.status(400).json({ ok: false, error: e.message, code: e.code });
  }
});

export default router;
