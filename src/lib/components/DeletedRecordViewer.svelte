<script>
  /*
   * Read-only viewer for a deleted resource. Used by the activity feed when
   * the user clicks a deleted task/event/etc. — those resources may have
   * been hard-deleted at the source (Todoist tasks, Google events) and have
   * nothing live to open.
   *
   * Pulls the revision's after-state JSON via /api/activity/:id/payload.
   * Renders a compact summary: title, key fields, when it happened. Banner
   * on top makes the deletion explicit. Where supported (booking_pages,
   * notes, etc. — anything in TRASH_TABLES), offers a "Restore" button
   * that calls /api/trash/restore.
   */
  import { onMount } from 'svelte';
  import { api } from '../api.js';
  import { showToast } from '../utils/toast.svelte.js';

  let { activityId, resource, resourceId, op, label, createdAt, onclose = () => {} } = $props();

  let payload = $state(null);
  let loading = $state(true);
  let restoring = $state(false);

  // Resources that support undelete via /api/trash/restore.
  const RESTORABLE = new Set([
    'notes', 'booking_pages', 'event_templates', 'calendar_sets',
    'events_native', 'tasks_native',
  ]);
  const isRestorable = RESTORABLE.has(resource) && (op === 'soft_delete' || op === 'delete');

  onMount(async () => {
    try {
      const res = await api(`/api/activity/${activityId}/payload`);
      payload = res?.payload || null;
    } catch {} finally {
      loading = false;
    }
  });

  async function restoreNow() {
    restoring = true;
    try {
      const res = await api('/api/trash/restore', {
        method: 'POST',
        body: JSON.stringify({ resource, id: resourceId }),
      });
      if (res?.ok) {
        showToast({ message: 'Restored', kind: 'success' });
        onclose();
        // Best-effort full reload signal — different stores own different
        // resources and we don't have a fan-out invalidator yet.
        window.dispatchEvent(new CustomEvent('productivity:resource-restored', {
          detail: { resource, id: resourceId },
        }));
      } else {
        showToast(res?.error || 'Could not restore', 'error');
      }
    } catch (e) {
      showToast(String(e?.message || e), 'error');
    } finally {
      restoring = false;
    }
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch { return ''; }
  }

  // Per-resource summary view of the payload. Keeps it terse — this is a
  // read-only tombstone, not a full editor.
  function summaryRows(res, p) {
    if (!p) return [];
    const rows = [];
    if (res === 'tasks') {
      if (p.content) rows.push(['Task', p.content]);
      if (p.description) rows.push(['Notes', p.description]);
      if (p.due_date || p.dueDate) rows.push(['Due', p.due_date || p.dueDate]);
      if (p.priority) rows.push(['Priority', String(p.priority)]);
      if (p.project_name || p.projectName) rows.push(['Project', p.project_name || p.projectName]);
    } else if (res === 'events') {
      if (p.summary) rows.push(['Title', p.summary]);
      if (p.start) rows.push(['Start', fmtTime(p.start)]);
      if (p.end) rows.push(['End', fmtTime(p.end)]);
      if (p.location) rows.push(['Location', p.location]);
      if (p.description) rows.push(['Description', p.description]);
    } else if (res === 'notes') {
      if (p.title) rows.push(['Title', p.title]);
      if (p.body) rows.push(['Body', p.body.slice(0, 600) + (p.body.length > 600 ? '…' : '')]);
    } else if (res === 'booking_pages') {
      if (p.name) rows.push(['Name', p.name]);
      if (p.slug) rows.push(['Slug', p.slug]);
    } else if (res === 'event_templates') {
      if (p.name) rows.push(['Name', p.name]);
      if (p.summary) rows.push(['Title', p.summary]);
    } else if (res === 'calendar_sets') {
      if (p.name) rows.push(['Name', p.name]);
    }
    return rows;
  }

  const rows = $derived(summaryRows(resource, payload));
  const opLabel = $derived({
    delete: 'Hard-deleted',
    soft_delete: 'Moved to trash',
    update: 'Update',
    create: 'Created',
    restore: 'Restored',
  }[op] || op);
</script>

