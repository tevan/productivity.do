<script>
  import { api } from '../api.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';

  let connected = $state(false);
  let perUser = $state(false);
  let loading = $state(true);
  let token = $state('');
  let busy = $state(false);
  let error = $state('');
  let saved = $state(false);

  async function load() {
    loading = true;
    try {
      const res = await api('/api/tasks/integration');
      if (res?.ok) {
        connected = !!res.todoist.connected;
        perUser = !!res.todoist.perUser;
      }
    } finally {
      loading = false;
    }
  }

  async function save() {
    busy = true;
    error = '';
    saved = false;
    try {
      const res = await api('/api/tasks/integration', {
        method: 'POST',
        body: JSON.stringify({ todoistToken: token.trim() }),
      });
      if (res?.ok) {
        token = '';
        saved = true;
        await load();
        setTimeout(() => saved = false, 2000);
      } else {
        error = res?.error || 'Could not save token.';
      }
    } catch (e) {
      error = e.message || 'Could not save token.';
    } finally {
      busy = false;
    }
  }

  async function disconnect() {
    const ok = await confirmAction({
      title: 'Disconnect Todoist?',
      body: 'Your tasks will stop syncing until you add a token again.',
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    busy = true;
    try {
      await api('/api/tasks/integration', { method: 'DELETE' });
      await load();
    } finally {
      busy = false;
    }
  }

  $effect(() => { load(); });
</script>

{#if loading}
  <p class="hint">Loading…</p>
{:else if perUser}
  <div class="status">
    <span class="dot ok"></span>
    <span>Connected with your token.</span>
    <button class="ghost-btn" onclick={disconnect} disabled={busy}>Disconnect</button>
  </div>
{:else if connected}
  <div class="status">
    <span class="dot warn"></span>
    <span>Using shared server token. Add your own to take over:</span>
  </div>
  <div class="token-row">
    <input type="password" bind:value={token} placeholder="Paste your Todoist API token" />
    <button class="primary-btn" onclick={save} disabled={busy || !token.trim()}>
      {busy ? 'Validating…' : 'Save'}
    </button>
  </div>
{:else}
  <div class="token-row">
    <input type="password" bind:value={token} placeholder="Paste your Todoist API token" />
    <button class="primary-btn" onclick={save} disabled={busy || !token.trim()}>
      {busy ? 'Validating…' : 'Connect'}
    </button>
  </div>
{/if}

{#if saved}<div class="hint ok">Saved.</div>{/if}
{#if error}<div class="err">{error}</div>{/if}

<style>
  .hint { font-size: 12px; color: var(--text-tertiary); }
  .hint.ok { color: var(--accent); }
  .err { color: var(--error); font-size: 12px; padding: 6px 10px; background: color-mix(in srgb, var(--error) 12%, transparent); border-radius: var(--radius-sm); margin-top: 6px; }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-primary);
    margin-bottom: 8px;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .dot.ok { background: #10b981; }
  .dot.warn { background: #f59e0b; }
  .token-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .token-row input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 12px;
    font-family: var(--font-mono, monospace);
  }
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
  .ghost-btn {
    padding: 5px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--text-primary);
    cursor: pointer;
  }
  .ghost-btn:hover { background: var(--surface-hover); }
</style>
