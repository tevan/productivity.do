/**
 * Color schemes — orthogonal to light/dark mode. Each scheme defines an
 * accent color plus a 10-color "calendar palette" used by event chips. The
 * light/dark theme controls page background; the scheme controls accents.
 *
 * To add a scheme:
 *   1. Append an entry below.
 *   2. Provide both `light` and `dark` variants for each var.
 *   3. The 10 calendar pastels (`palette`) drive event-chip colors.
 *
 * Apply by adding `data-color-scheme="<id>"` to <html>; `applyColorScheme`
 * does this and writes companion CSS.
 */

export const COLOR_SCHEMES = [
  {
    id: 'default',
    name: 'Classic',
    description: 'Original blue accent with soft pastels.',
    swatches: ['#3b82f6', '#dbeafe', '#a3e4d7', '#fde68a', '#fbcfe8'],
    light: {
      accent: '#3b82f6',
      accentHover: '#2563eb',
      accentLight: '#dbeafe',
      error: '#ef4444',
    },
    dark: {
      accent: '#60a5fa',
      accentHover: '#93bbfd',
      accentLight: '#1e3a5f',
      error: '#f87171',
    },
  },
  {
    id: 'vibrant-tones',
    name: 'Vibrant Tones',
    description: 'Sunset oranges, lemony yellow, lush green, and deep blues.',
    swatches: ['#F94144', '#F8961E', '#F9C74F', '#43AA8B', '#277DA1'],
    light: { accent: '#277DA1', accentHover: '#1f6586', accentLight: '#d9eaf3', error: '#F94144' },
    dark:  { accent: '#4D908E', accentHover: '#6FB0AE', accentLight: '#1f3a3a', error: '#FF6B6E' },
    // Calendar event-chip palette overrides — one entry per --color-* var.
    // Picked at the top level so light AND dark mode both apply the override.
    // Use the saturated vibrant palette directly so events visibly change.
    // Light variants are mid-saturation (chip readability); dark variants
    // are deeper but still recognizable as the same hue.
    paletteOverride: {
      sky:      { light: '#7BAACD', dark: '#1c3849' }, // 277DA1 deepened
      lavender: { light: '#C4B6E6', dark: '#3e2229' },
      rose:     { light: '#F94144', dark: '#5e1f22' }, // sunset red
      peach:    { light: '#F8961E', dark: '#5e3a14' }, // orange
      mint:     { light: '#43AA8B', dark: '#1f3d34' }, // teal-green
      sage:     { light: '#90BE6D', dark: '#3a4a23' }, // sage
      butter:   { light: '#F9C74F', dark: '#5e4a1c' }, // yellow
      coral:    { light: '#F9844A', dark: '#5e3520' }, // tangerine
      lilac:    { light: '#577590', dark: '#2c3a4a' }, // muted blue
      cloud:    { light: '#4D908E', dark: '#1f3a3a' }, // teal
      powder:   { light: '#277DA1', dark: '#1c3849' }, // deep blue
      blush:    { light: '#F3722C', dark: '#5e2920' }, // burnt orange
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Deep greens with warm earth accents.',
    swatches: ['#2d6a4f', '#74c69d', '#d4a373', '#283618', '#a98467'],
    // Error tinted toward earthy brick — keeps red but pulls warmth from the
    // tan/clay palette so it doesn't feel out of place next to forest greens.
    light: { accent: '#2d6a4f', accentHover: '#1b4332', accentLight: '#d8f3dc', error: '#B7472A' },
    dark:  { accent: '#74c69d', accentHover: '#95d5b2', accentLight: '#1b4332', error: '#E07A5F' },
    paletteOverride: {
      sky:      { light: '#A4C2A5', dark: '#2c3f2c' },
      lavender: { light: '#B5A892', dark: '#3a3325' },
      rose:     { light: '#D4A373', dark: '#4f3920' }, // earthy tan
      peach:    { light: '#E2B47B', dark: '#503a20' },
      mint:     { light: '#74C69D', dark: '#1b4332' },
      sage:     { light: '#95D5B2', dark: '#284b35' },
      butter:   { light: '#FAE5A1', dark: '#4a4020' },
      coral:    { light: '#C9885D', dark: '#4a2e1a' },
      lilac:    { light: '#A98467', dark: '#3a2c20' },
      cloud:    { light: '#B7B7A4', dark: '#3a3a2c' },
      powder:   { light: '#52B788', dark: '#1f4a36' },
      blush:    { light: '#D49B6F', dark: '#4a3220' },
    },
  },
  {
    id: 'pastel',
    name: 'Pastel',
    description: 'Soft mint, blush, lavender, and peach — gentle and airy.',
    swatches: ['#A8D8C9', '#FFD3DA', '#D6CCEB', '#FFE0C2', '#C4DCEB'],
    // Pastel red — softer pink-red so it harmonizes with the airy palette
    // but still reads as warning/overdue.
    light: { accent: '#9D8BC9', accentHover: '#7e6db1', accentLight: '#ECE5F5', error: '#E26D7E' },
    dark:  { accent: '#C4B6E6', accentHover: '#D9CFEF', accentLight: '#3a3052', error: '#F48FA0' },
    // Distinctive medium-pastels that are visibly different from the
    // default near-white pastels.
    paletteOverride: {
      sky:      { light: '#A7C5E4', dark: '#2a3f54' },
      lavender: { light: '#B7A6DD', dark: '#3a2c4f' },
      rose:     { light: '#F7B5C0', dark: '#4f2c33' },
      peach:    { light: '#FFCB94', dark: '#503820' },
      mint:     { light: '#92D2BC', dark: '#2c4f44' },
      sage:     { light: '#B5CC95', dark: '#3a4a2c' },
      butter:   { light: '#FFE38A', dark: '#4f4220' },
      coral:    { light: '#FFAE8E', dark: '#503020' },
      lilac:    { light: '#CFB8E2', dark: '#3f2c50' },
      cloud:    { light: '#C9D0D8', dark: '#3a3d44' },
      powder:   { light: '#A6CCE5', dark: '#2a3f54' },
      blush:    { light: '#F3A5B5', dark: '#502a35' },
    },
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    description: 'Pure grayscale with a single charcoal accent.',
    swatches: ['#1a1a1a', '#404040', '#737373', '#a3a3a3', '#e5e5e5'],
    // Heavily desaturated red — still recognizably red so overdue reads as
    // warning, but muted enough to feel at home in a grayscale composition.
    light: { accent: '#1a1a1a', accentHover: '#404040', accentLight: '#e5e5e5', error: '#A05A55' },
    dark:  { accent: '#e5e5e5', accentHover: '#fafafa', accentLight: '#404040', error: '#C68A87' },
    // 12 distinct gray tones so calendars/events still distinguish from
    // each other but the whole calendar reads as a grayscale composition.
    paletteOverride: {
      sky:      { light: '#E8E8E8', dark: '#383838' },
      lavender: { light: '#DCDCDC', dark: '#3D3D3D' },
      rose:     { light: '#D0D0D0', dark: '#424242' },
      peach:    { light: '#C4C4C4', dark: '#474747' },
      mint:     { light: '#B8B8B8', dark: '#4C4C4C' },
      sage:     { light: '#ACACAC', dark: '#525252' },
      butter:   { light: '#E0E0E0', dark: '#3A3A3A' },
      coral:    { light: '#A0A0A0', dark: '#575757' },
      lilac:    { light: '#D8D8D8', dark: '#3F3F3F' },
      cloud:    { light: '#CCCCCC', dark: '#444444' },
      powder:   { light: '#C0C0C0', dark: '#494949' },
      blush:    { light: '#B4B4B4', dark: '#4F4F4F' },
    },
  },
];

export function getScheme(id) {
  return COLOR_SCHEMES.find(s => s.id === id) || COLOR_SCHEMES[0];
}

/**
 * Apply a color scheme by writing CSS custom properties to <html>. Picks
 * the light or dark variant based on which mode class is currently set
 * (or defers — App.svelte's theme effect re-applies on change).
 */
export function applyColorScheme(id, isDark) {
  const scheme = getScheme(id);
  const vars = isDark ? scheme.dark : scheme.light;
  const root = document.documentElement;
  // Use !important via setProperty's third arg so we beat the @media-query
  // theme bg rules in index.html that use !important themselves, and also
  // beat the per-mode :global rules in App.svelte.
  root.style.setProperty('--accent', vars.accent, 'important');
  root.style.setProperty('--accent-hover', vars.accentHover, 'important');
  root.style.setProperty('--accent-light', vars.accentLight, 'important');
  if (vars.error) {
    root.style.setProperty('--error', vars.error, 'important');
  } else {
    root.style.removeProperty('--error');
  }
  root.dataset.colorScheme = id;

  // Apply calendar-palette override if the scheme provides one.
  const palette = scheme.paletteOverride || {};
  const PALETTE_KEYS = ['sky', 'lavender', 'rose', 'peach', 'mint', 'sage', 'butter', 'coral', 'lilac', 'cloud', 'powder', 'blush'];
  for (const key of PALETTE_KEYS) {
    if (palette[key]) {
      const variant = palette[key][isDark ? 'dark' : 'light'];
      root.style.setProperty(`--color-${key}`, variant, 'important');
    } else {
      root.style.removeProperty(`--color-${key}`);
    }
  }
}
