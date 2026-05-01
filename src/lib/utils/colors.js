// Pastel palette. Each entry has explicit light/dark hex values plus a CSS
// var name. Components have two ways to consume:
//
//   - `light`/`dark` (static hex) — for darkenColor() math, calendar pickers
//   - `varName` (e.g. '--color-rose') — pass via inline style so scheme
//     overrides reactively repaint without re-running getEventColor()
//
// applyColorScheme() in colorSchemes.js writes the active scheme's hex to
// these vars on <html>, so any element rendered with `background: var(...)`
// repaints when the scheme changes.
export const PASTEL_COLORS = [
  { name: 'Sky',      light: '#dbeafe', dark: '#1e3a5f', varName: '--color-sky' },
  { name: 'Lavender', light: '#e8e0f0', dark: '#3b2d5e', varName: '--color-lavender' },
  { name: 'Rose',     light: '#fce4ec', dark: '#5e2d3d', varName: '--color-rose' },
  { name: 'Peach',    light: '#fff0e0', dark: '#5e3d1e', varName: '--color-peach' },
  { name: 'Mint',     light: '#d4edda', dark: '#1e4d2e', varName: '--color-mint' },
  { name: 'Sage',     light: '#e0ede4', dark: '#2d4e3b', varName: '--color-sage' },
  { name: 'Butter',   light: '#fff9c4', dark: '#4e4a1e', varName: '--color-butter' },
  { name: 'Coral',    light: '#ffe0d6', dark: '#5e3028', varName: '--color-coral' },
  { name: 'Lilac',    light: '#f0e6ff', dark: '#3e2d5e', varName: '--color-lilac' },
  { name: 'Cloud',    light: '#e8eaed', dark: '#3a3d42', varName: '--color-cloud' },
  { name: 'Powder',   light: '#e0f2fe', dark: '#1e3d5e', varName: '--color-powder' },
  { name: 'Blush',    light: '#fde2e8', dark: '#5e2d38', varName: '--color-blush' },
];

// Google Calendar's 11 event colorIds mapped to nearest pastel index
export const googleColorMap = {
  '1': 0,   // Lavender → Sky
  '2': 5,   // Sage
  '3': 3,   // Grape → Peach
  '4': 2,   // Flamingo → Rose
  '5': 6,   // Banana → Butter
  '6': 7,   // Tangerine → Coral
  '7': 10,  // Peacock → Powder
  '8': 9,   // Graphite → Cloud
  '9': 0,   // Blueberry → Sky
  '10': 4,  // Basil → Mint
  '11': 2,  // Tomato → Rose
};

export function getEventColor(event, calendars = []) {
  // Event-level color override
  if (event.colorId && googleColorMap[event.colorId] !== undefined) {
    return PASTEL_COLORS[googleColorMap[event.colorId]];
  }
  // Calendar-level color
  const cal = calendars.find(c => c.id === event.calendarId);
  if (cal && cal.colorIndex !== undefined) {
    return PASTEL_COLORS[cal.colorIndex % PASTEL_COLORS.length];
  }
  // Default
  return PASTEL_COLORS[0];
}

export function getCalendarColor(calendar) {
  if (calendar.colorIndex !== undefined) {
    return PASTEL_COLORS[calendar.colorIndex % PASTEL_COLORS.length];
  }
  return PASTEL_COLORS[0];
}

// Relative luminance of a hex color (0-1) using the sRGB → linear formula
// from WCAG. Used to pick readable text colors on top of saturated chip
// backgrounds — light pastels and saturated mid-tones need different
// treatment than darkenColor()'s naive "always darken bg" approach gives.
export function luminance(hex) {
  if (!hex || hex[0] !== '#') return 0.5;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Pick a readable foreground for a given chip background. For dark/saturated
// bgs (luminance < 0.5) we go nearly-white; for light bgs we go nearly-black.
// Used by event chips so Vibrant Tones' red/orange/teal events still have
// legible titles.
export function readableText(bgHex) {
  return luminance(bgHex) < 0.5 ? '#ffffff' : '#1a1a1a';
}
export function readableSubtext(bgHex) {
  return luminance(bgHex) < 0.5 ? 'rgba(255,255,255,0.78)' : 'rgba(26,26,26,0.65)';
}

// Resolve a CSS custom property to its current hex value. Walks up to <html>
// where applyColorScheme() writes scheme overrides. Falls back to the static
// hex if the var isn't set or we're outside a browser context.
export function resolveCssVar(varName, fallbackHex) {
  if (typeof document === 'undefined' || !varName) return fallbackHex;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (v && v[0] === '#') return v;
  } catch {}
  return fallbackHex;
}

// Darken (positive amount) or lighten (negative amount) a hex color
export function darkenColor(hex, amount = 0.3) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  let dr, dg, db;
  if (amount >= 0) {
    dr = Math.round(r * (1 - amount));
    dg = Math.round(g * (1 - amount));
    db = Math.round(b * (1 - amount));
  } else {
    const a = -amount;
    dr = Math.min(255, Math.round(r + (255 - r) * a));
    dg = Math.min(255, Math.round(g + (255 - g) * a));
    db = Math.min(255, Math.round(b + (255 - b) * a));
  }
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}
