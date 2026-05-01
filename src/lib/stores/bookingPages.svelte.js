import { api } from '../api.js';

let pages = $state([]);
let loading = $state(false);
let loaded = $state(false);

export function getBookingPages() {
  return {
    get items() { return pages; },
    get loading() { return loading; },
    get loaded() { return loaded; },
  };
}

export async function fetchBookingPages() {
  loading = true;
  try {
    const res = await api('/api/booking-pages');
    if (res.ok) {
      pages = res.pages || [];
      loaded = true;
    }
  } catch (e) {
    console.error('Failed to fetch booking pages:', e);
  } finally {
    loading = false;
  }
}

export async function createBookingPage(data = {}) {
  const res = await api('/api/booking-pages', {
    method: 'POST',
    body: JSON.stringify({ title: 'Untitled meeting', ...data }),
  });
  if (res.ok) {
    pages = [res.page, ...pages];
    return res.page;
  }
  return null;
}

export async function updateBookingPage(id, data) {
  const res = await api(`/api/booking-pages/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (res.ok) {
    pages = pages.map(p => p.id === id ? res.page : p);
    return res.page;
  }
  return null;
}

export async function deleteBookingPage(id) {
  const res = await api(`/api/booking-pages/${id}`, { method: 'DELETE' });
  if (res.ok) {
    pages = pages.filter(p => p.id !== id);
    return true;
  }
  return false;
}

// Used when editor saves so the sidebar/list updates without a re-fetch
export function setBookingPage(page) {
  if (!page?.id) return;
  pages = pages.map(p => p.id === page.id ? page : p);
}
