<script>
  import { getHourSlots } from '../utils/dates.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { tooltip } from '../actions/tooltip.js';

  let { timezone = '' } = $props();

  const prefs = getPrefs();
  const hours = getHourSlots();
  const is12h = $derived(prefs.values.timeFormat === '12h');

  // Short label: "America/New_York" → "New York"
  const label = $derived(timezone.split('/').pop().replace(/_/g, ' '));

  // Compute the actual time in the target timezone for each hour slot
  function formatHourInTz(hour) {
    try {
      // Create a date at this hour in the primary timezone
      const primary = prefs.values.primaryTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      // Get the time in the target timezone by converting from the primary timezone
      const refDate = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00`);
      // Get the primary timezone offset at this time
      const primaryTime = new Date(refDate.toLocaleString('en-US', { timeZone: primary }));
      const remoteTime = new Date(refDate.toLocaleString('en-US', { timeZone: timezone }));
      const diffMs = remoteTime - primaryTime;
      const totalMinutes = Math.round(diffMs / 60000);
      const adjustedMinutes = (hour * 60 + totalMinutes + 1440) % 1440;
      const h = Math.floor(adjustedMinutes / 60);
      const m = adjustedMinutes % 60;

      if (is12h) {
        const ampm = h >= 12 ? 'p' : 'a';
        const h12 = h % 12 || 12;
        return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
      }
      return m === 0 ? `${String(h).padStart(2, '0')}` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    } catch { return ''; }
  }
</script>

{#if timezone}
  <div class="tz-bar">
    <div class="tz-label" use:tooltip={timezone}>{label}</div>
    {#each hours as hour}
      <div class="tz-slot">
        {#if hour > 0}
          <span class="tz-hour">{formatHourInTz(hour)}</span>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .tz-bar {
    display: flex;
    flex-direction: column;
    width: 44px;
    flex-shrink: 0;
    border-right: 1px solid var(--border-light);
    position: relative;
  }

  .tz-label {
    font-size: 9px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-align: center;
    padding: 2px;
    border-bottom: 1px solid var(--border-light);
    background: var(--bg-secondary);
    position: sticky;
    top: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tz-slot {
    height: 48px;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    border-bottom: 1px solid var(--border-light);
  }

  .tz-hour {
    font-size: 9px;
    color: var(--text-tertiary);
    transform: translateY(-6px);
    white-space: nowrap;
  }
</style>
