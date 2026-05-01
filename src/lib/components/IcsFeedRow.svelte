<script>
  import { api } from '../api.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';

  let httpUrl = $state('');
  let webcalUrl = $state('');
  let loading = $state(true);
  let error = $state('');
  let copied = $state(false);

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api('/api/ics/me');
      if (res?.ok) {
        httpUrl = res.httpUrl;
        webcalUrl = res.webcalUrl;
      } else {
        error = res?.error || 'Could not load subscription URL.';
      }
    } catch (err) {
      error = err.message || 'Could not load subscription URL.';
    } finally {
      loading = false;
    }
  }

  async function regenerate() {
    const ok = await confirmAction({
      title: 'Regenerate subscription URL?',
      body: 'The current URL will stop working. Calendar apps that subscribed to it will lose access until you give them the new one.',
      confirmLabel: 'Regenerate',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await api('/api/ics/regenerate', { method: 'POST' });
      if (res?.ok) {
        httpUrl = res.httpUrl;
        webcalUrl = res.webcalUrl;
      } else {
        error = res?.error || 'Regenerate failed.';
      }
    } catch (err) {
      error = err.message || 'Regenerate failed.';
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(httpUrl);
      copied = true;
      setTimeout(() => copied = false, 1500);
    } catch {}
  }

  $effect(() => { load(); });
</script>

{#if loading}
  <div class="hint">Loading…</div>
{:else if error}
  <div class="hint err">{error}</div>
{:else}
  <div class="ics-row">
    <input class="ics-input" type="text" readonly value={httpUrl} onfocus={(e) => e.target.select()} />
    <button class="ics-btn" type="button" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    <a class="ics-btn" href={webcalUrl}>Subscribe</a>
    <button class="ics-btn ics-btn-danger" type="button" onclick={regenerate}>Regenerate</button>
  </div>
{/if}

<style>
  .ics-row {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .ics-input {
    flex: 1;
    min-width: 280px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 12px;
    font-family: var(--font-mono, monospace);
  }
  .ics-btn {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }
  .ics-btn:hover { background: var(--surface-hover); }
  .ics-btn-danger {
    color: var(--error);
    border-color: var(--error);
  }
  .ics-btn-danger:hover {
    background: var(--error);
    color: white;
  }
  .hint { font-size: 12px; color: var(--text-tertiary); }
  .hint.err { color: var(--error); }
</style>
