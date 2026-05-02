// Voice capture + voiced decisions.
//
// Two endpoints:
//   POST /api/voice/transcribe — multipart audio in, plain text out.
//                                Calls OpenAI Whisper server-side so the
//                                API key never touches the browser.
//   POST /api/voice/route      — text in, classification + suggested
//                                resource out. Calls Claude Haiku to
//                                pick (task | event | note | comment)
//                                and extract structured fields.
//
// Both endpoints fail-open with 503 + a clear message when the relevant
// API key isn't configured. The frontend hides the voice surface in that
// case rather than showing a broken button.

import { Router } from 'express';
import multer from 'multer';
import { captureError } from '../lib/sentry.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB — Whisper's hard cap
});

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/**
 * POST /api/voice/transcribe
 * multipart/form-data:
 *   - audio: file (audio/webm | audio/mp4 | audio/wav | audio/mpeg | audio/m4a)
 *   - language: optional ISO-639-1 hint
 * → { ok: true, transcript: string, language: string }
 */
router.post('/api/voice/transcribe', upload.single('audio'), async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      ok: false,
      error: 'Voice transcription not configured (set OPENAI_API_KEY).',
    });
  }
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'audio file required' });
  }
  try {
    // FormData on the server: build with Blob + name for Whisper.
    const form = new FormData();
    const blob = new Blob([req.file.buffer], {
      type: req.file.mimetype || 'application/octet-stream',
    });
    // Whisper recognizes filenames primarily for extension hints. We use
    // `audio.webm` as a safe default; the Content-Type header carries the
    // real MIME.
    const filename = filenameForMime(req.file.mimetype) || req.file.originalname || 'audio.webm';
    form.append('file', blob, filename);
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    if (req.body?.language) form.append('language', String(req.body.language));

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`whisper ${r.status}: ${txt.slice(0, 300)}`);
    }
    const data = await r.json();
    res.json({
      ok: true,
      transcript: (data.text || '').trim(),
      language: data.language || null,
    });
  } catch (err) {
    captureError?.(err, { component: 'voice.transcribe' });
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/voice/route
 * Body: { transcript: string, context?: 'capture' | 'decision' }
 * → {
 *     ok: true,
 *     kind: 'task' | 'event' | 'note' | 'comment' | 'unsure',
 *     confidence: 'high' | 'medium' | 'low',
 *     fields: <kind-specific structured fields>,
 *     summary: string  // one-line description of what we'll create
 *   }
 *
 * Uses Claude Haiku — small, fast, cheap. Forced JSON output.
 */
router.post('/api/voice/route', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      ok: false,
      error: 'Voice routing not configured (set ANTHROPIC_API_KEY).',
    });
  }
  const transcript = String(req.body?.transcript || '').trim();
  if (!transcript) {
    return res.status(400).json({ ok: false, error: 'transcript required' });
  }
  if (transcript.length > 4000) {
    return res.status(400).json({ ok: false, error: 'transcript too long (max 4000 chars)' });
  }

  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const prompt = [
      'You are a productivity assistant. Classify a user\'s spoken note into one of:',
      '- task: an action they need to do (verb-led, often time-bound)',
      '- event: something happening at a specific time with other people',
      '- note: a thought, observation, or piece of information to keep',
      '- comment: an addition to something else (often starts with "for X, also…")',
      '- unsure: doesn\'t clearly fit any of the above',
      '',
      'Today is ' + todayStr + '.',
      'For tasks, extract: content, dueDate (YYYY-MM-DD or null), priority (1-4, 4=highest, default 1), estimatedMinutes (int or null).',
      'For events: summary, start (ISO 8601), end (ISO 8601), location (string or null).',
      'For notes: title (≤80 chars), body.',
      'For comments: targetHint (free text describing what it should attach to), body.',
      '',
      'Return ONLY valid JSON of the shape:',
      '{"kind":"task|event|note|comment|unsure","confidence":"high|medium|low","fields":{...},"summary":"one short sentence"}',
      '',
      'Transcript:',
      transcript,
    ].join('\n');

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`claude ${r.status}: ${txt.slice(0, 300)}`);
    }
    const data = await r.json();
    const text = data?.content?.[0]?.text?.trim() || '';

    // Parse JSON tolerantly — the model occasionally wraps in fences.
    let parsed = null;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch {}
    }
    if (!parsed) {
      return res.json({
        ok: true,
        kind: 'unsure',
        confidence: 'low',
        fields: {},
        summary: 'Could not understand the request.',
        rawText: text,
      });
    }

    res.json({
      ok: true,
      kind: parsed.kind || 'unsure',
      confidence: parsed.confidence || 'low',
      fields: parsed.fields || {},
      summary: parsed.summary || transcript.slice(0, 80),
    });
  } catch (err) {
    captureError?.(err, { component: 'voice.route' });
    res.status(502).json({ ok: false, error: err.message });
  }
});

function filenameForMime(mime) {
  if (!mime) return null;
  const map = {
    'audio/webm': 'audio.webm',
    'audio/ogg': 'audio.ogg',
    'audio/mp4': 'audio.mp4',
    'audio/m4a': 'audio.m4a',
    'audio/x-m4a': 'audio.m4a',
    'audio/wav': 'audio.wav',
    'audio/mpeg': 'audio.mp3',
    'audio/mp3': 'audio.mp3',
  };
  return map[mime] || null;
}

export default router;
