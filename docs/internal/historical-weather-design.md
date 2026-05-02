# Historical weather design (backlog)

> Authored 2026-05-02 in response to the user's request to populate the
> calendar with historical weather. Captures the design before it gets
> built so we can revisit with full context. **Not yet implemented.**

## The user's want

"Have a setting (Pro feature) to populate the calendar with historical
weather data, so I can see what the weather was like when I was
productive one week last October."

The motivation is correlational reflection — looking back at the
calendar weeks later and seeing weather as ambient context for what
happened.

## Why naive implementation is a problem

If we fetch the weather for every day the user navigates to in the past:

- An unbounded scroll back through 5 years of calendar = 1825 lookups
  per user.
- 1000 Pro users browsing back a year each = ~365k API calls/month.
- Open-Meteo's free archive API is ~10k requests/day (300k/mo) — close
  to the limit. Their paid tier starts at €29/mo for 1M.
- OpenWeatherMap History API is paid from request 1 ($0.0015/call after
  a 60-call free tier).

This is a "death by a thousand backfills" cost shape, not a feature
that sinks the company — but it's worth bounding before it grows.

## Design

Three architectural choices that bound cost:

### 1. Server-side cache, no TTL

Historical weather doesn't change. Once anyone fetches "what was the
weather in Salt Lake City on 2024-10-12", every other user gets the
same answer for free. New table:

```sql
CREATE TABLE weather_history (
  date TEXT NOT NULL,            -- YYYY-MM-DD
  lat REAL NOT NULL,             -- rounded to 2dp (~1km grid)
  lon REAL NOT NULL,             -- rounded to 2dp
  payload_json TEXT NOT NULL,    -- {tempHi, tempLo, precip, conditions}
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, lat, lon)
);
```

Lat/lon rounding to 2dp means SLC and Park City share rows, but
neighboring users in the same metro share too — net win. With ~50
metro areas covering 90% of users, the cache fills out fast.

### 2. Lazy fetch, not pre-fetch

Only fire the lookup when the user **navigates to a past date and the
calendar would render the weather**. Not pre-warmed on backfill.
Specifically:

- **Recent past** (≤90 days): SPA fetches automatically (`hideHistoricalWeather: false` default for Pro).
- **Older** (>90 days): SPA shows a "Load weather for this week" button
  that the user clicks. Discourages bulk scraping; gives the user
  agency over the cost.
- **Hard daily cap per user**: 100 historical lookups / day / user.
  Logged to a `historical_weather_usage` table so we can tune.

### 3. Provider abstraction with kill switch

Environment flag picks the provider:
- `WEATHER_HISTORY_PROVIDER=open-meteo` (default; free tier sufficient)
- `WEATHER_HISTORY_PROVIDER=openweather` (paid; better quality)
- `WEATHER_HISTORY_PROVIDER=disabled` (kill switch)

Code path in `backend/lib/weatherHistory.js`:

```js
async function getHistoricalWeather(date, lat, lon) {
  const cached = readCache(date, lat, lon);
  if (cached) return cached;
  const provider = process.env.WEATHER_HISTORY_PROVIDER || 'open-meteo';
  if (provider === 'disabled') return null;
  const result = await fetchFromProvider(provider, date, lat, lon);
  writeCache(date, lat, lon, result);
  return result;
}
```

If costs blow up, set `WEATHER_HISTORY_PROVIDER=disabled` and the
feature gracefully degrades to "weather available for today only."

## Pro gate

This is a Pro feature. Add to `backend/config/plans.json`:

```json
{
  "free": { "limits": { "historicalWeather": false } },
  "pro":  { "limits": { "historicalWeather": true,
                        "historicalWeatherDailyCap": 100 } },
  "team": { "limits": { "historicalWeather": true,
                        "historicalWeatherDailyCap": 500 } }
}
```

Server enforces via `requireFeature('historicalWeather')` on the
endpoint; client respects the per-user daily cap returned by
`/api/billing/me`.

## API shape

Single endpoint:

```
GET /api/weather/history?date=YYYY-MM-DD&lat=N&lon=N
→ { ok: true, weather: { tempHi, tempLo, precip, conditions, providerCached: bool } }
→ { ok: true, weather: null }              when provider returns nothing
→ { ok: false, code: 'plan_required', ... } when not on Pro
→ { ok: false, error: 'daily cap reached' } when over per-user cap
```

`providerCached: true` when served from `weather_history`; lets the SPA
render slightly different ("from archive" vs "fresh"). Probably never
shown but useful for telemetry.

## When to build

**Defer until ~20 paying Pro users exist.** Until then:

- Cost modeling is speculative
- We don't know if real users actually use it (or if it's a
  founder-imagined need that doesn't materialize)
- Building it now competes with launch-critical work

The schema and endpoint stub take ~1 day; the UI integration takes
another ~1 day. Reserve those 2 days for the moment we have user data
to model against.

## Open questions for re-revisit

- **What location do we use?** The user has a primary location pref
  for current weather. Do we use the same for history, or per-event
  location (every meeting that has a location gets its weather)?
  Per-event is more useful but multiplies cost ~5x. Probably start
  with primary-location only and add per-event later.
- **Which fields?** High/low + conditions is the minimum. Humidity?
  Wind? Precipitation hours? More fields = more DB rows but ~free
  marginal on the provider call. Start minimal, expand later.
- **Refresh policy?** Truly never refresh? Or refresh weather older
  than 7 days from "now" once at year-end (some archives correct
  themselves a few days after the fact)? Probably never refresh; the
  user-perceived value is "ambient context," not "scientifically
  accurate."

## Where this fits in the philosophy

Day surface verbs are plan / capture / schedule. Historical weather
serves *reflect* — looking back at past days. That's a fourth verb we
haven't formally added but is implicit in the calendar's existence
(the calendar is a record AND a planner). Acceptable; flag in
`product-philosophy.md` if we end up shipping multiple "reflect" features.
