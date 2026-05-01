<script>
  // AI provider connections + default selection.

  import { onMount } from 'svelte';
  import { api } from '../api.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';
  import Dropdown from './Dropdown.svelte';

  let providers = $state([]);
  let defaultProvider = $state(null);
  let loading = $state(true);
  let busy = $state(null);
  let keyInputs = $state({}); // provider -> input value

  async function load() {
    loading = true;
    try {
      const r = await api('/api/ai');
      providers = r.providers || [];
      defaultProvider = r.default || providers.find(p => p.connected)?.provider || null;
    } finally { loading = false; }
  }
  onMount(load);

  async function connect(p) {
    const key = (keyInputs[p.provider] || '').trim();
    if (!key) return;
    busy = p.provider;
    try {
      await api(`/api/ai/${p.provider}/connect`, {
        method: 'POST', body: JSON.stringify({ key }),
      });
      keyInputs[p.provider] = '';
      await load();
    } catch (e) { alert(e?.message || 'Connection failed'); }
    finally { busy = null; }
  }
  async function disconnect(p) {
    const ok = await confirmAction({
      title: `Disconnect ${p.name}?`,
      body: 'Your API key will be removed locally. Your account at the provider is untouched.',
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    busy = p.provider;
    try {
      await api(`/api/ai/${p.provider}`, { method: 'DELETE' });
      await load();
    } finally { busy = null; }
  }
  async function setModel(p, model) {
    await api(`/api/ai/${p.provider}/model`, {
      method: 'POST', body: JSON.stringify({ model }),
    });
    p.model = model;
  }
  async function setDefault(provider) {
    await api('/api/ai/default', { method: 'POST', body: JSON.stringify({ provider }) });
    defaultProvider = provider;
  }
</script>

<div class="ai">
  <p class="help-text">
    Connect an AI provider to power meeting prep summaries (and, eventually,
    natural-language event creation, task suggestions, and note Q&A).
    Connect more than one if you want different features to use different
    providers — pick a default below.
  </p>

  {#if loading}
    <div class="muted">Loading…</div>
  {:else}
    <div class="provider-list">
      {#each providers as p (p.provider)}
        <div class="provider-card" class:connected={p.connected}>
          <div class="provider-head">
            <div>
              <div class="provider-name">{p.name}</div>
              <div class="provider-desc">{p.description}</div>
            </div>
            {#if p.connected}
              <span class="status-pill">Connected</span>
            {/if}
          </div>

          {#if p.connected}
            <div class="provider-row">
              <label>Model</label>
              <Dropdown
                value={p.model}
                onchange={(v) => setModel(p, v)}
                options={p.models.map(m => ({ value: m.id, label: m.label }))}
              />
            </div>
            <div class="actions">
              {#if defaultProvider === p.provider}
                <span class="default-pill">Default</span>
              {:else}
                <button onclick={() => setDefault(p.provider)}>Set as default</button>
              {/if}
              <button class="danger" onclick={() => disconnect(p)} disabled={busy === p.provider}>Disconnect</button>
            </div>
          {:else}
            <div class="connect-row">
              <input type="password" placeholder="API key"
                bind:value={keyInputs[p.provider]}
                onkeydown={(e) => e.key === 'Enter' && connect(p)} />
              <button onclick={() => connect(p)} disabled={busy === p.provider || !keyInputs[p.provider]}>
                Connect
              </button>
              {#if p.docsUrl}
                <a href={p.docsUrl} target="_blank" rel="noopener" class="docs">Get a key</a>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .ai { display: flex; flex-direction: column; gap: 16px; }
  .help-text { font-size: 13px; color: var(--text-secondary); margin: 0; line-height: 1.5; }
  .muted { color: var(--text-tertiary); font-size: 13px; }
  .provider-list { display: flex; flex-direction: column; gap: 10px; }
  .provider-card {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 14px;
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .provider-card.connected { border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
  .provider-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .provider-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .provider-desc { font-size: 12px; color: var(--text-secondary); margin-top: 2px; max-width: 480px; }
  .status-pill {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 999px;
    color: #047857;
    background: color-mix(in srgb, #10b981 14%, transparent);
    border: 1px solid color-mix(in srgb, #10b981 28%, transparent);
  }
  :global(html.dark) .status-pill { color: #6ee7b7; }
  .default-pill {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 999px;
    color: var(--accent);
    background: var(--accent-light);
    border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
  }
  .provider-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
  }
  .provider-row label { color: var(--text-secondary); min-width: 50px; }
  .connect-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .connect-row input {
    flex: 1;
    min-width: 200px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 12px;
  }
  .actions { display: flex; gap: 6px; align-items: center; }
  .connect-row button, .actions button {
    padding: 5px 10px;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--radius-sm);
    font-size: 12px;
    cursor: pointer;
    color: var(--text-primary);
  }
  .actions button.danger { color: var(--error); }
  .actions button.danger:hover { background: color-mix(in srgb, var(--error) 12%, transparent); border-color: var(--error); }
  .actions button:disabled, .connect-row button:disabled { opacity: 0.5; cursor: not-allowed; }
  .docs { font-size: 11px; color: var(--text-tertiary); }
</style>
