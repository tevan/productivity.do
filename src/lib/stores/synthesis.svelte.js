// Synthesis store — keeps /api/today, /api/weekly-review, and
// /api/observations/current in $state so the SidePanel reads without a
// loading flicker.
//
// Prefetched once after page load (idle window), then auto-refreshed every
// 5 minutes while the tab is visible. All three endpoints are pure SQL
// against the user's own DB — no third-party calls — so the cost is small
// (single-digit ms per call on the local socket).
//
// The panel still shows a skeleton if the user opens it before prefetch
// completes, but in practice prefetch finishes long before the first Y
// keypress.

import { api } from '../api.js';

let today = $state(null);
let weekly = $state(null);
let observation = $state(null);
let lastFetched = $state({ today: 0, weekly: 0, observation: 0 });
let inFlight = $state({ today: false, weekly: false, observation: false });

const TTL_MS = 5 * 60_000; // 5 minutes — synthesis isn't real-time
let prefetchScheduled = false;

function tz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }
  catch { return ''; }
}

async function fetchToday(force = false) {
  if (inFlight.today) return;
  if (!force && today && Date.now() - lastFetched.today < TTL_MS) return;
  inFlight.today = true;
  try {
    const t = tz();
    const res = await api(`/api/today${t ? `?tz=${encodeURIComponent(t)}` : ''}`);
    if (res?.ok) {
      today = res;
      lastFetched.today = Date.now();
    }
  } catch {} finally {
    inFlight.today = false;
  }
}

async function fetchWeekly(force = false) {
  if (inFlight.weekly) return;
  if (!force && weekly && Date.now() - lastFetched.weekly < TTL_MS) return;
  inFlight.weekly = true;
  try {
    const t = tz();
    const res = await api(`/api/weekly-review${t ? `?tz=${encodeURIComponent(t)}` : ''}`);
    if (res?.ok) {
      weekly = res;
      lastFetched.weekly = Date.now();
    }
  } catch {} finally {
    inFlight.weekly = false;
  }
}

async function fetchObservation(force = false) {
  if (inFlight.observation) return;
  if (!force && observation !== null && Date.now() - lastFetched.observation < TTL_MS) return;
  inFlight.observation = true;
  try {
    const res = await api('/api/observations/current');
    if (res?.ok) {
      observation = res.observation;
      lastFetched.observation = Date.now();
    }
  } catch {} finally {
    inFlight.observation = false;
  }
}

export function getSynthesis() {
  return {
    get today() { return today; },
    get weekly() { return weekly; },
    get observation() { return observation; },
    get isLoadingToday() { return inFlight.today; },
    get isLoadingWeekly() { return inFlight.weekly; },
    get isLoadingObservation() { return inFlight.observation; },
  };
}

export function refreshSynthesis() {
  fetchToday(true);
  fetchWeekly(true);
  fetchObservation(true);
}

export function refreshToday() { fetchToday(true); }
export function clearObservation() {
  observation = null;
  fetchObservation(true);
}

/**
 * Schedule prefetch for after the calendar has had a chance to render.
 * Uses requestIdleCallback when available (so we don't compete with first
 * paint), else a tame setTimeout. Idempotent — multiple callers all get
 * a single pending fetch.
 */
export function schedulePrefetch(delayMs = 1500) {
  if (prefetchScheduled) return;
  prefetchScheduled = true;
  const run = () => {
    fetchToday();
    fetchWeekly();
    fetchObservation();
  };
  if (typeof requestIdleCallback === 'function') {
    setTimeout(() => requestIdleCallback(run, { timeout: 4000 }), delayMs);
  } else {
    setTimeout(run, delayMs);
  }

  // Periodic refresh while the tab is visible.
  setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      fetchToday();
      fetchWeekly();
      fetchObservation();
    }
  }, TTL_MS);

  // Refresh on tab focus if the data is stale.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastFetched.today > TTL_MS) fetchToday();
        if (Date.now() - lastFetched.weekly > TTL_MS) fetchWeekly();
        if (Date.now() - lastFetched.observation > TTL_MS) fetchObservation();
      }
    });
  }
}
