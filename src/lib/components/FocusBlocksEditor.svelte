<script>
  import { api } from '../api.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';
  import Dropdown from './Dropdown.svelte';

  let blocks = $state([]);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');

  // Draft for new block
  let draft = $state({ label: 'Focus', weekday: 1, startTime: '09:00', endTime: '11:00' });

  const DAYS = [
    { v: 1, l: 'Mon' }, { v: 2, l: 'Tue' }, { v: 3, l: 'Wed' },
    { v: 4, l: 'Thu' }, { v: 5, l: 'Fri' }, { v: 6, l: 'Sat' }, { v: 0, l: 'Sun' },
  ];

  async function load() {
    loading = true;
    try {
      const res = await api('/api/focus-blocks');
      if (res?.ok) blocks = res.blocks;
    } finally {
      loading = false;
    }
  }

  async function add() {
    busy = true;
    error = '';
    try {
      const res = await api('/api/focus-blocks', {
        method: 'POST',
        body: JSON.stringify(draft),
      });
      if (res?.ok) {
        blocks = [...blocks, res.block].sort((a, b) =>
          a.weekday - b.weekday || a.startTime.localeCompare(b.startTime),
        );
        draft = { ...draft, label: 'Focus' };
      } else {
        error = res?.error || 'Could not save.';
      }
    } finally {
      busy = false;
    }
  }

  async function remove(b) {
    const ok = await confirmAction({
      title: 'Delete focus block?',
      body: `${dayLabel(b.weekday)} ${b.startTime}–${b.endTime} will be removed.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await api(`/api/focus-blocks/${b.id}`, { method: 'DELETE' });
    blocks = blocks.filter(x => x.id !== b.id);
  }

  function dayLabel(w) {
    return DAYS.find(d => d.v === w)?.l || `Day ${w}`;
  }

  $effect(() => { load(); });
</script>

{#if loading}
  <p class="hint">Loading…</p>
{:else}
  {#if blocks.length > 0}
    <ul class="block-list">
      {#each blocks as b (b.id)}
        <li>
          <span class="day">{dayLabel(b.weekday)}</span>
          <span class="time">{b.startTime}–{b.endTime}</span>
          <span class="label">{b.label}</span>
          <button class="remove" onclick={() => remove(b)} aria-label="Remove">×</button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="add-row">
    <div class="weekday-dd">
      <Dropdown
        bind:value={draft.weekday}
        ariaLabel="Weekday"
        options={DAYS.map(d => ({ value: d.v, label: d.l }))}
      />
    </div>
    <input type="time" bind:value={draft.startTime} />
    <span class="sep">–</span>
    <input type="time" bind:value={draft.endTime} />
    <input type="text" class="label-input" bind:value={draft.label} placeholder="Label" />
    <button class="primary-btn" onclick={add} disabled={busy}>Add</button>
  </div>
  {#if error}<div class="err">{error}</div>{/if}
{/if}

<style>
  .hint { color: var(--text-tertiary); font-size: 13px; }
  .err { color: var(--error); font-size: 12px; padding: 6px 10px; background: color-mix(in srgb, var(--error) 12%, transparent); border-radius: var(--radius-sm); margin-top: 6px; }
  .block-list {
    list-style: none;
    padding: 0;
    margin: 0 0 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .block-list li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    font-size: 13px;
  }
  .day { min-width: 36px; font-weight: 600; color: var(--text-primary); }
  .time { font-family: var(--font-mono, monospace); color: var(--text-secondary); min-width: 110px; }
  .label { color: var(--text-secondary); flex: 1; }
  .remove {
    background: none; border: none; color: var(--text-tertiary);
    font-size: 16px; cursor: pointer; padding: 0 4px; line-height: 1;
  }
  .remove:hover { color: var(--error); }

  .add-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .weekday-dd { width: 130px; flex-shrink: 0; }
  .add-row select, .add-row input[type="time"], .label-input {
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 12px;
    font-family: inherit;
  }
  .label-input { flex: 1; min-width: 100px; }
  .sep { color: var(--text-tertiary); }
  .primary-btn {
    padding: 6px 14px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
