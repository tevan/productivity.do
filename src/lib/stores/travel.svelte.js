import { api } from '../api.js';

// Per-event travel-time blocks. Computed by walking the day's events sorted
// by start: when consecutive events have non-empty `location`s, we treat the
// earlier event's location as the origin and compute travel time for the
// later one. If GOOGLE_MAPS_API_KEY is unset on the server, durationMinutes
// returns null and we still render a "?" placeholder block (mode 'estimate').
//
// Cache: { eventId → { travelMinutes, originLabel } } so re-renders don't
// re-fetch. Keyed only on event id; if the user changes location we bust
// the cache via `invalidateTravelFor(eventId)`.

let blocks = $state({}); // { eventId: { minutes, originLabel } }
let computing = $state(false);

export function getTravelBlocks() {
  return {
    get items() { return blocks; },
    get computing() { return computing; },
  };
}

export function invalidateTravelFor(eventId) {
  if (blocks[eventId]) {
    delete blocks[eventId];
    blocks = { ...blocks };
  }
}

export function clearTravelBlocks() {
  blocks = {};
}

// Walk events for a given day, build travel pairs, fetch sequentially. We
// don't parallelize — Maps quota is per-second and this keeps the call rate
// well under 10/s even with a packed calendar.
export async function computeTravelForEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return;

  // Group by date (UTC day) so we only consider transitions within a day.
  const byDay = new Map();
  for (const ev of events) {
    if (ev.allDay || !ev.location || ev.eventType === 'workingLocation' || ev.eventType === 'outOfOffice') continue;
    const day = new Date(ev.start).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(ev);
  }

  computing = true;
  try {
    for (const [, dayEvents] of byDay) {
      dayEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
      for (let i = 1; i < dayEvents.length; i++) {
        const prev = dayEvents[i - 1];
        const curr = dayEvents[i];
        if (!prev.location || !curr.location || prev.location === curr.location) continue;
        if (blocks[curr.id]) continue; // already computed

        // If the gap between events is huge (>4h), skip — likely a non-trip lunch.
        const gapMin = (new Date(curr.start) - new Date(prev.end)) / 60000;
        if (gapMin > 240 || gapMin < 0) continue;

        const params = new URLSearchParams({
          origin: prev.location,
          destination: curr.location,
        });
        try {
          const res = await api(`/api/travel-time?${params}`);
          if (res?.ok) {
            blocks[curr.id] = {
              minutes: res.durationMinutes,  // may be null if Maps API not configured
              originLabel: prev.location,
            };
            blocks = { ...blocks };
          }
        } catch (e) {
          // Best-effort; don't block the UI on travel-time failures.
          console.warn('travel-time fetch failed:', e.message);
        }
      }
    }
  } finally {
    computing = false;
  }
}
