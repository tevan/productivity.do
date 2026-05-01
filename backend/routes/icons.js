// GET /api/icons/:provider.svg — returns the brand icon for a provider.
// Cached aggressively because simple-icons is bundled at boot. Falls back
// to a colored letter tile when no brand match exists, so every adapter
// always gets *something* to render.

import express from 'express';
import { getProviderIcon, getLetterIcon } from '../lib/icons.js';
import { getAdapter } from '../integrations/registry.js';

const router = express.Router();

router.get('/api/icons/:provider.svg', (req, res) => {
  const provider = String(req.params.provider).toLowerCase();
  const adapter = getAdapter(provider);
  const fallbackName = adapter?.name || provider;
  const icon = getProviderIcon(provider) || getLetterIcon(fallbackName);
  res.set('Cache-Control', 'public, max-age=86400, immutable');
  res.set('Content-Type', 'image/svg+xml; charset=utf-8');
  // simple-icons SVGs are single-color — they inherit `currentColor`
  // when we replace `fill="…"` with our injected `fill`. We leave the
  // original fill so cards can render brand color or theme color via CSS
  // (the SPA wraps the <img> in a tinting filter when desired).
  res.send(icon.svg);
});

export default router;
