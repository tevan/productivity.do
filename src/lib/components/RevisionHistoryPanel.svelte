<script>
  // Shared revision history surface — used by NoteEditor + TaskEditor.
  // Fetches `/api/{resource}/:id/revisions` on open, lists snapshots
  // newest-first, lets the user click a row to preview it inline and
  // restore.

  import { api } from '../api.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';

  // Props
  let { resource, id, onrestored = () => {}, onclose = () => {} } = $props();

  let revisions = $state([]);
  let loading = $state(true);
  let selected = $state(null);
  let busy = $state(false);
  let err = $state('');

  async function load() {
    loading = true; err = '';
    const r = await api(`/api/${resource}/${id}/revisions`);
    if (r?.ok) {
      revisions = r.revisions || [];
      if (revisions.length > 0) selected = revisions[0];
    } else {
      err = r?.error || 'Could not load history';
    }
    loading = false;
  }
  $effect(() => { load(); });

  async function restore(rev) {
    if (!await confirmAction({
      title: 'Restore this version?',
      body: `The current version will become the most recent edit. You can scroll back forward again right after.`,
      confirmLabel: 'Restore',
    })) return;
    busy = true;
    const r = await api(`/api/${resource}/${id}/revisions/${rev.id}/restore`, { method: 'POST' });
    busy = false;
    if (r?.ok) {
      onrestored(r);
      onclose();
    } else {
      err = r?.error || 'Could not restore';
    }
  }

  function relativeWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
    const sec = Math.round((Date.now() - d.getTime()) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
    if (sec < 86400 * 7) return `${Math.round(sec / 86400)}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function fullWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
    return d.toLocaleString();
  }
  const OP_LABELS = {
    create: 'Created',
    update: 'Edited',
    soft_delete: 'Moved to trash',
    delete: 'Deleted',
    restore: 'Restored',
  };

  // Best-effort preview of the chosen revision. Both notes and tasks
  // expose a `content`/`body`/`title` shape; we render whatever is there.
  function previewText(rev) {
    if (!rev) return '';
    const after = rev.after || rev.before;
    if (!after) return '(no snapshot)';
    if (resource === 'notes') {
      const head = after.title ? `# ${after.title}\n\n` : '';
      return head + (after.body || '');
    }
    if (resource === 'tasks') {
      const lines = [`${after.content || '(no content)'}`];
      if (after.priority) lines.push(`Priority: ${after.priority}`);
      if (after.dueDatetime) lines.push(`Due: ${after.dueDatetime}`);
      else if (after.dueDate) lines.push(`Due: ${after.dueDate}`);
      if (after.estimatedMinutes) lines.push(`Est: ${after.estimatedMinutes}m`);
      if (after.localStatus) lines.push(`Column: ${after.localStatus}`);
      return lines.join('\n');
    }
    return JSON.stringify(after, null, 2);
  }
</script>

<div class="rev-panel">
  <header class="rev-head">
    <h4>Version history</h4>
    <button class="close-btn" onclick={onclose} aria-label="Close history">×</button>
  </header>

  {#if loading}
    <div class="rev-empty">Loading…</div>
  {:else if err}
    <div class="rev-empty err">{err}</div>
  {:else if revisions.length === 0}
    <div class="rev-empty">No history yet — it'll appear after the next edit.</div>
  {:else}
    <div class="rev-body">
      <ul class="rev-list">
        {#each revisions as rev (rev.id)}
          <li class="rev-row" class:active={selected?.id === rev.id}>
            <button class="rev-select" onclick={() => selected = rev}>
              <span class="when" title={fullWhen(rev.createdAt)}>{relativeWhen(rev.createdAt)}</span>
              <span class="op">{OP_LABELS[rev.op] || rev.op}</span>
            </button>
          </li>
        {/each}
      </ul>
      <div class="rev-preview">
        {#if selected}
          <div class="preview-meta">
            <span class="op">{OP_LABELS[selected.op] || selected.op}</span>
            <span class="when">{fullWhen(selected.createdAt)}</span>
          </div>
          <pre class="preview-text">{previewText(selected)}</pre>
          {#if selected.after}
            <button class="restore-btn" onclick={() => restore(selected)} disabled={busy}>
              Restore this version
            </button>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .rev-panel {
    position: absolute; inset: 0;
    background: var(--surface);
    display: flex; flex-direction: column;
    z-index: 5;
  }
  .rev-head {
    display: flex; justify-content: space-between; align-items: center;
    padding: 14px 18px; border-bottom: 1px solid var(--border);
  }
  .rev-head h4 { margin: 0; font-size: 14px; font-weight: 600; }
  .close-btn {
    background: none; border: none; cursor: pointer;
    font-size: 22px; line-height: 1; color: var(--text-tertiary);
    padding: 0 8px;
  }
  .close-btn:hover { color: var(--text-primary); }
  .rev-empty { padding: 24px; color: var(--text-tertiary); font-size: 13px; }
  .rev-empty.err { color: var(--error, #c62828); }
  .rev-body {
    flex: 1; display: flex; min-height: 0;
  }
  .rev-list {
    list-style: none; padding: 4px 0; margin: 0;
    width: 200px; flex-shrink: 0;
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }
  .rev-row { padding: 0; }
  .rev-select {
    width: 100%; text-align: left;
    background: none; border: none; cursor: pointer;
    padding: 8px 14px;
    display: flex; flex-direction: column; gap: 2px;
    color: var(--text-primary);
  }
  .rev-select:hover { background: var(--bg-secondary); }
  .rev-row.active .rev-select { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .rev-select .when { font-size: 12px; font-weight: 500; }
  .rev-select .op { font-size: 11px; color: var(--text-tertiary); }
  .rev-preview {
    flex: 1; padding: 16px 18px;
    display: flex; flex-direction: column; gap: 12px;
    overflow-y: auto; min-width: 0;
  }
  .preview-meta { display: flex; gap: 8px; align-items: baseline; font-size: 12px; }
  .preview-meta .op { font-weight: 600; color: var(--text-primary); }
  .preview-meta .when { color: var(--text-tertiary); }
  .preview-text {
    flex: 1;
    margin: 0;
    padding: 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: inherit; font-size: 13px; line-height: 1.55;
    white-space: pre-wrap; word-wrap: break-word;
    overflow: auto;
    max-height: 60vh;
  }
  .restore-btn {
    align-self: flex-start;
    padding: 6px 14px;
    font-size: 13px; cursor: pointer;
    background: var(--accent); color: white;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
  }
  .restore-btn:hover:not(:disabled) { filter: brightness(1.05); }
  .restore-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
