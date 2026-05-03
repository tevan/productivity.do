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
let ledger = $state(null);
let recommendations = $state(null);
let lastFetched = $state({ today: 0, weekly: 0, observation: 0, ledger: 0, recommendations: 0 });
let inFlight = $state({ today: false, weekly: false, observation: false, ledger: false, recommendations: false });

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
    let mode = null;
    try {
      mode = typeof window !== 'undefined'
        ? window.localStorage.getItem('productivity_ranker_mode')
        : null;
    } catch {}
    const params = new URLSearchParams();
    if (t) params.set('tz', t);
    if (mode === 'pinned') params.set('mode', 'pinned');
    const qs = params.toString();
    const res = await api(`/api/today${qs ? `?${qs}` : ''}`);
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

async function fetchLedger(force = false) {
  if (inFlight.ledger) return;
  if (!force && ledger && Date.now() - lastFetched.ledger < TTL_MS) return;
  inFlight.ledger = true;
  try {
    const res = await api('/api/time-ledger');
    if (res?.ok) {
      ledger = res;
      lastFetched.ledger = Date.now();
    }
  } catch {} finally {
    inFlight.ledger = false;
  }
}

async function fetchRecommendations(force = false) {
  if (inFlight.recommendations) return;
  if (!force && recommendations && Date.now() - lastFetched.recommendations < TTL_MS) return;
  inFlight.recommendations = true;
  try {
    const t = tz();
    const res = await api(`/api/recommendations/now${t ? `?tz=${encodeURIComponent(t)}` : ''}`);
    if (res?.ok) {
      recommendations = res;
      lastFetched.recommendations = Date.now();
    }
  } catch {} finally {
    inFlight.recommendations = false;
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
    get ledger() { return ledger; },
    get recommendations() { return recommendations; },
    get isLoadingToday() { return inFlight.today; },
    get isLoadingWeekly() { return inFlight.weekly; },
    get isLoadingObservation() { return inFlight.observation; },
    get isLoadingLedger() { return inFlight.ledger; },
    get isLoadingRecommendations() { return inFlight.recommendations; },
  };
}

export function refreshSynthesis() {
  fetchToday(true);
  fetchWeekly(true);
  fetchObservation(true);
  fetchLedger(true);
  fetchRecommendations(true);
}

export function refreshToday() { fetchToday(true); }
export function refreshLedger() { fetchLedger(true); }
export function refreshRecommendations() { fetchRecommendations(true); }
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
    fetchLedger();
    fetchRecommendations();
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
      fetchLedger();
      fetchRecommendations();
    }
  }, TTL_MS);

  // Refresh on tab focus if the data is stale.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastFetched.today > TTL_MS) fetchToday();
        if (Date.now() - lastFetched.weekly > TTL_MS) fetchWeekly();
        if (Date.now() - lastFetched.observation > TTL_MS) fetchObservation();
        if (Date.now() - lastFetched.ledger > TTL_MS) fetchLedger();
        if (Date.now() - lastFetched.recommendations > TTL_MS) fetchRecommendations();
      }
    });
  }
}
