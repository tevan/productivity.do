<script>
  // Trash view: lists soft-deleted items across resources. Each row shows
  // the label + when it was deleted + when it'll auto-purge, plus
  // Restore + Delete-forever buttons. "Empty trash" purges everything
  // for this user immediately.

  import { api } from '../api.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';

  let items = $state([]);
  let loading = $state(true);
  let flash = $state('');
  let flashError = $state(false);
  function showFlash(msg, err = false) {
    flash = msg; flashError = err;
    setTimeout(() => { if (flash === msg) flash = ''; }, 2400);
  }

  const RESOURCE_LABELS = {
    notes: 'Note',
    booking_pages: 'Booking page',
    event_templates: 'Event template',
    calendar_sets: 'Calendar set',
  };

  async function load() {
    loading = true;
    const r = await api('/api/trash');
    items = r?.ok ? (r.items || []) : [];
    loading = false;
  }

  $effect(() => { load(); });

  async function restoreOne(item) {
    const r = await api('/api/trash/restore', {
      method: 'POST',
      body: JSON.stringify({ resource: item.resource, id: item.id }),
    });
    if (r?.ok) {
      showFlash(`Restored "${item.label}"`);
      await load();
    } else {
      showFlash(r?.error || 'Could not restore', true);
    }
  }

  async function purgeOne(item) {
    const ok = await confirmAction({
      title: 'Delete forever?',
      body: `"${item.label}" will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      danger: true,
    });
    if (!ok) return;
    const r = await api('/api/trash/purge', {
      method: 'POST',
      body: JSON.stringify({ resource: item.resource, id: item.id }),
    });
    if (r?.ok) {
      showFlash('Deleted');
      await load();
    } else {
      showFlash(r?.error || 'Could not delete', true);
    }
  }

  async function emptyAll() {
    if (items.length === 0) return;
    const ok = await confirmAction({
      title: 'Empty trash?',
      body: `${items.length} item${items.length === 1 ? '' : 's'} will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Empty trash',
      danger: true,
    });
    if (!ok) return;
    const r = await api('/api/trash/empty', { method: 'POST' });
    if (r?.ok) {
      showFlash(`Emptied ${r.purged} item${r.purged === 1 ? '' : 's'}`);
      await load();
    } else {
      showFlash(r?.error || 'Could not empty trash', true);
    }
  }

  function relativeWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const sec = Math.round(diffMs / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
    return `${Math.round(sec / 86400)}d ago`;
  }
  function daysUntil(iso) {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
  }
</script>

<div class="trash-tab">
  <div class="trash-header">
    <div>
      <h3>Trash</h3>
      <p class="trash-help">Deleted items are kept for 30 days, then permanently removed.</p>
    </div>
    {#if items.length > 0}
      <button class="empty-btn" onclick={emptyAll}>Empty trash</button>
    {/if}
  </div>

  {#if flash}
    <div class="flash" class:err={flashError}>{flash}</div>
  {/if}

  {#if loading}
    <div class="empty">Loading…</div>
  {:else if items.length === 0}
    <div class="empty">Trash is empty.</div>
  {:else}
    <ul class="trash-list">
      {#each items as item (item.resource + ':' + item.id)}
        <li class="trash-row">
          <div class="trash-meta">
            <span class="kind">{RESOURCE_LABELS[item.resource] || item.resource}</span>
            <span class="dot" aria-hidden="true">·</span>
            <span class="time" title={item.deletedAt}>deleted {relativeWhen(item.deletedAt)}</span>
            {#if item.purgeAt}
              <span class="dot" aria-hidden="true">·</span>
              <span class="purge-eta">auto-deletes in {daysUntil(item.purgeAt)}d</span>
            {/if}
          </div>
          <div class="trash-label">{item.label || '(untitled)'}</div>
          {#if item.preview}
            <div class="trash-preview">{item.preview}</div>
          {/if}
          <div class="trash-actions">
            <button class="restore-btn" onclick={() => restoreOne(item)}>Restore</button>
            <button class="forever-btn" onclick={() => purgeOne(item)}>Delete forever</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .trash-tab { padding: 4px 0; }
  .trash-header {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 16px; margin-bottom: 16px;
  }
  .trash-header h3 { margin: 0 0 4px; font-size: 16px; font-weight: 600; color: var(--text-primary); }
  .trash-help { margin: 0; font-size: 13px; color: var(--text-secondary); }
  .empty-btn {
    padding: 6px 14px; font-size: 13px; cursor: pointer;
    background: transparent; border: 1px solid var(--border);
    border-radius: var(--radius-sm); color: var(--text-secondary);
  }
  .empty-btn:hover { background: var(--bg-secondary); color: var(--text-primary); }
  .empty { padding: 24px 0; color: var(--text-tertiary); font-size: 13px; }
  .flash {
    margin: 0 0 12px;
    padding: 8px 12px;
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-secondary));
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    border-radius: var(--radius-sm);
    font-size: 13px; color: var(--accent);
  }
  .flash.err {
    background: color-mix(in srgb, var(--error, #c62828) 12%, var(--bg-secondary));
    border-color: color-mix(in srgb, var(--error, #c62828) 30%, var(--border));
    color: var(--error, #c62828);
  }
  .trash-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
  .trash-row {
    padding: 10px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .trash-meta {
    display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
    font-size: 11px; color: var(--text-tertiary); margin-bottom: 4px;
  }
  .kind { text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; color: var(--text-secondary); }
  .purge-eta { color: var(--error, #c62828); }
  .trash-label { font-size: 14px; font-weight: 500; color: var(--text-primary); }
  .trash-preview {
    font-size: 12px; color: var(--text-secondary); margin-top: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .trash-actions { margin-top: 8px; display: flex; gap: 8px; }
  .restore-btn, .forever-btn {
    padding: 4px 10px; font-size: 12px; cursor: pointer;
    background: transparent; border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .restore-btn { color: var(--accent); border-color: var(--accent); }
  .restore-btn:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .forever-btn { color: var(--error, #c62828); border-color: var(--error, #c62828); }
  .forever-btn:hover { background: color-mix(in srgb, var(--error, #c62828) 12%, transparent); }
</style>
