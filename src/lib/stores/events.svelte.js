import { api } from '../api.js';
import { toastSuccess, toastError, toastUndo } from '../utils/toast.svelte.js';

let events = $state([]);
let loading = $state(false);
// Hydrate from localStorage so a fresh page load doesn't read "Not synced"
// while the first fetch is in flight; we already have a timestamp from the
// previous session.
const LS_LAST_SYNC_KEY = 'productivity_last_synced_at';
let lastSyncedAt = $state((() => {
  try {
    const raw = localStorage.getItem(LS_LAST_SYNC_KEY);
    const v = raw ? parseInt(raw, 10) : null;
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
})());
let lastSyncFailed = $state(false);

// Cache fetched event lists by view-range key. Stale-while-revalidate: when
// the user navigates back to a previously-viewed range we paint the cached
// events immediately (so the calendar isn't blank for seconds), then refetch
// in the background to reconcile any changes. The TTL guards against caches
// going indefinitely stale across long sessions.
//
// Persistence: the most-recent cache entries also write to localStorage
// (`productivity_events_cache`). On page refresh the in-memory Map is
// rehydrated from localStorage so the first visible view paints from disk
// instantly while the network refetch runs in the background.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const LS_CACHE_KEY = 'productivity_events_cache';
const LS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h on disk
const rangeCache = new Map(); // key → { events, fetchedAt }
const inFlight = new Map();   // key → Promise (dedupe concurrent fetches)
const MAX_CACHE_ENTRIES = 24; // ~6 months of weekly views
// The most-recently-requested cache key. A fetch only commits its results to
// `events` if it's still the active range — guards against navigation races
// where an older fetch resolves after a newer navigation, painting stale
// data on the wrong view.
let activeKey = null;

// Hydrate from localStorage on module load. We pre-populate `events` with
// the union of all cached entries so the very first render of any view has
// something to show. The view-specific fetchEvents() call will replace this
// with the exact range as soon as it fires.
try {
  const raw = localStorage.getItem(LS_CACHE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const allEvents = new Map(); // dedupe by id
    for (const [k, v] of Object.entries(parsed || {})) {
      if (v && Array.isArray(v.events) && (now - v.fetchedAt) < LS_CACHE_TTL_MS) {
        rangeCache.set(k, v);
        for (const ev of v.events) {
          if (ev?.id && !allEvents.has(ev.id)) allEvents.set(ev.id, ev);
        }
      }
    }
    if (allEvents.size > 0) {
      events = [...allEvents.values()];
    }
  }
} catch {}

function persistCache() {
  try {
    const obj = {};
    for (const [k, v] of rangeCache.entries()) obj[k] = v;
    localStorage.setItem(LS_CACHE_KEY, JSON.stringify(obj));
  } catch {}
}

function cacheKey(start, end) {
  return `${start.toISOString()}|${end.toISOString()}`;
}

function pruneCache() {
  if (rangeCache.size <= MAX_CACHE_ENTRIES) return;
  const oldest = [...rangeCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  const toDelete = oldest.slice(0, rangeCache.size - MAX_CACHE_ENTRIES);
  for (const [k] of toDelete) rangeCache.delete(k);
}

export function getEvents() {
  return {
    get items() { return events; },
    get loading() { return loading; },
    get lastSyncedAt() { return lastSyncedAt; },
    get lastSyncFailed() { return lastSyncFailed; },
  };
}

// Optimistic patch — applies fields to the matching event immediately so
// the UI reflects user intent without waiting for the network round-trip.
// updateEvent() runs after this and overwrites with the server's response,
// so any divergence (e.g. recurrence rounding, server-side normalization)
// resolves itself within ~one frame of the response landing.
export function applyLocalPatch(eventId, patch) {
  events = events.map(ev => ev.id === eventId ? { ...ev, ...patch } : ev);
}

// Force a refetch of the current view range, bypassing the freshness check.
// Used by the manual "click to re-sync" affordance in the sidebar footer.
// In-flight throttle: ignore clicks fired within 5s of the last sync to
// keep someone mashing the button from hammering the API.
//
// IMPORTANT: don't delete the cached entry before refetching — that would
// make fetchEvents() see "no cache" and blank `events` to [] while the
// network round-trip runs. The user perceives the entire calendar
// flashing empty, which is jarring for a routine sync. Instead, mark the
// entry stale (fetchedAt = 0) so events keep painting from cache while
// the request is in flight, and only the new payload replaces them.
let lastManualSyncAt = 0;
export async function manualResync(start, end) {
  const now = Date.now();
  if (now - lastManualSyncAt < 5000) return false;
  lastManualSyncAt = now;
  const key = cacheKey(start, end);
  const cached = rangeCache.get(key);
  if (cached) cached.fetchedAt = 0;
  await fetchEvents(start, end);
  return true;
}

export async function fetchEvents(start, end) {
  const key = cacheKey(start, end);
  activeKey = key;
  const cached = rangeCache.get(key);
  const isFresh = cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS;

  // Paint cached events immediately if we have any. Even stale entries are
  // shown — the UI feels instant and the background refetch corrects it.
  // Exception: if the cached entry is EMPTY, treat it as untrustworthy and
  // always re-fetch in the foreground. An empty cache is the signature of
  // an interrupted previous fetch (auth expiry, network blip, race during
  // rapid navigation) — painting [] when the user expects events is the
  // worst failure mode. Spend the network round-trip instead.
  if (cached && cached.events.length > 0) {
    events = cached.events;
    if (isFresh) return; // No refetch needed
  } else if (cached) {
    // Empty cached entry — keep showing whatever's currently on screen
    // until the fresh fetch returns, rather than committing to blank.
  } else {
    // No cache for this range: clear stale events from a previous view
    // immediately so the user doesn't see e.g. "next week's events" while
    // we fetch this range. Loading bar covers the gap.
    events = [];
  }

  // Dedupe: if another fetcher is already in-flight for this exact range,
  // await its result instead of double-firing.
  if (inFlight.has(key)) {
    await inFlight.get(key);
    return;
  }

  // Only show the loading bar when we have no cached events to paint.
  if (!cached) loading = true;

  const promise = (async () => {
    try {
      const params = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
      });
      const res = await api(`/api/events?${params}`);
      if (res.ok) {
        const fresh = res.events || [];
        rangeCache.set(key, { events: fresh, fetchedAt: Date.now() });
        pruneCache();
        persistCache();
        lastSyncedAt = Date.now();
        lastSyncFailed = false;
        try { localStorage.setItem(LS_LAST_SYNC_KEY, String(lastSyncedAt)); } catch {}
        // Only commit if we're still the active range. Guards against
        // navigation races: user fires fetch(A), then fetch(B), A resolves
        // after B and would otherwise overwrite B's freshly-painted events.
        if (key === activeKey) events = fresh;
      }
    } catch (e) {
      console.error('Failed to fetch events:', e);
      lastSyncFailed = true;
    } finally {
      if (key === activeKey) loading = false;
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  await promise;
}

// Invalidate every cached range whose window overlaps [start, end]. Called
// after create/update/delete so subsequent navigations see the change. The
// currently-displayed `events` array is mutated separately by each helper.
function invalidateRangesOverlapping(start, end) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  for (const [key, val] of rangeCache.entries()) {
    const [k0, k1] = key.split('|');
    const ks = new Date(k0).getTime();
    const ke = new Date(k1).getTime();
    if (ks <= e && ke >= s) rangeCache.delete(key);
  }
  persistCache();
}

// Hide an event for the current user. The backend keeps the event in
// Google but filters it out of /api/events for this user — so locally we
// drop it from the live array and invalidate the cached range so a refetch
// won't bring it back. EventContextMenu used to fire a CustomEvent and
// hope someone was listening; this is the proper store path.
export async function hideEvent(calId, eventId) {
  const target = events.find(e => e.calendarId === calId && e.id === eventId);
  if (target) {
    events = events.filter(e => !(e.calendarId === calId && e.id === eventId));
    invalidateRangesOverlapping(target.start, target.end);
  }
  try {
    await api('/api/hidden-events', {
      method: 'POST',
      body: JSON.stringify({ calendarId: calId, eventId }),
    });
  } catch (e) {
    // Best-effort. Roll back the local hide if the server call fails so the
    // user doesn't see the event vanish only to reappear on next navigation.
    if (target) {
      events = [...events, target];
    }
    throw e;
  }
}

// Back-compat: EventContextMenu dispatches `events:invalidate` after older
// code paths. Listen and force-refetch the active range so any not-yet-
// migrated mutation still results in a UI update.
if (typeof window !== 'undefined') {
  window.addEventListener('events:invalidate', () => {
    if (!activeKey) return;
    const [k0, k1] = activeKey.split('|');
    rangeCache.delete(activeKey);
    fetchEvents(k0, k1);
  });
}

/**
 * Create an event. Options:
 *   { silent: true }  — suppress success toast (used for high-frequency ops
 *                       like drag-to-create, where the user already saw the
 *                       result land on the calendar).
 *   { onView }        — optional callback for the "View" action. Default
 *                       behavior is set by the caller; if omitted, no action
 *                       button is rendered.
 *
 * Returns the created event on success; null on failure. Errors surface as
 * a toast — call sites don't need to render their own error UI.
 */
export async function createEvent(data, { silent = false, onView } = {}) {
  const isNative = !data.calendarId || data.calendarId === 'native';
  const url = isNative ? '/api/native/events' : '/api/events';
  try {
    const res = await api(url, { method: 'POST', body: JSON.stringify(data) });
    if (res.ok && res.event) {
      events = [...events, res.event];
      invalidateRangesOverlapping(res.event.start, res.event.end);
      if (!silent) {
        const title = res.event.summary || 'Event';
        const action = onView
          ? { label: 'View', onClick: () => onView(res.event) }
          : null;
        toastSuccess(`Created “${truncate(title, 40)}”`, action ? { action } : {});
      }
      return res.event;
    }
    // Backend returned {ok:false}. Pull a useful message from `error` or
    // `code`; fall back to a generic line so the user always sees feedback
    // instead of a silently-closed modal.
    if (!silent) toastError(extractErrorMessage(res, 'Could not create event'));
    return null;
  } catch (e) {
    console.error('Failed to create event:', e);
    if (!silent) toastError('Could not create event. Check your connection.');
    return null;
  }
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function extractErrorMessage(res, fallback) {
  if (!res) return fallback;
  if (typeof res.error === 'string' && res.error) return `${fallback}: ${res.error}`;
  if (typeof res.message === 'string' && res.message) return `${fallback}: ${res.message}`;
  return fallback;
}

/**
 * Update an event. Errors surface as a toast. `silent: true` suppresses the
 * "could not update" toast (used by drag handlers, which prefer to roll back
 * the optimistic patch silently rather than spam toasts on every failed
 * resize).
 */
export async function updateEvent(calendarId, eventId, data, { silent = false } = {}) {
  const url = (calendarId === 'native' || !calendarId)
    ? `/api/native/events/${eventId}`
    : `/api/events/${calendarId}/${eventId}`;
  try {
    const res = await api(url, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (res.ok && res.event) {
      events = events.map(ev =>
        ev.id === eventId ? { ...ev, ...res.event } : ev
      );
      invalidateRangesOverlapping(data.start || res.event.start, data.end || res.event.end);
      if (res.event.start !== data.start || res.event.end !== data.end) {
        invalidateRangesOverlapping(res.event.start, res.event.end);
      }
      return res.event;
    }
    if (!silent) toastError(extractErrorMessage(res, 'Could not update event'));
    return null;
  } catch (e) {
    console.error('Failed to update event:', e);
    if (!silent) toastError('Could not update event. Check your connection.');
    return null;
  }
}

/**
 * Delete an event. Shows an "Undo" toast for native events (where we can
 * recreate from cached data) — Google events delete-then-recreate would
 * lose attendees + invitee responses, so we only surface Undo for native.
 *
 * Returns true on success, false on failure.
 */
export async function deleteEvent(calendarId, eventId, { silent = false, scope = 'instance' } = {}) {
  const removed = events.find(ev => ev.id === eventId);
  const isNative = (calendarId === 'native' || !calendarId);
  // Scope only applies to Google events; native events have no recurrence
  // semantics yet. Server validates and falls back to 'instance' on
  // anything unrecognized, but we belt-and-suspenders here so the URL
  // is clean for native + non-recurring deletes.
  const safeScope =
    !isNative && (scope === 'series' || scope === 'following') ? scope : null;
  const baseUrl = isNative
    ? `/api/native/events/${eventId}`
    : `/api/events/${calendarId}/${eventId}`;
  const url = safeScope ? `${baseUrl}?scope=${safeScope}` : baseUrl;
  try {
    const res = await api(url, { method: 'DELETE' });
    if (res.ok) {
      // Optimistic UI strip. For 'series' / 'following' we ALSO strip any
      // matching cached events in the in-memory store, since the server
      // wipe might cover instances we hadn't yet refetched. The match
      // looks for events sharing the same recurringEventId, OR the same
      // id (the parent itself).
      if (safeScope === 'series' && removed) {
        const seriesId = removed.recurringEventId || removed.id;
        events = events.filter(ev =>
          ev.recurringEventId !== seriesId && ev.id !== seriesId
        );
      } else if (safeScope === 'following' && removed) {
        const seriesId = removed.recurringEventId;
        const cutoff = removed.start;
        events = events.filter(ev =>
          !(ev.recurringEventId === seriesId && ev.start >= cutoff)
        );
        // And the explicit instance, if it's still there.
        events = events.filter(ev => ev.id !== eventId);
      } else {
        events = events.filter(ev => ev.id !== eventId);
      }
      if (removed) invalidateRangesOverlapping(removed.start, removed.end);
      if (!silent && removed) {
        const title = removed.summary || 'Event';
        if (isNative) {
          // Native events soft-delete to trash, so undo restores the same
          // row (preserving the original id, attendees, recurrence, etc).
          // Google events can't be undone — the upstream delete is final.
          toastUndo(`Deleted “${truncate(title, 40)}”`, async () => {
            try {
              const r = await api('/api/trash/restore', {
                method: 'POST',
                body: JSON.stringify({ resource: 'events_native', id: eventId }),
              });
              if (r?.ok) {
                events = [...events, removed];
                invalidateRangesOverlapping(removed.start, removed.end);
                toastSuccess('Restored');
              } else {
                toastError('Could not restore event');
              }
            } catch {
              toastError('Could not restore event');
            }
          });
        } else {
          // Plain success toast for Google (no Undo).
          toastSuccess(`Deleted “${truncate(title, 40)}”`);
        }
      }
      return true;
    }
    if (!silent) toastError(extractErrorMessage(res, 'Could not delete event'));
    return false;
  } catch (e) {
    console.error('Failed to delete event:', e);
    if (!silent) toastError('Could not delete event. Check your connection.');
    return false;
  }
}
