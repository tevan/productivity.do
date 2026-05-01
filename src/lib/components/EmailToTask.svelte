<script>
  import { api } from '../api.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';

  let address = $state('');
  let configured = $state(false);
  let loading = $state(true);
  let copied = $state(false);

  async function load() {
    loading = true;
    try {
      const res = await api('/api/email-inbox/me');
      if (res?.ok) {
        address = res.address;
        configured = !!res.receiverConfigured;
      }
    } finally {
      loading = false;
    }
  }

  async function regenerate() {
    const ok = await confirmAction({
      title: 'Regenerate inbox address?',
      body: 'Mail forwarded to the old address will stop creating tasks.',
      confirmLabel: 'Regenerate',
      danger: true,
    });
    if (!ok) return;
    const res = await api('/api/email-inbox/regenerate', { method: 'POST' });
    if (res?.ok) address = res.address;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      copied = true;
      setTimeout(() => copied = false, 1500);
    } catch {}
  }

  $effect(() => { load(); });
</script>

{#if loading}
  <p class="hint">Loading…</p>
{:else}
  {#if !configured}
    <div class="warn">
      Mail receiver isn't provisioned yet. The address below is reserved for you, but mail to it won't deliver until we wire up the inbound provider.
    </div>
  {/if}
  <div class="addr-row">
    <input type="text" readonly value={address} onfocus={(e) => e.target.select()} />
    <button class="btn" type="button" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    <button class="btn btn-danger" type="button" onclick={regenerate}>Regenerate</button>
  </div>
  <p class="hint">Forward emails to this address (or use it as a reply-to) to create tasks. The subject becomes the task title; the body becomes the description.</p>
{/if}

<style>
  .hint { color: var(--text-tertiary); font-size: 12px; margin: 6px 0 0; }
  .warn {
    color: #92400e;
    background: #fef3c7;
    border: 1px solid #fde68a;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    margin-bottom: 8px;
  }
  :global(html.dark) .warn {
    color: #fde68a;
    background: #422006;
    border-color: #78350f;
  }
  .addr-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .addr-row input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 12px;
    font-family: var(--font-mono, monospace);
  }
  .btn {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-primary);
    font-size: 12px;
    cursor: pointer;
  }
  .btn:hover { background: var(--surface-hover); }
  .btn-danger {
    color: var(--error);
    border-color: var(--error);
  }
  .btn-danger:hover {
    background: var(--error);
    color: white;
  }
</style>