<div class="dr-backdrop" onclick={onclose} role="presentation">
  <div class="dr-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="dr-title">
    <header class="dr-head">
      <div class="dr-head-meta">
        <span class="dr-status dr-status-{op}">{opLabel}</span>
        <span class="dr-resource">{resource.replace('_', ' ')}</span>
      </div>
      <button class="dr-close" onclick={onclose} aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </button>
    </header>

    {#if op === 'delete' || op === 'soft_delete'}
      <div class="dr-banner" class:permanent={op === 'delete'}>
        {#if op === 'delete'}
          This {resource.replace('_', ' ')} has been permanently deleted at the source. Showing the saved record.
        {:else}
          This {resource.replace('_', ' ')} is in the trash and can be restored.
        {/if}
      </div>
    {/if}

    <div class="dr-body">
      <h3 id="dr-title" class="dr-title">{label || '(no title)'}</h3>
      <p class="dr-when">{op === 'delete' ? 'Deleted' : op === 'soft_delete' ? 'Trashed' : opLabel} {fmtTime(createdAt)}</p>

      {#if loading}
        <div class="dr-loading">Loading record…</div>
      {:else if rows.length > 0}
        <dl class="dr-rows">
          {#each rows as [k, v]}
            <dt>{k}</dt>
            <dd>{v}</dd>
          {/each}
        </dl>
      {:else if !payload}
        <p class="dr-empty">No saved record for this change.</p>
      {/if}
    </div>

    <footer class="dr-foot">
      {#if isRestorable}
        <button class="dr-primary" onclick={restoreNow} disabled={restoring}>
          {restoring ? 'Restoring…' : 'Restore'}
        </button>
      {/if}
      <button class="dr-secondary" onclick={onclose}>Close</button>
    </footer>
  </div>
</div>

<style>
  .dr-backdrop {
    position: fixed;
    inset: 0;
    background: var(--scrim, rgba(0,0,0,0.22));
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    padding: 16px;
    animation: drFade var(--motion-soft, 220ms) ease both;
  }
  @keyframes drFade { from { opacity: 0; } to { opacity: 1; } }

  .dr-modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    width: 480px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    animation: drBloom var(--motion-soft, 220ms) cubic-bezier(.2,.7,.2,1) both;
  }
  @keyframes drBloom {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  .dr-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }
  .dr-head-meta { display: flex; gap: 10px; align-items: baseline; }
  .dr-status {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--hover);
    color: var(--text-secondary);
  }
  .dr-status-delete, .dr-status-soft_delete {
    background: color-mix(in srgb, var(--error, #c25e4d) 14%, transparent);
    color: var(--error, #c25e4d);
  }
  .dr-resource {
    font-size: 11px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .dr-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    width: 28px;
    height: 28px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .dr-close:hover { background: var(--hover); color: var(--text-primary); }

  .dr-banner {
    margin: 12px 16px 0;
    padding: 10px 12px;
    border-radius: var(--radius-md, 8px);
    background: color-mix(in srgb, var(--error, #c25e4d) 10%, transparent);
    color: var(--error, #c25e4d);
    font-size: 13px;
    line-height: 1.4;
  }
  .dr-banner.permanent {
    background: color-mix(in srgb, var(--error, #c25e4d) 14%, transparent);
  }

  .dr-body { padding: 16px; flex: 1; }
  .dr-title {
    margin: 0 0 4px;
    font-size: 16px;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.4;
  }
  .dr-when {
    margin: 0 0 14px;
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .dr-rows {
    margin: 0;
    display: grid;
    grid-template-columns: 100px 1fr;
    gap: 8px 14px;
    font-size: 13px;
  }
  .dr-rows dt {
    color: var(--text-tertiary);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding-top: 2px;
  }
  .dr-rows dd {
    margin: 0;
    color: var(--text-primary);
    word-break: break-word;
    white-space: pre-wrap;
  }
  .dr-loading, .dr-empty {
    color: var(--text-tertiary);
    font-size: 13px;
    margin: 0;
  }

  .dr-foot {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
  }
  .dr-primary, .dr-secondary {
    padding: 6px 14px;
    border-radius: var(--radius-sm, 6px);
    font-size: 13px;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-primary);
  }
  .dr-primary {
    background: var(--accent, #3b82f6);
    border-color: var(--accent, #3b82f6);
    color: white;
  }
  .dr-primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent, #3b82f6) 88%, black);
  }
  .dr-primary:disabled { opacity: 0.6; cursor: not-allowed; }
  .dr-secondary:hover { background: var(--hover); }
</style>
