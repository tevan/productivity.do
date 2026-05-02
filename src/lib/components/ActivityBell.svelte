<script>
  /*
   * Activity dropdown — what the user has changed recently. Distinct from
   * NotificationBell (which surfaces *incoming* events: bookings, integration
   * errors, etc.). This one shows the user's own actions: created event,
   * updated note, deleted task, etc.
   *
   * Backed by /api/activity which reads the `revisions` table. Restoring a
   * deleted resource still goes through each resource's restore endpoint —
   * we don't have a generic /api/activity/restore today.
   *
   * Click a row → jumps to the resource:
   *   - events  → setDate(start) and the calendar lands on that day
   *   - notes   → opens the NotesView with the note selected
   *   - tasks   → opens the TaskEditor for that task id
   *   - others  → no-op for now (booking pages, etc. don't yet have
   *               in-app deep links from the activity feed)
   */
  import { getContext } from 'svelte';
  import { api } from '../api.js';
  import { tooltip } from '../actions/tooltip.js';
  import { setDate } from '../stores/view.svelte.js';
  import { setAppView } from '../stores/appView.svelte.js';

  let items = $state([]);
  let open = $state(false);
  let loading = $state(false);
  // Anchor coordinates for the fixed-positioned dropdown. The bell lives in
  // the sidebar footer, which is inside .sidebar (overflow:hidden), so an
  // absolute-positioned dropdown gets clipped. Fixed-positioning escapes the
  // clip by being relative to the viewport.
  let anchor = $state({ left: 0, bottom: 0 });
  let triggerEl;

  // Allow callers (Toolbar, sidebar footer) to pass through any popover anchor
  // tweaks. Nothing today, but keep the prop slot open.
  let { } = $props();

  const appCtx = getContext('app');

  async function refresh() {
    loading = true;
    try {
      const res = await api('/api/activity?limit=30');
      if (res?.ok) items = res.items || [];
    } catch {
      items = [];
    } finally {
      loading = false;
    }
  }

  function updateAnchor() {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    anchor = {
      left: rect.left,
      bottom: window.innerHeight - rect.top, // distance from viewport bottom
    };
  }

  async function toggle() {
    open = !open;
    if (open) {
      updateAnchor();
      await refresh();
    }
  }

  function close() { open = false; }

  function fmtTime(iso) {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString();
  }

  function opVerb(op) {
    return {
      create: 'Created',
      update: 'Updated',
      delete: 'Deleted',
      soft_delete: 'Trashed',
      restore: 'Restored',
    }[op] || op;
  }
  function resourceLabel(res) {
    return {
      events: 'event',
      notes: 'note',
      tasks: 'task',
      booking_pages: 'booking page',
      event_templates: 'template',
      calendar_sets: 'calendar set',
    }[res] || res;
  }

  async function jumpTo(item) {
    close();
    if (item.resource === 'events') {
      // The activity row's `label` is just the title; we don't carry the
      // start time on the row. Pull it from the latest revision instead.
      try {
        const res = await api(`/api/activity/${item.id}/payload`);
        const start = res?.payload?.start;
        if (start) setDate(new Date(start));
      } catch {}
      setAppView('calendar');
      return;
    }
    if (item.resource === 'notes') {
      setAppView('notes');
      // The NotesView reads ?note= from URL; the SPA route store handles it.
      // Soft hand-off: we just switch view; user can pick the note from the list.
      return;
    }
    if (item.resource === 'tasks') {
      // Open the task editor via the app context. If the task has been hard-
      // deleted there's nothing to open; the activity row stays as a record.
      const fetched = await api(`/api/tasks/${item.resourceId}`).catch(() => null);
      if (fetched?.task && appCtx?.editTask) appCtx.editTask(fetched.task);
      return;
    }
    // Other resources: no deep link yet.
  }
</script>

<div class="bell-wrap">
  <button
    bind:this={triggerEl}
    class="icon-btn"
    onclick={toggle}
    use:tooltip={'Recent activity'}
    aria-label="Recent activity"
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M9 4v5l3 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.3"/>
    </svg>
  </button>

  {#if open}
    <div class="overlay" onclick={close} role="presentation"></div>
    <div class="dropdown" role="menu" style="left: {anchor.left}px; bottom: {anchor.bottom + 6}px;">
      <div class="dropdown-head">
        <span>Recent activity</span>
      </div>
      {#if loading && items.length === 0}
        <div class="empty">Loading…</div>
      {:else if items.length === 0}
        <div class="empty empty-state">
          <div class="empty-icon" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 12l2 2 4-4"/>
              <circle cx="12" cy="12" r="10"/>
            </svg>
          </div>
          <div class="empty-title">No recent changes</div>
          <div class="empty-sub">When you create, update, or delete something, it'll show up here so you can find your way back.</div>
        </div>
      {:else}
        {#each items as it (it.id)}
          <button class="row" onclick={() => jumpTo(it)} type="button">
            <div class="row-body">
              <div class="row-title">
                <span class="op op-{it.op}">{opVerb(it.op)}</span>
                <span class="resource">{resourceLabel(it.resource)}</span>
              </div>
              {#if it.label}<div class="row-text">{it.label}</div>{/if}
              <div class="row-meta">{fmtTime(it.createdAt)}</div>
            </div>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .bell-wrap { position: relative; }
  .icon-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .icon-btn:hover { background: var(--surface-hover); color: var(--text-primary); }

  .overlay { position: fixed; inset: 0; z-index: 90; }
  .bell-wrap:has(.dropdown) .icon-btn { position: relative; z-index: 95; }

  .dropdown {
    position: fixed;
    width: 340px;
    max-height: 440px;
    overflow-y: auto;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    z-index: 100;
  }
  .dropdown-head {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .empty { padding: 24px 12px; text-align: center; color: var(--text-tertiary); font-size: 13px; }
  .empty-state { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 32px 16px; }
  .empty-icon {
    width: 56px; height: 56px;
    border-radius: 50%;
    background: var(--surface-hover);
    display: flex; align-items: center; justify-content: center;
    color: var(--text-tertiary);
    margin-bottom: 4px;
  }
  .empty-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .empty-sub { font-size: 12px; color: var(--text-tertiary); line-height: 1.4; max-width: 240px; }

  .row {
    display: flex;
    width: 100%;
    text-align: left;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: none;
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
  }
  .row:last-child { border-bottom: none; }
  .row:hover { background: var(--surface-hover); }
  .row-body { flex: 1; min-width: 0; }
  .row-title {
    font-size: 12px;
    color: var(--text-secondary);
    display: flex; gap: 6px; align-items: baseline;
  }
  .op {
    font-weight: 600;
    color: var(--text-primary);
  }
  .op-delete, .op-soft_delete { color: var(--error, #c62828); }
  .op-create { color: var(--success, #15803d); }
  .resource { color: var(--text-tertiary); font-size: 11px; }
  .row-text {
    font-size: 13px;
    color: var(--text-primary);
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-meta { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
</style>
