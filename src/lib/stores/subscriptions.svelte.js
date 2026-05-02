// Subscriptions store — inbound ICS feeds (Google Calendar exports,
// sports schedules, holidays, etc.). Refreshed every 6 hours by the
// backend; the SPA shows them in the sidebar like normal calendars but
// each row is read-only and prefixed with a `sub-` calendar id.

import { api } from '../api.js';

let items = $state([]);
let loaded = $state(false);
let loading = $state(false);

export function getSubscriptions() {
  return {
    get items() { return items; },
    get loaded() { return loaded; },
    get loading() { return loading; },
  };
}

export async function fetchSubscriptions() {
  if (loading) return;
  loading = true;
  try {
    const r = await api('/api/subscriptions');
    if (r?.ok) {
      items = r.subscriptions || [];
      loaded = true;
    }
  } finally {
    loading = false;
  }
}

export async function toggleSubscriptionVisible(sub) {
  // Optimistic flip — events from this feed are already in the events
  // store; toggling visible just decides whether the sidebar checkbox
  // shows them. Server-side `visible` flag is stored so other devices
  // mirror.
  const next = !sub.visible;
  items = items.map(s => s.id === sub.id ? { ...s, visible: next } : s);
  await api(`/api/subscriptions/${sub.id}`, {
    method: 'PUT',
    body: JSON.stringify({ visible: next }),
  });
}

export async function refreshSubscription(id) {
  await api(`/api/subscriptions/${id}/refresh`, { method: 'POST' });
  await fetchSubscriptions();
}

export async function removeSubscription(id) {
  await api(`/api/subscriptions/${id}`, { method: 'DELETE' });
  items = items.filter(s => s.id !== id);
}
