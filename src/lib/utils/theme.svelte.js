// Single source of truth for "is the UI in dark mode right now?"
//
// Three places used to compute this independently:
//   - TimeGrid: prefs.values.theme + reactive matchMedia listener (correct)
//   - App.svelte / prefs.svelte.js: read document.documentElement.classList
//
// CLAUDE.md says: derive from prefs.values.theme + matchMedia, NOT from the
// classList — which can be stale or written by someone else. This module
// exports a Svelte 5-rune-aware function so any component can call
// `getIsDark()` and get a $derived value that updates when either the
// pref or the system theme changes.
//
// For non-component callers (the app.css applyColorScheme path) this also
// exposes a snapshot-style `isDarkSnapshot()` that doesn't rely on rune
// reactivity — useful inside one-shot effects.

import { getPrefs } from '../stores/prefs.svelte.js';

let systemDark = $state(
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches
);

if (typeof window !== 'undefined') {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', (e) => { systemDark = e.matches; });
}

// Reactive: returns a getter that callers can read inside $derived.
export function getIsDark() {
  const prefs = getPrefs();
  return {
    get value() {
      const t = prefs.values.theme;
      return t === 'dark' || (t !== 'light' && systemDark);
    },
  };
}

// Snapshot: one-shot read for callers outside reactive contexts. Same logic.
export function isDarkSnapshot() {
  if (typeof window === 'undefined') return false;
  const prefs = getPrefs();
  const t = prefs.values.theme;
  return t === 'dark' || (t !== 'light' && systemDark);
}
