import { api } from '../api.js';

let links = $state([]);
let byKey = $state({});

export function getLinks() {
  return {
    get items() { return links; },
    get byKey() { return byKey; },
  };
}

export async function loadLinks() {
  try {
    const r = await api('/api/links');
    if (r?.ok) {
      links = r.links || [];
      byKey = r.byKey || {};
    }
  } catch (e) {
    console.error('Failed to load links:', e);
  }
}

export async function createLink(fromType, fromId, toType, toId) {
  const r = await api('/api/links', {
    method: 'POST',
    body: JSON.stringify({ fromType, fromId, toType, toId }),
  });
  if (r?.ok && r.link) {
    await loadLinks(); // refresh index
    return r.link;
  }
  return null;
}

export async function deleteLink(id) {
  const r = await api(`/api/links/${id}`, { method: 'DELETE' });
  if (r?.ok) {
    await loadLinks();
    return true;
  }
  return false;
}

// Helpers — given a resource, return its linked counterparts.
export function linksForEvent(calendarId, eventId) {
  const key = `event:${calendarId}|${eventId}`;
  return byKey[key] || [];
}
export function linksForTask(taskId) {
  const key = `task:${taskId}`;
  return byKey[key] || [];
}
export function linksForNote(noteId) {
  const key = `note:${noteId}`;
  return byKey[key] || [];
}
