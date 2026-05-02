<script>
  import { getView, setView, setDate } from '../stores/view.svelte.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { getCalendars } from '../stores/calendars.svelte.js';
  import { getMonthGrid, isToday, isSameDay, getDayName } from '../utils/dates.js';
  import { getEventColor } from '../utils/colors.js';
  import WeatherRow from '../components/WeatherRow.svelte';
  import { tooltip } from '../../lib/actions/tooltip.js';

  let { events = [], onclickEvent = () => {} } = $props();

  const view = getView();
  const prefs = getPrefs();
  const cals = getCalendars();

  const grid = $derived(getMonthGrid(view.currentDate, prefs.values.weekStartDay || 'monday'));

  const weekdayHeaders = $derived.by(() => {
    if (!grid.length || !grid[0].length) return [];
    return grid[0].map(d => getDayName(d, true));
  });

  const MAX_EVENTS_PER_CELL = 3;

  function eventsForDate(date) {
    return events.filter(e => {
      const eStart = new Date(e.start);
      const eEnd = new Date(e.end);
      if (e.allDay) {
        return eStart <= date && eEnd >= date;
      }
      return isSameDay(eStart, date);
    });
  }

  function isCurrentMonth(date) {
    return date.getMonth() === view.currentDate.getMonth();
  }

  function jumpToDay(date) {
    setDate(date);
    setView('nextdays');
  }

  function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }
</script>

<div class="month-view">
  <!-- Header -->
  <div class="month-header" class:show-week-numbers={prefs.values.showWeekNumbers}>
    {#if prefs.values.showWeekNumbers}
      <div class="week-num-header">Wk</div>
    {/if}
    {#each weekdayHeaders as header}
      <div class="weekday-header">{header}</div>
    {/each}
  </div>

  <!-- Grid -->
  <div class="month-grid">
    {#each grid as week, weekIdx}
      <div class="month-row" class:show-week-numbers={prefs.values.showWeekNumbers}>
        {#if prefs.values.showWeekNumbers}
          <div class="week-num">{getWeekNumber(week[0])}</div>
        {/if}
        {#each week as day}
          {@const dayEvents = eventsForDate(day)}
          <div
            class="month-cell"
            class:today={isToday(day)}
            class:other-month={!isCurrentMonth(day)}
          >
            <button class="cell-date" class:today={isToday(day)} onclick={() => jumpToDay(day)}>
              {day.getDate()}
            </button>
            <div class="cell-events">
              {#each dayEvents.slice(0, MAX_EVENTS_PER_CELL) as event}
                {@const color = getEventColor(event, cals.items)}
                <div
                  class="month-event-bar"
                  role="button"
                  tabindex="0"
                  aria-label={`${event.summary || 'Untitled event'}. Press Enter to view.`}
                  style="background: var({color.varName}, {color.light});"
                  onclick={(e) => { e.stopPropagation(); onclickEvent(event, e); }}
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onclickEvent(event, e);
                    }
                  }}
                  use:tooltip={event.summary}
                >
                  {event.summary || '(No title)'}
                </div>
              {/each}
              {#if dayEvents.length > MAX_EVENTS_PER_CELL}
                <button class="more-chip" onclick={() => jumpToDay(day)}>
                  +{dayEvents.length - MAX_EVENTS_PER_CELL} more
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .month-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .month-header {
    display: flex;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    flex-shrink: 0;
  }
  .month-header.show-week-numbers { padding-left: 0; }

  .week-num-header {
    width: 36px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
  }

  .weekday-header {
    flex: 1;
    text-align: center;
    padding: 8px 0;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .month-grid {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .month-row {
    display: flex;
    flex: 1;
    border-bottom: 1px solid var(--border-light);
    min-height: 0;
  }

  .week-num {
    width: 36px;
    flex-shrink: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 6px;
    font-size: 10px;
    color: var(--text-tertiary);
    border-right: 1px solid var(--border-light);
  }

  .month-cell {
    flex: 1;
    border-right: 1px solid var(--border-light);
    padding: 2px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .month-cell:last-child { border-right: none; }
  .month-cell.other-month { opacity: 0.4; }
  .month-cell.today { background: color-mix(in srgb, var(--accent-light) 15%, transparent); }

  .cell-date {
    font-size: 12px;
    color: var(--text-primary);
    padding: 2px 4px;
    border: none;
    background: none;
    cursor: pointer;
    align-self: flex-end;
    border-radius: 50%;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .cell-date:hover { background: var(--surface-hover); }
  .cell-date.today {
    background: var(--accent);
    color: var(--text-inverse);
    font-weight: 600;
  }

  .cell-events {
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
    flex: 1;
  }

  .month-event-bar {
    padding: 1px 4px;
    border-radius: 2px;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    color: var(--text-primary);
  }
  .month-event-bar:hover { filter: brightness(0.95); }
  .month-event-bar:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .more-chip {
    font-size: 10px;
    color: var(--text-secondary);
    background: none;
    border: none;
    cursor: pointer;
    padding: 1px 4px;
    text-align: left;
  }
  .more-chip:hover { color: var(--accent); }
</style>
