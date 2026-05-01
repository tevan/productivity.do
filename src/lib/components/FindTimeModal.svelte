<script>
  import { api } from '../api.js';
  import { getCalendars } from '../stores/calendars.svelte.js';
  import Dropdown from './Dropdown.svelte';
  import { lowerAmPm } from '../utils/dates.js';

  let { onclose = () => {}, onpick = () => {} } = $props();

  const cals = getCalendars();
  let durationMin = $state(30);
  let daysAhead = $state(7);
  let selectedCalIds = $state(new Set(cals.items.filter(c => c.visible !== false).map(c => c.id)));
  let slots = $state([]);
  let loading = $state(false);
  let searched = $state(false);

  function toggleCal(id) {
    const next = new Set(selectedCalIds);
    next.has(id) ? next.delete(id) : next.add(id);
    selectedCalIds = next;
  }

  async function findSlots() {
    loading = true;
    searched = true;
    const notAfter = new Date(Date.now() + daysAhead * 86400000).toISOString();
    try {
      const res = await api('/api/events/find-time', {
        method: 'POST',
        body: JSON.stringify({
          durationMin: Number(durationMin) || 30,
          calendarIds: Array.from(selectedCalIds),
          notAfter,
          limit: 12,
        }),
      });
      if (res?.ok) slots = res.slots || [];
    } finally {
      loading = false;
    }
  }

  function pick(slot) {
    onpick({
      start: new Date(slot.startIso),
      end: new Date(slot.endIso),
    });
    onclose();
  }

  function fmtSlot(iso) {
    const d = new Date(iso);
    return lowerAmPm(d.toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }));
  }

  function handleKey(e) { if (e.key === 'Escape') onclose(); }
</script>

<svelte:window onkeydown={handleKey} />

<div class="ft-backdrop" onclick={onclose} role="presentation"></div>
<div class="ft-modal" role="dialog" aria-label="Find a time">
  <div class="ft-header">
    <h3>Find a time</h3>
    <button class="x" onclick={onclose} aria-label="Close">×</button>
  </div>

  <div class="ft-form">
    <label>
      Duration
      <Dropdown
        bind:value={durationMin}
        ariaLabel="Duration"
        options={[
          { value: 15, label: '15 min' },
          { value: 30, label: '30 min' },
          { value: 45, label: '45 min' },
          { value: 60, label: '1 hour' },
          { value: 90, label: '1.5 hours' },
          { value: 120, label: '2 hours' },
        ]}
      />
    </label>
    <label>
      Within
      <Dropdown
        bind:value={daysAhead}
        ariaLabel="Within"
        options={[
          { value: 1, label: '1 day' },
          { value: 3, label: '3 days' },
          { value: 7, label: '1 week' },
          { value: 14, label: '2 weeks' },
          { value: 30, label: '1 month' },
        ]}
      />
    </label>
  </div>

  <div class="ft-cals">
    <div class="lbl">Avoid conflicts on:</div>
    <div class="cal-chips">
      {#each cals.items as c (c.id)}
        <label class="chip" class:on={selectedCalIds.has(c.id)}>
          <input type="checkbox" checked={selectedCalIds.has(c.id)} onchange={() => toggleCal(c.id)} />
          <span class="dot" style="background: {c.colorHex || '#3b82f6'}"></span>
          {c.summary}
        </label>
      {/each}
    </div>
  </div>

  <button class="btn-primary" onclick={findSlots} disabled={loading || selectedCalIds.size === 0}>
    {loading ? 'Searching…' : 'Find slots'}
  </button>

  {#if searched && !loading}
    {#if slots.length === 0}
      <div class="empty">No free slots in the next {daysAhead} day{daysAhead === 1 ? '' : 's'}.</div>
    {:else}
      <ul class="slot-list">
        {#each slots as s}
          <li>
            <button class="slot" onclick={() => pick(s)}>
              {fmtSlot(s.startIso)}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .ft-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 999; }
  .ft-modal {
    position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
    width: 90%; max-width: 460px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    z-index: 1000;
    box-shadow: var(--shadow-lg);
    max-height: 80vh; overflow-y: auto;
  }
  .ft-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .ft-header h3 { margin: 0; font-size: 16px; }
  .x { background: none; border: none; font-size: 22px; cursor: pointer; color: var(--text-tertiary); }
  .ft-form { display: flex; gap: 12px; margin-bottom: 12px; }
  .ft-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); flex: 1; }
  .ft-form select { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text-primary); }
  .ft-cals { margin-bottom: 12px; }
  .lbl { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
  .cal-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border-radius: 999px;
    border: 1px solid var(--border); background: var(--bg);
    font-size: 12px; cursor: pointer; color: var(--text-primary);
  }
  .chip.on { background: var(--surface-hover); border-color: var(--accent); }
  .chip input { display: none; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .btn-primary {
    width: 100%; padding: 10px;
    background: var(--accent); color: white;
    border: none; border-radius: 8px;
    font-size: 14px; cursor: pointer;
    margin-bottom: 12px;
  }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .empty { font-size: 13px; color: var(--text-tertiary); padding: 12px 0; text-align: center; }
  .slot-list { list-style: none; padding: 0; margin: 0; max-height: 280px; overflow-y: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .slot {
    display: block; width: 100%; text-align: left;
    padding: 8px 12px; border-radius: 6px;
    border: 1px solid var(--border); background: var(--bg);
    color: var(--text-primary); cursor: pointer; font-size: 13px;
  }
  .slot:hover { border-color: var(--accent); background: var(--surface-hover); }
</style>
