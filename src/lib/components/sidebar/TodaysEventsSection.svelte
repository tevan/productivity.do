<script>
  // "Today's events" sidebar section for the Tasks and Notes holistic views.
  // The active view's primary domain is in the main pane; this is the
  // cross-domain peek so users can see their day without context-switching.
  // See docs/internal/holistic-views.md § "Sidebar by view".

  import { getContext } from 'svelte';
  import { getEvents } from '../../stores/events.svelte.js';
  import { getCalendars } from '../../stores/calendars.svelte.js';
  import { getPrefs } from '../../stores/prefs.svelte.js';
  import { isSameDay, parseAllDayDate } from '../../utils/dates.js';
  import { tooltip } from '../../actions/tooltip.js';

  const eventsStore = getEvents();
  const cals = getCalendars();
  const prefs = getPrefs();
  const app = getContext('app');

  const today = new Date();
  const is12h = $derived(prefs.values.timeFormat !== '24h');

  // Today's events, filtered to visible calendars and sorted by start time.
  // All-day events first, then timed events ascending.
  const todaysEvents = $derived.by(() => {
    const visible = new Set(cals.items.filter(c => c.visible !== false).map(c => c.id));
    const out = eventsStore.items.filter(ev => {
      if (visible.size && !visible.has(ev.calendarId)) return false;
      // Skip declined events when prefs hide them (matches calendar view).
      if (prefs.values.showDeclinedEvents === false) {
        const me = ev.attendees?.find(a => a.self);
        if (me?.responseStatus === 'declined') return false;
      }
      const start = ev.allDay ? parseAllDayDate(ev.start) : new Date(ev.start);
      return isSameDay(start, today);
    });
    out.sort((a, b) => {
      if (a.allDay && !b.allDay) return -1;
      if (!a.allDay && b.allDay) return 1;
      return new Date(a.start) - new Date(b.start);
    });
    return out;
  });

  function formatTime(iso) {
    const d = new Date(iso);
    if (is12h) {
      let h = d.getHours();
      const m = d.getMinutes();
      const ampm = h >= 12 ? 'pm' : 'am';
      h = h % 12; if (h === 0) h = 12;
      return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, '0')}${ampm}`;
    }
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function calendarColor(ev) {
    const cal = cals.items.find(c => c.id === ev.calendarId);
    return cal?.color || cal?.backgroundColor || 'var(--accent)';
  }

  function open(ev) {
    app?.editEvent?.(ev);
  }
</script>

<div class="todays-events">
  <h4 class="section-h">
    Today's events
    {#if todaysEvents.length > 0}<span class="section-count">{todaysEvents.length}</span>{/if}
  </h4>
  {#if todaysEvents.length === 0}
    <p class="empty">Nothing scheduled today</p>
  {:else}
    <ul class="event-list">
      {#each todaysEvents as ev (ev.id)}
        <li
          class="event-row"
          onclick={() => open(ev)}
          onkeydown={(e) => e.key === 'Enter' && open(ev)}
          role="button"
          tabindex="0"
          use:tooltip={ev.summary || '(No title)'}
        >
          <span class="dot" style="background: {calendarColor(ev)};"></span>
          <span class="time">{ev.allDay ? 'All day' : formatTime(ev.start)}</span>
          <span class="title">{ev.summary || '(No title)'}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .todays-events { padding: 8px 12px 12px; border-bottom: 1px solid var(--border-light); }
  .section-h {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
    margin: 0 0 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .section-count {
    font-size: 10px;
    font-weight: 500;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .empty { font-size: 11px; color: var(--text-tertiary); margin: 0; }
  .event-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
  .event-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    min-width: 0;
  }
  .event-row:hover { background: var(--surface-hover); }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .time {
    font-size: 11px;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    width: 50px;
    flex-shrink: 0;
  }
  .title {
    font-size: 12px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }
</style>
