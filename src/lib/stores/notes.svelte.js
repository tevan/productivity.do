import { api } from '../api.js';

// localStorage hydration so a refresh paints last-known notes immediately
// instead of an empty list flash. Same SWR pattern as the tasks store.
const NOTES_CACHE_KEY = 'productivity_notes_cache';
const NOTES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function readNotesCache() {
  try {
    const raw = localStorage.getItem(NOTES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.notes)) return null;
    if (Date.now() - (parsed.savedAt || 0) > NOTES_CACHE_TTL_MS) return null;
    return parsed.notes;
  } catch {
    return null;
  }
}
function writeNotesCache(items) {
  try {
    localStorage.setItem(NOTES_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      notes: items,
    }));
  } catch {}
}

let notes = $state(readNotesCache() || []);
let loading = $state(false);

export function getNotes() {
  return {
    get items() { return notes; },
    get loading() { return loading; },
  };
}

export async function loadNotes() {
  loading = true;
  try {
    const data = await api('/api/notes');
    // Only commit on a clean response. A 401/500 returning {ok:false} would
    // otherwise wipe the localStorage-hydrated list to [], which looks like
    // "all your notes were deleted" until the next successful fetch.
    if (data?.ok && Array.isArray(data.notes)) {
      notes = data.notes;
      writeNotesCache(notes);
    }
  } finally {
    loading = false;
  }
}

export async function createNote({ title = '', body = '', pinned = false } = {}) {
  const data = await api('/api/notes', { method: 'POST', body: JSON.stringify({ title, body, pinned }) });
  if (data?.ok && data.note) {
    notes = [data.note, ...notes];
    writeNotesCache(notes);
  }
  return data?.note || null;
}

export async function updateNote(id, patch) {
  const data = await api(`/api/notes/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
  if (data?.ok && data.note) {
    notes = notes.map(n => n.id === id ? data.note : n).sort(sortNotes);
    writeNotesCache(notes);
  }
  return data?.note || null;
}

export async function deleteNote(id) {
  const data = await api(`/api/notes/${id}`, { method: 'DELETE' });
  // Only mutate local state on a confirmed delete. A failed call should leave
  // the note visible so the user can retry rather than silently lose it.
  if (data?.ok) {
    notes = notes.filter(n => n.id !== id);
    writeNotesCache(notes);
  }
  return data?.ok || false;
}

function sortNotes(a, b) {
  if (a.pinned !== b.pinned) return b.pinned - a.pinned;
  return String(b.updatedAt).localeCompare(String(a.updatedAt));
}
