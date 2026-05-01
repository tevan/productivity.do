<script>
  import { getMonthGrid, addMonths, isToday, isSameDay, getDayName } from '../utils/dates.js';
  import { setDate, getView } from '../stores/view.svelte.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { tooltip } from '../actions/tooltip.js';

  const view = getView();
  const prefs = getPrefs();

  let displayMonth = $state(new Date());

  const grid = $derived(getMonthGrid(displayMonth, prefs.values.weekStartDay || 'monday'));
  const monthLabel = $derived(
    displayMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  );

  const weekdayHeaders = $derived.by(() => {
    if (!grid.length || !grid[0].length) return [];
    return grid[0].map(d => getDayName(d, true).slice(0, 2));
  });

  function prevMonth() { displayMonth = addMonths(displayMonth, -1); }
  function nextMonth() { displayMonth = addMonths(displayMonth, 1); }
  function jumpToCurrent() {
    displayMonth = new Date();
    setDate(new Date());
  }

  function selectDay(date) {
    setDate(date);
  }

  function isCurrentMonth(date) {
    return date.getMonth() === displayMonth.getMonth();
  }
</script>

<div class="mini-cal">
  <div class="mini-cal-header">
    <button class="mini-nav" onclick={prevMonth}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M7.5 9L4.5 6L7.5 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
    </button>
    <button class="mini-month" onclick={jumpToCurrent} use:tooltip={'Jump to today'}>{monthLabel}</button>
    <button class="mini-nav" onclick={nextMonth}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
    </button>
  </div>

  <div class="mini-grid">
    {#each weekdayHeaders as header}
      <div class="mini-header-cell">{header}</div>
    {/each}
    {#each grid as week}
      {#each week as day}
        <button
          class="mini-day"
          class:today={isToday(day)}
          class:selected={isSameDay(day, view.currentDate)}
          class:other-month={!isCurrentMonth(day)}
          onclick={() => selectDay(day)}
        >
          {day.getDate()}
        </button>
      {/each}
    {/each}
  </div>
</div>

<style>
  .mini-cal {
    padding: 4px;
  }

  .mini-cal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .mini-month {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    background: none;
    border: none;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .mini-month:hover { background: var(--surface-hover); color: var(--accent); }

  .mini-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .mini-cal-header:hover .mini-nav { opacity: 1; }
  .mini-nav:hover { background: var(--surface-hover); color: var(--text-primary); }
  .mini-nav:focus-visible { opacity: 1; }

  .mini-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
  }

  .mini-header-cell {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-align: center;
    padding: 2px 0;
  }

  .mini-day {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    border-radius: 50%;
    font-size: 11px;
    color: var(--text-primary);
    cursor: pointer;
  }
  .mini-day:hover { background: var(--surface-hover); }
  .mini-day.other-month { color: var(--text-tertiary); }
  .mini-day.today {
    background: var(--accent);
    color: var(--text-inverse);
    font-weight: 600;
  }
  .mini-day.selected:not(.today) {
    background: var(--accent-light);
    color: var(--accent);
    font-weight: 600;
  }
</style>
