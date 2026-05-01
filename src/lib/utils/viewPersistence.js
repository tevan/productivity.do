// View persistence — server-side, per form-factor.
// See docs/internal/tasks-board.md § "View persistence (general principle)".
//
// Any user-selectable view in the app (top-level domain selector, Tasks
// list/board toggle, Calendar Day/Week/Month, Notes edit/split/preview, …)
// persists with this convention:
//
//   pref key = `${viewName}_${formFactor}`
//
// Form factors:
//   - desktop: viewport width >= 768px (also tablets in landscape)
//   - mobile:  viewport width <  768px (tablets in portrait too)
//
// Why server-side:
//   - New laptop / cleared browser → preference survives
//   - Matches the user's mental model: one habit per form factor, not
//     one habit per browser
//
// Local fallback:
//   - We mirror to localStorage so the *first paint* on app boot can
//     hydrate before the prefs API responds (avoids a flicker from
//     default → server-pref). The server is still authoritative —
//     once prefs load, any divergence is reconciled to the server's value.

import { api } from '../api.js';
import { updatePrefs } from '../stores/prefs.svelte.js';

// 768px matches the breakpoint used by MobileBottomNav and the Toolbar's
// mobile-hide media query — keep them aligned so a tablet in portrait
// either gets the mobile UI everywhere or nowhere.
const MOBILE_BREAKPOINT = 768;

export function getFormFactor() {
  if (typeof window === 'undefined') return 'desktop';
  return window.innerWidth < MOBILE_BREAKPOINT ? 'mobile' : 'desktop';
}

function lsKey(viewName, formFactor) {
  return `productivity_view_${viewName}_${formFactor}`;
}

// Read the locally-cached value for instant first paint. May be stale; the
// server's value supersedes once prefs load.
export function readLocalView(viewName, valid, fallback, formFactor = getFormFactor()) {
  try {
    const v = localStorage.getItem(lsKey(viewName, formFactor));
    return valid.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

// Reconcile from a freshly-loaded prefs object. Returns the server value if
// present and valid, otherwise falls back. Also re-mirrors to localStorage so
// the next page load is correct.
export function reconcileFromPrefs(prefs, viewName, valid, fallback, formFactor = getFormFactor()) {
  const key = `${viewName}_${formFactor}`;
  const v = prefs?.[key];
  if (valid.includes(v)) {
    try { localStorage.setItem(lsKey(viewName, formFactor), v); } catch {}
    return v;
  }
  return fallback;
}

// Write a view choice. Updates localStorage immediately (so a refresh keeps
// the value), then asynchronously persists to the server so other devices
// in the same form factor pick it up. Failures are swallowed — we don't
// want a transient network hiccup to lose the user's intent.
export function writeView(viewName, value, formFactor = getFormFactor()) {
  try { localStorage.setItem(lsKey(viewName, formFactor), value); } catch {}
  const key = `${viewName}_${formFactor}`;
  // Go through updatePrefs so the in-memory prefs store is updated alongside
  // the server write. Otherwise reconcileFromPrefs runs on stale prefs and
  // flips the mode back the moment any other prefs change races through.
  updatePrefs({ [key]: value });
}
