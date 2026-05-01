<script>
  import { api } from '../api.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';
  import { tooltip } from '../actions/tooltip.js';

  let subs = $state([]);
  let name = $state('');
  let url = $state('');
  let color = $state('#3b82f6');
  let busy = $state(false);
  let error = $state('');

  async function load() {
    const r = await api('/api/subscriptions');
    if (r?.ok) subs = r.subscriptions;
  }
  load();

  async function add() {
    if (!name || !url) return;
    busy = true; error = '';
    const r = await api('/api/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ name, url, color }),
    });
    busy = false;
    if (r?.ok) {
      name = ''; url = '';
      load();
    } else {
      error = r?.error || 'Failed';
    }
  }

  async function refresh(id) {
    await api(`/api/subscriptions/${id}/refresh`, { method: 'POST' });
    load();
  }

  async function remove(id) {
    if (!await confirmAction({ title: 'Remove subscription?', confirmLabel: 'Remove', danger: true })) return;
    await api(`/api/subscriptions/${id}`, { method: 'DELETE' });
    load();
  }

  async function toggleVisible(s) {
    await api(`/api/subscriptions/${s.id}`, {
      method: 'PUT',
      body: JSON.stringify({ visible: !s.visible }),
    });
    load();
  }
</script>

<div class="subs-editor">
  <p class="hint">Subscribe to read-only ICS feeds (holidays, sports schedules, etc.). Refreshes every 6 hours.</p>

  {#each subs as s (s.id)}
    <div class="sub-row">
      <input type="checkbox" checked={s.visible} onchange={() => toggleVisible(s)} use:tooltip={'Show in calendar'} />
      <span class="sub-color" style="background: {s.color || '#3b82f6'}"></span>
      <div class="sub-info">
        <div class="sub-name">{s.name}</div>
        <div class="sub-meta">
          {#if s.lastError}<span class="err">{s.lastError}</span>
          {:else if s.lastFetchedAt}Last fetched {new Date(s.lastFetchedAt).toLocaleString()}
          {:else}Pending first fetch{/if}
        </div>
      </div>
      <button class="btn-sm" onclick={() => refresh(s.id)}>Refresh</button>
      <button class="btn-sm danger" onclick={() => remove(s.id)}>×</button>
    </div>
  {:else}
    <div class="empty">No subscriptions yet.</div>
  {/each}

  <div class="add-form">
    <input type="text" bind:value={name} placeholder="Name (e.g. US Holidays)" />
    <input type="url" bind:value={url} placeholder="https://… ics URL" />
    <input type="color" class="color-input" bind:value={color} use:tooltip={'Color'} />
    <button class="btn-primary" onclick={add} disabled={busy || !name || !url}>{busy ? 'Adding…' : 'Add'}</button>
  </div>
  {#if error}<div class="err">{error}</div>{/if}
</div>

<style>
  .subs-editor { display: flex; flex-direction: column; gap: 10px; }
  .hint { font-size: 12px; color: var(--text-secondary); margin: 0; }
  .sub-row {
    display: flex; align-items: center; gap: 10px;
    padding: 8px; border: 1px solid var(--border); border-radius: 6px;
  }
  .sub-color { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
  .sub-info { flex: 1; min-width: 0; }
  .sub-name { font-size: 13px; font-weight: 500; }
  .sub-meta { font-size: 11px; color: var(--text-tertiary); }
  .add-form { display: flex; gap: 8px; align-items: center; }
  .add-form input[type=text], .add-form input[type=url] {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-primary);
    font-size: 13px;
  }
  .add-form input[type=text]:focus, .add-form input[type=url]:focus {
    outline: none;
    border-color: var(--accent);
  }
  /* Native color input keeps its swatch surface but the chrome around it
     (border, padding) matches our other inputs. */
  .color-input {
    width: 32px; height: 32px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    cursor: pointer;
    flex-shrink: 0;
  }
  .color-input::-webkit-color-swatch-wrapper { padding: 0; }
  .color-input::-webkit-color-swatch { border: none; border-radius: 3px; }
  .color-input::-moz-color-swatch { border: none; border-radius: 3px; }
  .btn-primary {
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 500;
    border: 1px solid var(--accent);
    background: var(--accent);
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: white;
  }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
  .btn-sm {
    padding: 4px 10px;
    font-size: 12px;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-secondary);
  }
  .btn-sm:hover { background: var(--surface-hover); color: var(--text-primary); }
  .btn-sm.danger { color: var(--error); border-color: transparent; }
  .btn-sm.danger:hover { background: color-mix(in srgb, var(--error) 12%, transparent); }
  .empty { font-size: 12px; color: var(--text-tertiary); padding: 8px 0; }
  .err { color: var(--error); font-size: 12px; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
