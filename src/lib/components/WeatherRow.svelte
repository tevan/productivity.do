<script>
  import { getWeather, ensureNarratives } from '../stores/weather.svelte.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { isSameDay, parseAllDayDate } from '../utils/dates.js';
  import { tooltip } from '../actions/tooltip.js';

  let { dates = [] } = $props();

  const weather = getWeather();
  const prefs = getPrefs();

  const isF = $derived(prefs.values.temperatureUnit === 'F');
  const display = $derived(prefs.values.weatherDisplay || 'highLow'); // 'highLow' | 'current' | 'both'

  // After hover triggers ensureNarratives(), give the API 3s to respond.
  // If still pending we drop the "Loading details…" sub so the tooltip
  // doesn't lie. If the narrative does eventually arrive (free-tier 429
  // backoff, slow network, whatever) the reactive `n` lookup picks it up
  // and the sub re-appears naturally.
  let narrativeTimeoutHit = $state(false);
  let narrativeTimer = null;
  function kickNarrativeFetch() {
    ensureNarratives();
    if (narrativeTimer || weather.narrativeLoaded) return;
    narrativeTimer = setTimeout(() => { narrativeTimeoutHit = true; }, 3000);
  }

  function getWeatherForDate(date) {
    return weather.forecasts.find(f => isSameDay(parseAllDayDate(f.date), date));
  }
  function getNarrativeForDate(date) {
    void weather.narrativeLoaded; // dependency
    return weather.narratives.find(n => isSameDay(parseAllDayDate(n.date), date));
  }

  function wmoToEmoji(code) {
    if (code === 0) return '☀️';
    if (code >= 1 && code <= 3) return '⛅';
    if (code >= 45 && code <= 48) return '🌫️';
    if (code >= 51 && code <= 67) return '🌧️';
    if (code >= 71 && code <= 77) return '🌨️';
    if (code >= 80 && code <= 82) return '🌦️';
    if (code >= 95 && code <= 99) return '⛈️';
    return '☀️';
  }

  function formatTemp(celsius) {
    if (isF) return Math.round(celsius * 9 / 5 + 32);
    return Math.round(celsius);
  }

  // Build the hover tooltip. Lazily kicks off the narrative fetch on first
  // hover so we don't burn API calls for users who never hover.
  // Tooltip composition decisions:
  //   - Skip the date — the user is already hovering on a column labeled
  //     with that day, so repeating "Friday May 1" is redundant noise.
  //   - Show the city/location on its own line so it's immediately clear
  //     *whose* weather this is (matters when traveling).
  //   - Title = high/low temps. The narrative sentence carries the prose.
  //   - On wider columns (Day view) the temps already render below the
  //     icon; the tooltip stays useful as the prose carrier even then.
  function tooltipFor(date) {
    const w = getWeatherForDate(date);
    if (!w) return null;
    const n = getNarrativeForDate(date);
    const loc = weather.narrativeLocation;
    const tempLine = `${formatTemp(w.tempMax)}° / ${formatTemp(w.tempMin)}°`;
    const title = loc ? `${loc} · ${tempLine}` : tempLine;
    if (n) return { title, sub: n.phrase };
    if (narrativeTimeoutHit) return { title };
    return { title, sub: 'Loading details…' };
  }
</script>

{#if prefs.values.showWeather}
  <div class="weather-row" onmouseenter={kickNarrativeFetch}>
    {#each dates as date, i}
      {@const w = getWeatherForDate(date)}
      {@const isToday = new Date().toDateString() === date.toDateString()}
      {@const showCurrent = (display === 'current' || display === 'both') && isToday && weather.current}
      {@const showHiLo = display !== 'current' && w}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="weather-cell" use:tooltip={{ text: tooltipFor(date), delay: 400 }}>
        {#if w}
          <span class="weather-icon">{wmoToEmoji(w.weatherCode)}</span>
          {#if showCurrent}
            <span class="weather-temp weather-now">{formatTemp(weather.current.temperature)}&deg;</span>
          {/if}
          {#if showHiLo && (display !== 'current')}
            <span class="weather-temp">{formatTemp(w.tempMax)}&deg;/{formatTemp(w.tempMin)}&deg;</span>
          {/if}
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .weather-row {
    display: flex;
    flex: 1;
    border-bottom: 1px solid var(--border-light);
    flex-shrink: 0;
  }

  .weather-cell {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 4px 0;
    min-width: 0;
  }

  .weather-icon {
    font-size: 14px;
  }

  .weather-temp {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .weather-now {
    color: var(--text-primary);
    font-weight: 600;
  }
</style>
