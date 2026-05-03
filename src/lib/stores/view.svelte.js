import { getViewRange, formatDateRange, getMonthName, formatDate, addDays, addWeeks, addMonths, startOfWeek } from '../utils/dates.js';
import { readLocalView, reconcileFromPrefs, writeView, getFormFactor } from '../utils/viewPersistence.js';

// Legacy localStorage key — kept for backward-compat one-time migration into
// the new per-form-factor scheme. Future code should not read this directly.
const LEGACY_VIEW_KEY = 'productivity_last_view';
const DATE_KEY = 'productivity_last_date';

const CAL_VIEW_NAME = 'calendarView';
const VALID_VIEWS = ['day', 'nextdays', 'week', 'month'];
// Sensible per-form-factor defaults: desktop sees a wider window, mobile
// sees the day. Users override at any time.
const DEFAULT_BY_FACTOR = { desktop: 'nextdays', mobile: 'day' };

function loadInitialView() {
  const factor = getFormFactor();
  const fallback = DEFAULT_BY_FACTOR[factor] || 'nextdays';
  // Prefer the new per-form-factor key; fall back to the legacy single-key.
  const fromNew = readLocalView(CAL_VIEW_NAME, VALID_VIEWS, null, factor);
  if (fromNew) return fromNew;
  try {
    const v = localStorage.getItem(LEGACY_VIEW_KEY);
    if (v && VALID_VIEWS.includes(v)) return v;
  } catch {}
  return fallback;
}

function loadInitialDate() {
  try {
    const stored = localStorage.getItem(DATE_KEY);
    if (stored) {
      const t = parseInt(stored);
      if (!isNaN(t)) {
        const d = new Date(t);
        // If saved date is more than 90 days old, fall back to today.
        const ageDays = Math.abs((Date.now() - t) / 86400000);
        if (ageDays < 90) return d;
      }
    }
  } catch {}
  return new Date();
}

let currentView = $state(loadInitialView());
let currentDate = $state(loadInitialDate());
let sidebarOpen = $state(true);

function persistView(v) {
  // Per-form-factor persistence (server + localStorage mirror). Also writes
  // the legacy key during the transition so a session that boots an old
  // build still reads a sane value.
  writeView(CAL_VIEW_NAME, v);
  try { localStorage.setItem(LEGACY_VIEW_KEY, v); } catch {}
}

// Called once after prefs load to sync the locally-hydrated view with the
// server's per-form-factor value if they differ.
export function reconcileViewFromPrefs(prefs) {
  const factor = getFormFactor();
  const fallback = DEFAULT_BY_FACTOR[factor] || 'nextdays';
  const v = reconcileFromPrefs(prefs, CAL_VIEW_NAME, VALID_VIEWS, fallback, factor);
  if (v && v !== currentView) currentView = v;
}
function persistDate(d) {
  try { localStorage.setItem(DATE_KEY, String(d.getTime())); } catch {}
}

export function getView() {
  const viewStart = $derived.by(() => {
    const prefs = getStoredPrefs();
    return getViewRange(currentView, currentDate, prefs).start;
  });

  const viewEnd = $derived.by(() => {
    const prefs = getStoredPrefs();
    return getViewRange(currentView, currentDate, prefs).end;
  });

  const viewLabel = $derived.by(() => {
    const prefs = getStoredPrefs();
    const range = getViewRange(currentView, currentDate, prefs);

    if (currentView === 'month') {
      return `${getMonthName(currentDate)} ${currentDate.getFullYear()}`;
    }
    if (currentView === 'day') {
      return formatDate(currentDate);
    }
    return formatDateRange(range.start, range.end);
  });

  return {
    get currentView() { return currentView; },
    get currentDate() { return currentDate; },
    get sidebarOpen() { return sidebarOpen; },
    get viewStart() { return viewStart; },
    get viewEnd() { return viewEnd; },
    get viewLabel() { return viewLabel; },
  };
}

// Simple pref cache for derived computations (avoids circular import)
let _prefsCache = { nextDaysCount: 5, weekStartDay: 'sunday' };
export function setPrefsCache(prefs) {
  _prefsCache = prefs;
}
function getStoredPrefs() {
  return _prefsCache;
}

export function goToday() {
  currentDate = new Date();
  persistDate(currentDate);
}

export function goNext() {
  const prefs = getStoredPrefs();
  switch (currentView) {
    case 'day':
      currentDate = addDays(currentDate, 1);
      break;
    case 'nextdays':
      currentDate = addDays(currentDate, prefs.nextDaysCount || 5);
      break;
    case 'week':
      currentDate = addWeeks(currentDate, 1);
      break;
    case 'month':
      currentDate = addMonths(currentDate, 1);
      break;
  }
  persistDate(currentDate);
}

export function goPrev() {
  const prefs = getStoredPrefs();
  switch (currentView) {
    case 'day':
      currentDate = addDays(currentDate, -1);
      break;
    case 'nextdays':
      currentDate = addDays(currentDate, -(prefs.nextDaysCount || 5));
      break;
    case 'week':
      currentDate = addWeeks(currentDate, -1);
      break;
    case 'month':
      currentDate = addMonths(currentDate, -1);
      break;
  }
  persistDate(currentDate);
}

export function setView(view) {
  currentView = view;
  persistView(view);
}

export function setDate(date) {
  currentDate = new Date(date);
  persistDate(currentDate);
}

export function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
}
