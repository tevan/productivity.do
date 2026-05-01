import { api } from '../api.js';
import { getPrefs } from './prefs.svelte.js';

let forecasts = $state([]);
let current = $state(null);
let narratives = $state([]); // [{ date, phrase, high, low, precip, wind, code }]
let narrativeLoaded = $state(false);
let narrativeLocation = $state(''); // friendly name returned with narratives

export function getWeather() {
  return {
    get forecasts() { return forecasts; },
    get current() { return current; },
    get narratives() { return narratives; },
    get narrativeLoaded() { return narrativeLoaded; },
    get narrativeLocation() { return narrativeLocation; },
  };
}

export async function fetchWeather() {
  // Backend requires lat/lon; default to the prefs.weatherLocation (which
  // itself defaults to SLC). Without these the route returns 400.
  const prefs = getPrefs();
  const loc = prefs.values.weatherLocation || { lat: 40.76, lon: -111.89 };
  if (loc.lat == null || loc.lon == null) return;
  try {
    const params = new URLSearchParams({ lat: String(loc.lat), lon: String(loc.lon) });
    const res = await api(`/api/weather?${params}`);
    if (res.ok) {
      forecasts = res.forecast || res.forecasts || [];
      current = res.current || null;
    }
  } catch (e) {
    console.error('Failed to fetch weather:', e);
  }
  // Fetch narratives lazily — only when the user hovers a day. See
  // ensureNarratives() below.
}

// Tomorrow.io narratives. Lazy: triggered by the first hover so we don't
// burn API calls on users who never hover. Cached server-side for 1h on top
// of any client-side state.
let narrativeInFlight = null;
export async function ensureNarratives() {
  if (narrativeLoaded || narrativeInFlight) return narrativeInFlight;
  const prefs = getPrefs();
  const loc = prefs.values.weatherLocation || { lat: 40.76, lon: -111.89 };
  if (loc.lat == null || loc.lon == null) return;
  narrativeInFlight = (async () => {
    try {
      const params = new URLSearchParams({ lat: String(loc.lat), lon: String(loc.lon) });
      const res = await api(`/api/weather/narrative?${params}`);
      if (res?.ok) {
        narratives = res.days || [];
        narrativeLocation = res.locationName || '';
        narrativeLoaded = true;
      }
    } catch (e) {
      console.error('Failed to fetch weather narratives:', e);
    } finally {
      narrativeInFlight = null;
    }
  })();
  return narrativeInFlight;
}

// Reset narratives when the location changes so a fresh fetch happens.
export function resetNarratives() {
  narratives = [];
  narrativeLocation = '';
  narrativeLoaded = false;
}
