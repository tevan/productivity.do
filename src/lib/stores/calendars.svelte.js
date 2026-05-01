import { api } from '../api.js';

const VISIBILITY_KEY = 'productivity_cal_visibility';

function loadLocalVisibility() {
  try {
    const stored = localStorage.getItem(VISIBILITY_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
}

function saveLocalVisibility(cals) {
  try {
    const map = {};
    for (const c of cals) map[c.id] = c.visible;
    localStorage.setItem(VISIBILITY_KEY, JSON.stringify(map));
  } catch {}
}

let calendars = $state([]);
let calendarSets = $state([]);
let activeSetId = $state(null);

export function getCalendars() {
  const visibleCalendarIds = $derived.by(() => {
    if (activeSetId) {
      const set = calendarSets.find(s => s.id === activeSetId);
      if (set) return new Set(set.calendarIds);
    }
    return new Set(calendars.filter(c => c.visible).map(c => c.id));
  });

  return {
    get items() { return calendars; },
    get sets() { return calendarSets; },
    get activeSetId() { return activeSetId; },
    get visibleCalendarIds() { return visibleCalendarIds; },
  };
}

export async function fetchCalendars(serverVisibility = null) {
  try {
    const res = await api('/api/calendars');
    if (res.ok) {
      const saved = serverVisibility || loadLocalVisibility();
      calendars = (res.calendars || []).map((c, i) => ({
        ...c,
        visible: saved && c.id in saved ? saved[c.id] : c.visible !== false,
        colorIndex: c.colorIndex ?? i,
      }));
      calendarSets = res.sets || [];
    }
  } catch (e) {
    console.error('Failed to fetch calendars:', e);
  }
}

export function toggleCalendar(id, syncToServer = false) {
  calendars = calendars.map(c =>
    c.id === id ? { ...c, visible: !c.visible } : c
  );
  saveLocalVisibility(calendars);
  if (syncToServer) {
    const map = {};
    for (const c of calendars) map[c.id] = c.visible;
    api('/api/preferences', {
      method: 'PUT',
      body: JSON.stringify({ calendarVisibility: map }),
    }).catch(console.error);
  }
}

export function switchSet(setId) {
  activeSetId = activeSetId === setId ? null : setId;
}

export async function createSet(name, calendarIds) {
  try {
    const res = await api('/api/calendar-sets', {
      method: 'POST',
      body: JSON.stringify({ name, calendarIds }),
    });
    if (res.ok && res.set) {
      calendarSets = [...calendarSets, res.set];
      return res.set;
    }
    return null;
  } catch (e) {
    console.error('Failed to create calendar set:', e);
    return null;
  }
}

export async function deleteSet(id) {
  try {
    const res = await api(`/api/calendar-sets/${id}`, { method: 'DELETE' });
    if (res.ok) {
      calendarSets = calendarSets.filter(s => s.id !== id);
      if (activeSetId === id) activeSetId = null;
      return true;
    }
    return false;
  } catch (e) {
    console.error('Failed to delete calendar set:', e);
    return false;
  }
}
