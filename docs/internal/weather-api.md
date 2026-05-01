# Weather provider

**Date:** 2026-04-30
**Status:** Tomorrow.io chosen; integration pending API key signup

## Decision

**Tomorrow.io** for narrative summaries and high-quality forecasts.
Open-Meteo stays as the fallback for daily high/low (no key, free, fast).

## Why Tomorrow.io over alternatives

| | Tomorrow.io | WeatherAPI.com | OpenWeather |
|---|---|---|---|
| Free tier | 500/day, 25/hr | 1M/month | 1k/day |
| Narrative output | Yes (codes + Insights endpoint) | Yes (`condition.text`) | No (codes only) |
| Hyper-local accuracy | Multi-source aggregation | Solid | Coarse |
| API design | Best — clean schema | Solid | Aging |
| Geographic coverage | Strong globally | Strong | US-leaning |
| Cost over free tier | $0.0001/call | $20/mo for 2M | $40/mo |

**Why not OpenWeather:** no native narrative output, would require
hand-rolling phrases from numeric codes — same problem as Open-Meteo.

**Why not WeatherAPI.com:** free tier is generous but narrative output
is per-hour `condition.text` (e.g., "Partly cloudy") rather than
day-summary phrases. We'd still need to derive "morning sun, afternoon
showers" from hourly data.

**Why Tomorrow.io won:** their `Insights` endpoint returns pre-written
day narratives. With ~1hr server-side caching, even 100 active users
hit only ~100 fetches/day — well inside the free 500/day.

## Architecture

### Providers

```
weather/
  providers/
    open-meteo.js   — daily high/low, current temp. No key needed.
    tomorrow-io.js  — daily narrative summary. Requires WEATHER_API_KEY.
```

Open-Meteo stays the default because it's free and returns enough for
the calendar header (icon + high/low). Tomorrow.io is layered on top
for the *hover tooltip narrative*. So:

- The 5-day weather row at the top of the calendar uses Open-Meteo.
- Hovering a day shows the Tomorrow.io narrative.

This means we only call Tomorrow.io when a user actually hovers,
keeping us well within the free tier.

### Caching

- **Server-side:** 1hr cache per `(lat, lon)` pair in `weather_cache`.
  Already exists for Open-Meteo.
- **Tomorrow.io rows:** add `narrative_json` column to `weather_cache`
  storing the daily narratives. Same 1hr TTL.
- **Hover delay:** set the tooltip delay to 400ms (longer than default
  200ms) so a user scanning past a day doesn't trigger an API call.

### Env vars

```
WEATHER_NARRATIVE_PROVIDER=tomorrow.io   # default; can be 'none'
WEATHER_API_KEY=...                       # Tomorrow.io key
```

If `WEATHER_NARRATIVE_PROVIDER` is `none` or no key, the hover tooltip
falls back to a basic phrase derived from the WMO weather code (e.g.,
"Mostly sunny, 72°/48°"). No 503s — graceful degradation.

## Data shape

Tomorrow.io's `forecast/daily` returns this per day:

```json
{
  "time": "2026-05-01T00:00:00Z",
  "values": {
    "temperatureMax": 22,
    "temperatureMin": 8,
    "weatherCodeMax": 1100,
    "humidityAvg": 45,
    "precipitationProbabilityAvg": 20,
    "windSpeedMax": 18,
    "sunriseTime": "...",
    "sunsetTime": "..."
  }
}
```

We turn this into a 10-word summary in our backend (so we can A/B
phrasing without redeploying frontends):

> "Mostly clear, breezy afternoon. Cool morning, warm by 3 PM."

If the user has `weatherDisplay = 'narrative'` (a future pref), the
narrative shows always. Otherwise it's tooltip-only.

## What we considered and rejected

### Rolling our own from Open-Meteo hourly codes

Bucket morning/afternoon/evening, pick dominant WMO code per bucket,
map to phrases. Fast, free, deterministic — but the phrases come out
robotic ("morning code 2, afternoon code 61"). Tomorrow.io's narratives
read like a person wrote them.

### Anthropic API for summaries

Feed Open-Meteo data to Claude Haiku for a narrative. Quality would be
excellent, but adds latency (~500–1500ms), variable cost, and a
dependency for what should be a simple data lookup. Reserved for
features where AI judgment matters (event prep). For weather, a
purpose-built API is the right tool.

### Apple WeatherKit

Best accuracy in the US, requires Apple Developer account ($99/yr) and
iOS-app-style entitlements. Doesn't fit a web app. Skip.

### National Weather Service / metno

Free, accurate, but US-only or Norway-only respectively. Doesn't work
for our international users.

## Scale: location bucketing (in back pocket)

**Status:** not implemented; documented here for when we need it.

The cache today keys on raw `(lat, lon)` per user. With N unique
locations, we make up to N upstream calls/hour:

| Users | Unique locations (typical) | Calls/day | Free tier (500/day) |
|---|---|---|---|
| 100 | 30–50 | 720–1200 | exceeded |
| 1,000 | 100–200 | 2,400–4,800 | exceeded |
| 10,000 | 500–1,000 | 12,000–24,000 | exceeded |

The free tier is a soft ceiling: when we exceed it, **calls return 429 and
narrative tooltips silently fall back to "Loading details…" (and stay
that way until the next hour resets the quota)**. Billing doesn't escalate
because we never moved off the free tier — narratives just stop working
for some users.

### When to implement bucketing

Implement when we see real users hitting 429s (logged via the existing
error path in `/api/weather/narrative`). Don't pre-optimize.

### How bucketing would work

Round each user's `(lat, lon)` to a coarse grid before the cache lookup:

```js
function bucket(lat, lon) {
  // 0.25° ≈ 28km at the equator. Two users in the same metro share a row.
  return [Math.round(parseFloat(lat) * 4) / 4, Math.round(parseFloat(lon) * 4) / 4];
}
```

Then key the cache on the bucket, not the raw coords. Salt Lake City
(40.76, -111.89) and Sandy (40.57, -111.85) both bucket to (40.75,
-111.75) — one upstream call covers both.

Tradeoff: **less accurate**. A user in a microclimate (Pacifica vs San
Francisco, separated by ~10mi but very different fog/wind) sees the
nearest city's weather instead of theirs. For a scheduling app's
"morning sun, afternoon showers" tooltip, this is fine — most users
don't care that it's 2°F cooler at their actual address. For a weather
app, it'd be unacceptable.

### Other levers (also in back pocket)

- **Demand-driven refresh** — already in place via 1h TTL. Stale cache
  is only refilled when someone hits the endpoint.
- **City ID instead of lat/lon** — reverse-geocode at signup, cache by
  city id. Semantically cleaner buckets than a fixed grid.
- **Daily batch for top-N cities** — fetch top 200 cities once at 6am,
  on-demand for the long tail.
- **Switch to WeatherAPI.com** — 1M calls/month free, enough for ~1,300
  locations refreshed hourly without any bucketing. Drop-in swap if
  Tomorrow.io's narrative quality justifies the lift.

## Setup checklist (for when API key arrives)

1. Sign up at https://www.tomorrow.io/ (free tier)
2. Add `WEATHER_API_KEY=...` to `/srv/www/productivity.do/.env`
3. Restart pm2: `pm2 restart productivity`
4. Verify: hover a day in the weather row → narrative tooltip appears
5. Check `weather_cache.narrative_json` populates (1hr TTL)
