<script>
  import { api } from '../api.js';
  import { tooltip } from '../actions/tooltip.js';

  let unread = $state(0);
  let items = $state([]);
  let open = $state(false);
  let loading = $state(false);
  let anchor = $state({ left: 0, bottom: 0 });
  let triggerEl;

  async function refresh() {
    try {
      const res = await api('/api/notifications');
      if (res?.ok) {
        unread = res.unread;
        items = res.notifications;
      }
    } catch {}
  }

  function updateAnchor() {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    anchor = {
      left: rect.left,
      bottom: window.innerHeight - rect.top,
    };
  }

  async function toggle() {
    open = !open;
    if (open) {
      updateAnchor();
      loading = true;
      await refresh();
      loading = false;
      // Mark all as read on open. Keeps the UI simple.
      if (unread > 0) {
        await api('/api/notifications/read', { method: 'POST' });
        unread = 0;
        items = items.map(n => ({ ...n, read: true }));
      }
    }
  }

  async function dismiss(id, event) {
    event.stopPropagation();
    await api(`/api/notifications/${id}`, { method: 'DELETE' });
    items = items.filter(n => n.id !== id);
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString();
  }

  // Poll every 60s while the page is open. Cheap query (single COUNT + SELECT 50).
  $effect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  });

  function close() { open = false; }
</script>

<div class="bell-wrap">
  <button
    bind:this={triggerEl}
    class="icon-btn"
    class:has-unread={unread > 0}
    onclick={toggle}
    use:tooltip={unread > 0 ? `${unread} new notification${unread === 1 ? '' : 's'}` : 'No new notifications'}
    aria-label="Notifications"
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M4 8a5 5 0 0110 0v3l1.5 2H2.5L4 11V8z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M7.5 15a1.5 1.5 0 003 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>
    {#if unread > 0}
      <span class="badge">{unread > 9 ? '9+' : unread}</span>
    {/if}
  </button>

  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="overlay" onclick={close}></div>
    <div class="dropdown" role="menu" style="left: {anchor.left}px; bottom: {anchor.bottom + 6}px;">
      <div class="dropdown-head">
        <span>Notifications</span>
      </div>
      {#if loading}
        <div class="empty">Loading…</div>
      {:else if items.length === 0}
        <div class="empty empty-state">
          <div class="empty-icon" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9"/>
              <path d="M10.3 21a1.94 1.94 0 003.4 0"/>
            </svg>
          </div>
          <div class="empty-title">You're all caught up</div>
          <div class="empty-sub">New activity from bookings, integrations, and reminders will land here.</div>
        </div>
      {:else}
        {#each items as n (n.id)}
          <div class="row" class:unread={!n.read}>
            <div class="row-body">
              <div class="row-title">{n.title}</div>
              {#if n.body}<div class="row-text">{n.body}</div>{/if}
              <div class="row-meta">{fmtTime(n.createdAt)}</div>
            </div>
            <button class="dismiss" onclick={(e) => dismiss(n.id, e)} use:tooltip={'Dismiss'}>×</button>
          </div>
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
  .badge {
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--error, #ef4444);
    color: white;
    font-size: 9px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 90;
  }
  /* When the dropdown is open, lift the bell button above the overlay so the
     pointer cursor and direct click still work on the bell itself. */
  .bell-wrap:has(.dropdown) .icon-btn {
    position: relative;
    z-index: 95;
  }
  .dropdown {
    position: fixed;
    width: 320px;
    max-height: 400px;
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
  .empty {
    padding: 24px 12px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 13px;
  }
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 32px 16px;
  }
  .empty-icon {
    width: 56px; height: 56px;
    border-radius: 50%;
    background: var(--surface-hover);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    margin-bottom: 4px;
  }
  .empty-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .empty-sub {
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.4;
    max-width: 220px;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }
  .row:last-child { border-bottom: none; }
  .row.unread { background: var(--accent-light); }
  .row-body { flex: 1; min-width: 0; }
  .row-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .row-text {
    font-size: 12px;
    color: var(--text-secondary);
    margin-top: 2px;
  }
  .row-meta {
    font-size: 11px;
    color: var(--text-tertiary);
    margin-top: 2px;
  }
  .dismiss {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 4px;
  }
  .dismiss:hover { color: var(--text-primary); }
</style>
