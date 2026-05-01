<script>
  // Bottom navigation bar — only rendered at mobile widths (<=640px).
  // Replaces the centered Calendar|Tasks|Notes pill in the toolbar so the
  // top bar can shed the controls that don't fit in 375px.
  //
  // The "More" tab opens a sheet with secondary actions (Settings, Search,
  // Help, View picker) to keep the top bar lean.

  import { getAppView, setAppView, getVisibleTabs } from '../stores/appView.svelte.js';
  import { getView, setView } from '../stores/view.svelte.js';
  import { getPrefs, updatePref } from '../stores/prefs.svelte.js';

  let { onsettings = () => {}, onsearch = () => {}, onhelp = () => {} } = $props();

  const appView = getAppView();
  const view = getView();
  const prefs = getPrefs();

  let sheetOpen = $state(false);

  function pick(v) {
    setAppView(v);
    sheetOpen = false;
  }

  function pickView(v) {
    setView(v);
    sheetOpen = false;
  }

  const VIEW_LABELS = { day: 'Day', nextdays: `${prefs.values.nextDaysCount || 5} days`, week: 'Week', month: 'Month' };
  const enabledViews = $derived(prefs.values.enabledViews || ['nextdays', 'week', 'month']);
  const visibleTabs = $derived(getVisibleTabs(prefs.values));
</script>

{#snippet tabIcon(id)}
  {#if id === 'calendar'}
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v3M16 3v3" stroke-linecap="round"/>
    </svg>
  {:else if id === 'tasks'}
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 12l3 3 5-6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  {:else if id === 'notes'}
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <path d="M5 3h10l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M15 3v4h4 M8 12h8M8 16h8M8 8h4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  {/if}
{/snippet}

<nav class="bottom-nav" aria-label="Workspace">
  {#each visibleTabs as tab (tab.id)}
    <button class="tab" class:active={appView.current === tab.id} onclick={() => pick(tab.id)} aria-label={tab.label}>
      {@render tabIcon(tab.id)}
      <span>{tab.label}</span>
    </button>
  {/each}
  <button class="tab" onclick={() => sheetOpen = true} aria-label="More">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>
    </svg>
    <span>More</span>
  </button>
</nav>

{#if sheetOpen}
  <div class="sheet-backdrop" onclick={() => sheetOpen = false} role="presentation"></div>
  <div class="sheet" role="dialog" aria-label="More">
    <div class="sheet-handle"></div>
    <div class="sheet-section">
      <h4>View</h4>
      <div class="view-grid">
        {#each ['day', 'nextdays', 'week', 'month'] as id}
          {#if enabledViews.includes(id)}
            <button class="view-chip" class:active={view.currentView === id} onclick={() => pickView(id)}>
              {VIEW_LABELS[id]}
            </button>
          {/if}
        {/each}
      </div>
    </div>
    <div class="sheet-section">
      <h4>Actions</h4>
      <button class="sheet-row" onclick={() => { sheetOpen = false; onsearch(); }}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.4"/><path d="M12 12L15.5 15.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        Search events
      </button>
      <button class="sheet-row" onclick={() => { sheetOpen = false; onsettings(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"/>
        </svg>
        Settings
      </button>
      <button class="sheet-row" onclick={() => { sheetOpen = false; onhelp(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.5M12 17h.01" stroke-linecap="round"/>
        </svg>
        Keyboard shortcuts
      </button>
    </div>
  </div>
{/if}

<style>
  .bottom-nav {
    display: none; /* visible only at mobile widths (see media query) */
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 56px;
    background: var(--surface);
    border-top: 1px solid var(--border);
    z-index: 100;
    /* iOS safe-area: keep tabs above the home indicator. */
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  .tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 10px;
    font-weight: 500;
    padding: 6px 4px;
    min-height: 44px;
  }
  .tab.active { color: var(--accent); }
  .tab svg { display: block; }

  .sheet-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 200;
  }
  .sheet {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--surface);
    border-top-left-radius: 16px;
    border-top-right-radius: 16px;
    z-index: 201;
    padding: 8px 16px env(safe-area-inset-bottom, 16px);
    box-shadow: 0 -8px 24px rgba(0,0,0,0.18);
    max-height: 70vh;
    overflow: auto;
  }
  .sheet-handle {
    width: 36px;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    margin: 8px auto 12px;
  }
  .sheet-section { margin-bottom: 16px; }
  .sheet-section h4 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
    margin: 0 0 6px;
  }
  .view-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
  .view-chip {
    padding: 10px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-primary);
    font-size: 13px;
    cursor: pointer;
  }
  .view-chip.active {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-light);
  }
  .sheet-row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 8px;
    border: none;
    background: none;
    color: var(--text-primary);
    font-size: 14px;
    cursor: pointer;
    text-align: left;
    border-radius: var(--radius-sm);
  }
  .sheet-row:hover { background: var(--surface-hover); }
  .sheet-row svg { color: var(--text-tertiary); flex-shrink: 0; }

  @media (max-width: 768px) {
    .bottom-nav { display: flex; }
  }
</style>
