import { api } from '../api.js';
import { setPrefsCache } from './view.svelte.js';

const DEFAULTS = {
  defaultView: 'nextdays',
  nextDaysCount: 5,
  weekStartDay: 'monday',
  showWeekends: true,
  showDayView: false,
  enabledViews: ['nextdays', 'week', 'month'],
  sidebarSections: { miniCalendar: true, tasks: true, sets: true, bookingPages: true, calendars: true },
  taskGroupBy: 'date',
  taskGroupByOptions: ['date', 'project'],
  timeFormat: '12h',
  defaultEventDuration: 30,
  theme: 'system',
  colorScheme: 'default',
  accentColor: '#3b82f6',
  weatherLocation: { lat: 40.76, lon: -111.89 },
  weatherLocationLabel: 'Salt Lake City, UT',
  weatherDisplay: 'highLow', // 'highLow' | 'current' | 'both'
  confirmDeleteTask: true,
  confirmDeleteEvent: true,
  confirmDeleteNote: true,
  showHoverSlot: false,
  sidebarWidthPreset: 'standard', // 'standard' | 'wide' | 'custom'
  dragSnapMinutes: 30,            // 15 or 30 — snap granularity for drag-create / drag-resize
  temperatureUnit: 'F',
  showWeather: true,
  showTravelTime: true,
  showTravelBlocks: true,
  dimPastEvents: true,
  showDeclinedEvents: false,
  showDuplicateWorkingLocations: false,
  showWeekNumbers: false,
  primaryTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  additionalTimezones: [],
  defaultReminderMinutes: 10,
  enableBrowserNotifications: false,
  reminderSound: true,
  syncCalendarVisibility: true,
  hiddenCalendarIds: [],
  workHours: {
    sun: [],
    mon: [{ start: '09:00', end: '17:00' }],
    tue: [{ start: '09:00', end: '17:00' }],
    wed: [{ start: '09:00', end: '17:00' }],
    thu: [{ start: '09:00', end: '17:00' }],
    fri: [{ start: '09:00', end: '17:00' }],
    sat: [],
  },
  defaultTaskDuration: 30,
  // Notes metadata strip below the title in NotesView. Each flag toggles
  // one cell. Defaults: timestamps on, counts off (less noise out of the box).
  notesShowUpdated: true,
  notesShowCreated: true,
  notesShowWords: false,
  notesShowChars: false,
  notesShowReadTime: false,
  // When true, Todoist project dots adopt the active color scheme's palette
  // (each Todoist color name buckets into one of the 12 scheme slots). When
  // false (default), we render Todoist's literal hex so project colors match
  // the official Todoist UI 1:1. Off by default because it diverges from
  // upstream and people sometimes want that exact match.
  themeProjectColors: false,
};

const LS_KEY = 'productivity_prefs_cache';

// Hydrate from localStorage synchronously so user-customized layout (hidden
// sidebar sections, taskGroupBy, accent color, etc.) is correct on the first
// paint. Network fetch overrides afterward if the server has different values.
function readCache() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function writeCache(p) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch {}
}

let prefs = $state({ ...DEFAULTS, ...(readCache() || {}) });

export function getPrefs() {
  return {
    get values() { return prefs; },
  };
}

export async function fetchPrefs() {
  try {
    const res = await api('/api/preferences');
    if (res.ok && res.preferences) {
      prefs = { ...DEFAULTS, ...res.preferences };
    }
  } catch (e) {
    console.error('Failed to fetch prefs:', e);
  }
  // Backward-compat: legacy showDayView flag implies day is enabled.
  if (prefs.showDayView && !prefs.enabledViews.includes('day')) {
    prefs = { ...prefs, enabledViews: [...prefs.enabledViews, 'day'] };
  }
  // Ensure at least one view is always enabled
  if (!prefs.enabledViews || prefs.enabledViews.length === 0) {
    prefs = { ...prefs, enabledViews: ['nextdays'] };
  }
  writeCache(prefs);
  setPrefsCache(prefs);
}

export async function updatePref(key, value) {
  prefs = { ...prefs, [key]: value };
  writeCache(prefs);
  setPrefsCache(prefs);
  // Apply color-scheme synchronously so any $derived that reads CSS vars
  // (event chip text color, etc.) sees the new vars on its next recompute.
  // Without this, the derived re-runs from the prefs-change tick BEFORE the
  // App.svelte $effect writes the new CSS vars, leaving text the wrong color
  // until the next user interaction.
  if (key === 'colorScheme' || key === 'theme') {
    try {
      const { applyColorScheme } = await import('../utils/colorSchemes.js');
      // Resolve dark mode from the locally-staged prefs value (the new theme
      // may not have been written to <html> yet). matchMedia covers the
      // 'system' case. Don't read documentElement.classList — it's downstream
      // of this code path, see CLAUDE.md.
      const isDark = prefs.theme === 'dark' ||
        (prefs.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      applyColorScheme(prefs.colorScheme || 'default', isDark);
    } catch {}
  }
  try {
    await api('/api/preferences', {
      method: 'PUT',
      body: JSON.stringify({ [key]: value }),
    });
  } catch (e) {
    console.error('Failed to update pref:', e);
  }
}

export async function updatePrefs(obj) {
  prefs = { ...prefs, ...obj };
  writeCache(prefs);
  setPrefsCache(prefs);
  try {
    await api('/api/preferences', {
      method: 'PUT',
      body: JSON.stringify(obj),
    });
  } catch (e) {
    console.error('Failed to update prefs:', e);
  }
}
