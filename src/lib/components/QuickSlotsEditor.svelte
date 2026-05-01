<script>
  import { api } from '../api.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { tooltip } from '../actions/tooltip.js';

  const prefs = getPrefs();
  let slots = $state([]);
  let creating = $state(false);
  let title = $state('Meeting');
  let durationMin = $state(30);
  let slotDate = $state(new Date().toISOString().slice(0,10));
  let slotTimes = $state(['09:00', '10:00', '14:00']);
  let lastUrl = $state('');

  async function load() {
    const r = await api('/api/quick-slots');
    if (r?.ok) slots = r.slots;
  }
  load();

  async function create() {
    creating = true;
    const tz = prefs.values.primaryTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const slotsIso = slotTimes.filter(Boolean).map(t => {
      const [h, m] = t.split(':').map(Number);
      const d = new Date(`${slotDate}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`);
      return d.toISOString();
    });
    const r = await api('/api/quick-slots', {
      method: 'POST',
      body: JSON.stringify({ title, durationMin, slots: slotsIso, timezone: tz }),
    });
    creating = false;
    if (r?.ok) {
      lastUrl = `${window.location.origin}${r.url}`;
      load();
    }
  }

  function copyUrl(url) {
    navigator.clipboard.writeText(url);
  }

  async function remove(id) {
    if (!await confirmAction({ title: 'Delete slot link?', confirmLabel: 'Delete', danger: true })) return;
    await api(`/api/quick-slots/${id}`, { method: 'DELETE' });
    load();
  }

  function addTime() { slotTimes = [...slotTimes, '15:00']; }
  function removeTime(i) { slotTimes = slotTimes.filter((_, x) => x !== i); }
</script>

<div class="qs-editor">
  <p class="hint">Create a one-off booking link with specific times. Self-expiring, single-use. Different from full booking pages — no event types, no questions, just pick-a-slot.</p>

  <div class="form">
    <label>Title <input bind:value={title} /></label>
    <label>Duration (min) <input type="number" min="5" max="480" step="5" bind:value={durationMin} /></label>
    <label>Date <input type="date" bind:value={slotDate} /></label>
    <div class="times">
      <span class="lbl">Times</span>
      {#each slotTimes as t, i}
        <input type="time" bind:value={slotTimes[i]} />
        <button class="x" onclick={() => removeTime(i)} use:tooltip={'Remove time'} aria-label="Remove time">×</button>
      {/each}
      <button class="add" onclick={addTime}>+ time</button>
    </div>
    <div class="form-actions">
      <button class="btn-primary" onclick={create} disabled={creating}>{creating ? 'Creating…' : 'Create link'}</button>
    </div>
  </div>

  {#if lastUrl}
    <div class="last-url">
      <code>{lastUrl}</code>
      <button onclick={() => copyUrl(lastUrl)}>Copy</button>
    </div>
  {/if}

  {#if slots.length}
    <h4>Your links</h4>
    {#each slots as s (s.id)}
      <div class="slot-row">
        <div class="slot-info">
          <div class="slot-title">{s.title}</div>
          <div class="slot-meta">
            {s.slots.length} time{s.slots.length === 1 ? '' : 's'} · {s.durationMin}min
            {#if s.bookedByEmail}· <span class="booked">booked by {s.bookedByEmail}</span>{/if}
          </div>
        </div>
        <button class="btn-sm" onclick={() => copyUrl(`${window.location.origin}/q/${s.id}`)}>Copy URL</button>
        <button class="btn-sm danger" onclick={() => remove(s.id)}>×</button>
      </div>
    {/each}
  {/if}
</div>

<style>
  .qs-editor { display: flex; flex-direction: column; gap: 10px; }
  .hint { font-size: 12px; color: var(--text-secondary); margin: 0; }
  .form { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: 6px; }
  .form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); }
  .form input { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text-primary); font-size: 13px; }
  .times { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .times .lbl { font-size: 12px; color: var(--text-secondary); margin-right: 4px; }
  .times input { width: 110px; padding: 4px 8px; }
  .x {
    width: 22px; height: 22px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    color: var(--text-tertiary);
    font-size: 14px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: -4px;
  }
  .x:hover { background: color-mix(in srgb, var(--error) 14%, transparent); color: var(--error); }
  .add {
    padding: 4px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
  }
  .add:hover { background: var(--surface-hover); color: var(--text-primary); border-color: var(--accent); }
  .form-actions { display: flex; gap: 8px; }
  .btn-primary { padding: 6px 14px; background: var(--accent); color: white; border: none; border-radius: 6px; cursor: pointer; }
  .last-url { padding: 8px; background: var(--surface-hover); border-radius: 6px; display: flex; gap: 8px; align-items: center; }
  .last-url code { flex: 1; font-size: 12px; }
  .last-url button {
    padding: 4px 10px;
    font-size: 12px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .last-url button:hover { background: var(--surface-hover); color: var(--text-primary); }
  .slot-row { display: flex; align-items: center; gap: 10px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; }
  .slot-info { flex: 1; }
  .slot-title { font-size: 13px; font-weight: 500; }
  .slot-meta { font-size: 11px; color: var(--text-tertiary); }
  .booked { color: var(--accent); }
  .btn-sm { padding: 4px 10px; font-size: 12px; border: 1px solid var(--border); background: var(--bg); border-radius: 6px; cursor: pointer; color: var(--text-primary); }
  .btn-sm.danger { color: var(--error); border-color: var(--error); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
