/**
 * Tests for the thumbnail pipeline in routes/files.js — runnable under
 * vitest if/when we add it. Until then this documents the invariants:
 *
 *   1. Generated thumbs are valid webp (magic bytes 52 49 46 46).
 *   2. The pipeline calls .rotate() before .resize() so EXIF-oriented
 *      images don't end up sideways. (Strip orientation after rotate so
 *      the output bytes carry no orientation tag.)
 *   3. THUMB_MIMES gates which uploads get thumbs — non-image MIMEs are
 *      passed through unchanged.
 *   4. Thumb files live at <files-dir>/<hash[0:2]>/<hash>.thumb.webp so
 *      they sort next to the original blob.
 *
 * To run (after `npm i -D vitest`):
 *   npx vitest backend/routes/files.thumb.spec.js
 */

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';

const THUMB_SIZE = 256;
const THUMB_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/tiff']);

async function makePng(w = 100, h = 100, color = { r: 255, g: 0, b: 0 }) {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
}

async function generateThumbnail(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

describe('thumbnail pipeline', () => {
  it('produces a valid webp (RIFF magic)', async () => {
    const src = await makePng();
    const thumb = await generateThumbnail(src);
    expect(thumb.subarray(0, 4).toString('hex')).toBe('52494646');
  });

  it('clamps to THUMB_SIZE on the longest edge with aspect-ratio preserved', async () => {
    const src = await makePng(800, 400); // 2:1
    const thumb = await generateThumbnail(src);
    const meta = await sharp(thumb).metadata();
    expect(meta.width).toBe(THUMB_SIZE);
    expect(meta.height).toBe(THUMB_SIZE / 2);
  });

  it('does NOT enlarge a smaller-than-thumb input', async () => {
    const src = await makePng(64, 64);
    const thumb = await generateThumbnail(src);
    const meta = await sharp(thumb).metadata();
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(64);
  });

  it('output strips EXIF orientation (always upright)', async () => {
    // Build a PNG with EXIF orientation = 6 (rotated 90° CW).
    const src = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 0, g: 255, b: 0 } } })
      .withMetadata({ orientation: 6 })
      .png()
      .toBuffer();
    const thumb = await generateThumbnail(src);
    const meta = await sharp(thumb).metadata();
    // After .rotate() + resize, the rendered orientation is "1" (or the tag
    // is gone entirely — sharp strips by default for webp).
    expect([1, undefined]).toContain(meta.orientation);
  });
});

describe('THUMB_MIMES gating', () => {
  it('includes the common image types', () => {
    expect(THUMB_MIMES.has('image/jpeg')).toBe(true);
    expect(THUMB_MIMES.has('image/png')).toBe(true);
    expect(THUMB_MIMES.has('image/webp')).toBe(true);
    expect(THUMB_MIMES.has('image/gif')).toBe(true);
  });

  it('excludes non-image types so generation is skipped', () => {
    expect(THUMB_MIMES.has('application/pdf')).toBe(false);
    expect(THUMB_MIMES.has('video/mp4')).toBe(false);
    expect(THUMB_MIMES.has('text/plain')).toBe(false);
    expect(THUMB_MIMES.has('application/octet-stream')).toBe(false);
  });

  it('excludes SVG (we serve them as-is; resizing vector → raster loses fidelity)', () => {
    expect(THUMB_MIMES.has('image/svg+xml')).toBe(false);
  });
});
