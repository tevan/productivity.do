// Top-level "holistic view" selector — Calendar | Tasks | Notes.
// This is intentionally separate from `view.svelte.js` (which controls the
// calendar's day/week/month sub-view). Different concept, different state.
//
// Persistence: server-side, per form-factor (see viewPersistence.js).
// localStorage is a hydration mirror so first paint matches the user's last
// choice without waiting for the prefs API.
//
// Tab order + visibility lives in `prefs.values.appTabs` ({ order, hidden }).
// We expose `getVisibleTabs(prefs)` so the toolbar can render the right shape
// without re-implementing the merge.

import { readLocalView, reconcileFromPrefs, writeView } from '../utils/viewPersistence.js';

const VIEW_NAME = 'appView';
const VALID = ['calendar', 'tasks', 'notes'];
const DEFAULT = 'calendar';

// Source-of-truth catalog. New entries (e.g. integration-driven tabs in the
// future) land here AND in any place that maps tab id → label / icon.
export const ALL_APP_TABS = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'tasks',    label: 'Tasks' },
  { id: 'notes',    label: 'Notes' },
];

// Cap on visible tabs. Forward-looking — current 3 fit; if/when we lift the
// cap to allow integration-driven tabs we change one constant.
export const MAX_VISIBLE_TABS = 3;

let appView = $state(readLocalView(VIEW_NAME, VALID, DEFAULT));

export function getAppView() {
  return {
    get current() { return appView; },
  };
}

export function setAppView(v) {
  if (!VALID.includes(v)) return;
  appView = v;
  writeView(VIEW_NAME, v);
}

// Read-only accessor for the current value — used by the auto-fallback
// when a hidden-tab edit makes the active view invisible.
export function currentAppView() { return appView; }

// Called once after `prefs` loads from the server — reconciles the local
// hydration value to the authoritative server value if they differ.
export function reconcileAppViewFromPrefs(prefs) {
  const v = reconcileFromPrefs(prefs, VIEW_NAME, VALID, DEFAULT);
  if (v !== appView) appView = v;
  // If the user has hidden the currently active tab, fall through to the
  // first visible tab so they're not stuck on an invisible view.
  const visible = getVisibleTabs(prefs);
  if (!visible.find(t => t.id === appView)) {
    setAppView(visible[0]?.id || DEFAULT);
  }
}

// Returns the tabs the toolbar should render, in order. Honors `appTabs.order`
// and `appTabs.hidden`. Falls back to all tabs if the pref is missing.
// At least one tab is always returned — see MAX_VISIBLE_TABS guard.
export function getVisibleTabs(prefsValues) {
  const cfg = prefsValues?.appTabs || {};
  const order = Array.isArray(cfg.order) && cfg.order.length
    ? cfg.order
    : ALL_APP_TABS.map(t => t.id);
  const hidden = new Set(Array.isArray(cfg.hidden) ? cfg.hidden : []);
  // Map order → tab metadata, drop hidden, then append any unknown tab ids
  // that weren't in `order` so a freshly-added tab doesn't disappear.
  const ordered = order
    .filter(id => !hidden.has(id))
    .map(id => ALL_APP_TABS.find(t => t.id === id))
    .filter(Boolean);
  for (const t of ALL_APP_TABS) {
    if (!ordered.find(o => o.id === t.id) && !hidden.has(t.id)) ordered.push(t);
  }
  // Cap at MAX_VISIBLE_TABS. Anything past the cap is silently truncated —
  // Settings UI should prevent the user reaching this state, but we defend
  // here too so a malformed pref can't cram the toolbar.
  return ordered.slice(0, MAX_VISIBLE_TABS);
}
