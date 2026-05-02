<script>
  import { getView, goToday, goNext, goPrev, setView } from '../stores/view.svelte.js';
  import { getAppView, setAppView, getVisibleTabs } from '../stores/appView.svelte.js';
  import { getPrefs, updatePref } from '../stores/prefs.svelte.js';
  import Dropdown from './Dropdown.svelte';
  import OfflineChip from './OfflineChip.svelte';
  import VoiceCapture from './VoiceCapture.svelte';
  import { tooltip } from '../actions/tooltip.js';
  import { getSynthesis } from '../stores/synthesis.svelte.js';

  // The synthesis icon shows a small dot when there's something worth a
  // glance — overdue tasks today, or a fresh observation. No number, no
  // animation; the dot just signals "there's something here." Press Y
  // (or click) to see what.
  const synth = getSynthesis();
  const synthHasSignal = $derived(
    (synth.today?.overdueCount ?? 0) > 0 ||
    (synth.today?.hero?.kind === 'overcommitted')
  );

  let { onsettings = () => {}, onhelp = () => {}, onnewEvent = () => {}, onnewTask = () => {}, onnewNote = () => {}, onsearch = () => {}, ontoday = () => {}, ongotoDate = () => {}, ontoggleSidebar = () => {}, sidebarHidden = false } = $props();

  const view = getView();
  const appView = getAppView();
  const prefs = getPrefs();

  // App-tab order + visibility comes from prefs.appTabs. Derived so tab
  // changes in Settings flip the toolbar live.
  const visibleTabs = $derived(getVisibleTabs(prefs.values));

  const ALL_VIEWS = [
    { id: 'day', label: 'Day', kbd: 'D' },
    { id: 'nextdays', getLabel: (p) => `${p.nextDaysCount || 5} days`, kbd: 'X' },
    { id: 'week', label: 'Week', kbd: 'W' },
    { id: 'month', label: 'Month', kbd: 'M' },
  ];

  const viewOptions = $derived.by(() => {
    const enabled = new Set(prefs.values.enabledViews || ['nextdays', 'week', 'month']);
    const list = ALL_VIEWS
      .filter(v => enabled.has(v.id))
      .map(v => ({ value: v.id, label: v.label || v.getLabel(prefs.values), kbd: v.kbd }));
    // Inline view-related toggles (Google Calendar pattern: weekend / declined / completed).
    return [
      { heading: 'View' },
      ...list,
      { divider: true },
      { heading: 'Display' },
      {
        toggle: true,
        label: 'Show weekends',
        checked: prefs.values.showWeekends !== false,
        onclick: () => updatePref('showWeekends', !(prefs.values.showWeekends !== false)),
      },
      {
        toggle: true,
        label: 'Show declined events',
        checked: !!prefs.values.showDeclinedEvents,
        onclick: () => updatePref('showDeclinedEvents', !prefs.values.showDeclinedEvents),
      },
      {
        toggle: true,
        label: 'Dim past events',
        checked: prefs.values.dimPastEvents !== false,
        onclick: () => updatePref('dimPastEvents', !(prefs.values.dimPastEvents !== false)),
      },
    ];
  });

  let newMenuOpen = $state(false);
  let newMenuEl = $state(null);
  function toggleNewMenu(e) {
    e.stopPropagation();
    newMenuOpen = !newMenuOpen;
  }
  function pickNew(kind) {
    newMenuOpen = false;
    if (kind === 'task') onnewTask();
    else if (kind === 'note') onnewNote();
    else onnewEvent();
  }
  function handleDocClick(e) {
    if (!newMenuOpen) return;
    if (newMenuEl && !newMenuEl.contains(e.target)) newMenuOpen = false;
  }
  $effect(() => {
    if (newMenuOpen) {
      document.addEventListener('mousedown', handleDocClick);
      return () => document.removeEventListener('mousedown', handleDocClick);
    }
  });
</script>

<div class="toolbar">
  <div class="toolbar-nav">
    <button class="nav-btn sidebar-toggle" onclick={ontoggleSidebar} use:tooltip={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'} aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
        <line x1="6" y1="3" x2="6" y2="13" stroke="currentColor" stroke-width="1.4"/>
      </svg>
    </button>
    {#if appView.current === 'calendar'}
      <button
        class="view-label"
        onclick={(e) => ongotoDate(e.currentTarget)}
        use:tooltip={'Go to date'}
      >{view.viewLabel}</button>
      <div class="date-nav">
        <button class="nav-btn" onclick={goPrev} use:tooltip={'Previous'} aria-label="Previous">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="today-btn" onclick={goToday} use:tooltip={'Jump to today'}>Today</button>
        <button class="nav-btn" onclick={goNext} use:tooltip={'Next'} aria-label="Next">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    {/if}
    {#if appView.current === 'tasks' || appView.current === 'notes'}
      <span class="view-label static-label">
        {appView.current === 'tasks' ? 'Tasks' : 'Notes'}
      </span>
    {/if}
  </div>

  <div class="toolbar-center">
    <div class="app-view-toggle" role="tablist" aria-label="Workspace view">
      {#each visibleTabs as tab (tab.id)}
        <button class:active={appView.current === tab.id} onclick={() => setAppView(tab.id)} role="tab" aria-selected={appView.current === tab.id}>{tab.label}</button>
      {/each}
    </div>
  </div>

  <div class="toolbar-right">
    <OfflineChip />
    <button
      class="icon-btn mobile-hide synth-btn"
      class:has-signal={synthHasSignal}
      onclick={ontoday}
      use:tooltip={'Today, honestly (Y)'}
      aria-label="Today, honestly"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 13.5l3-3 2.5 2.5L13 8" />
        <circle cx="13" cy="8" r="1.4" />
        <path d="M2.5 15.5h13" />
      </svg>
    </button>
    <VoiceCapture mode="capture" label="Voice capture" />
    <button class="icon-btn mobile-hide" onclick={onsearch} use:tooltip={'Search events (Cmd+F)'} aria-label="Search events">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.4"/>
        <path d="M12 12L15.5 15.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
    </button>
    <div class="view-dd mobile-hide">
      <Dropdown
        value={view.currentView}
        ariaLabel="View"
        onchange={(v) => setView(v)}
        options={viewOptions}
        iconOnly={true}
        triggerIcon={`<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="13" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 7.5h13M6.5 3v-1M11.5 3v-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`}
      />
    </div>
    <button class="icon-btn mobile-hide" onclick={onsettings} use:tooltip={'Settings'} aria-label="Settings">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    </button>
    <div class="new-split" bind:this={newMenuEl}>
      <button
        class="new-main"
        onclick={() => {
          // Make the primary "+New" contextual: in Tasks view it creates a
          // task; in Notes view it creates a note. The chevron menu is still
          // there for cross-view creation. This removes the redundant
          // per-view "New note"/"New task" button some screens used to show.
          if (appView.current === 'tasks') onnewTask();
          else if (appView.current === 'notes') onnewNote();
          else onnewEvent();
        }}
        use:tooltip={appView.current === 'tasks' ? 'New task (N)' : appView.current === 'notes' ? 'New note (N)' : 'New event (N)'}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
        <span>{appView.current === 'tasks' ? 'New task' : appView.current === 'notes' ? 'New note' : 'New event'}</span>
      </button>
      <button class="new-chev" onclick={toggleNewMenu} aria-label="Choose what to create" aria-haspopup="menu" aria-expanded={newMenuOpen}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      {#if newMenuOpen}
        <div class="new-menu" role="menu">
          <button class="new-menu-item" onclick={() => pickNew('event')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
              <path d="M1.5 5.5h11M4.5 1v2.5M9.5 1v2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
            New event
          </button>
          <button class="new-menu-item" onclick={() => pickNew('task')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.2"/>
              <path d="M4.5 7l2 2 3.5-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            New task
          </button>
          <button class="new-menu-item" onclick={() => pickNew('note')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 1.5h6l3 3v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z M9 1.5v3h3 M4.5 7.5h5M4.5 9.5h5M4.5 11.5h3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            New note
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .toolbar {
    /* 3-column grid keeps the centered Calendar|Tasks|Notes pill anchored
     * to the viewport center regardless of how wide the left (date label)
     * or right (action icons) sections become. Using flex with
     * justify-content:center caused the pill to shift left/right by
     * ~50px when switching between Calendar (long date label) and
     * Tasks/Notes (short label). */
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    height: var(--toolbar-height);
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    gap: 16px;
    flex-shrink: 0;
  }
  .toolbar-right { justify-self: end; }

  .toolbar-nav {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .nav-btn:hover { background: var(--surface-hover); color: var(--text-primary); }

  .view-label {
    font-size: 17px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 0 10px;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    background: none;
    border: none;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
    letter-spacing: -0.01em;
    /* Reserve a fixed slot equal to the sidebar so the date-nav buttons
       don't jitter horizontally as the date range changes width. */
    width: calc(var(--sidebar-width) - 40px);
    box-sizing: border-box;
    flex-shrink: 0;
  }
  @media (max-width: 768px) {
    .view-label { width: auto; }
  }
  .view-label:hover { background: var(--surface-hover); }
  .view-label.static-label { cursor: default; }
  .view-label.static-label:hover { background: none; }

  .date-nav {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .today-btn {
    padding: 4px 12px;
    margin: 0 2px;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    color: var(--text-primary);
    transition: background 0.1s, border-color 0.1s;
  }
  .today-btn:hover { background: var(--surface-hover); border-color: var(--accent); color: var(--accent); }

  .toolbar-center {
    /* Sits in the auto-sized middle column of the toolbar grid, so it stays
       centered even when the left/right columns change width. */
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .app-view-toggle {
    display: inline-flex;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 3px;
  }
  .app-view-toggle button {
    padding: 5px 14px;
    background: transparent;
    border: none;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .app-view-toggle button:hover:not(.active) { color: var(--text-primary); }
  .app-view-toggle button.active {
    background: var(--surface);
    color: var(--text-primary);
    box-shadow: 0 1px 2px rgba(0,0,0,0.06);
  }

  .new-split {
    position: relative;
    display: inline-flex;
    align-items: stretch;
    border-radius: var(--radius-sm);
    overflow: visible;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  .new-main, .new-chev {
    border: 1px solid var(--accent);
    background: var(--accent);
    color: white;
    cursor: pointer;
    padding: 0 10px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 500;
  }
  .new-main {
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
    border-right: 1px solid color-mix(in srgb, var(--accent) 70%, black);
    padding-right: 12px;
  }
  .new-chev {
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    padding: 0 8px;
  }
  .new-main:hover, .new-chev:hover { background: var(--accent-hover); }
  .new-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 160px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    padding: 4px;
    z-index: 1001;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .new-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    font-size: 13px;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }
  .new-menu-item:hover { background: var(--surface-hover); }
  .new-menu-item svg { color: var(--text-tertiary); flex-shrink: 0; }

  .view-dd { width: auto; }

  /* Tighten the toolbar on narrow viewports — hide help/settings (still
     accessible via ? and the kebab) and shrink the date label. */
  @media (max-width: 768px) {
    .view-label { font-size: 14px; margin: 0 4px; padding: 4px; }
    .toolbar { padding: 0 8px; gap: 6px; }
    .new-main span { display: none; }
    .new-main { padding: 0 8px; }
  }
  /* Mobile + small tablet (iPad portrait): collapse the centered
     Calendar|Tasks|Notes pill (it lives in the bottom nav now), and drop
     the right-side icons that have homes in the bottom-nav More sheet.
     The toolbar becomes: sidebar / date / today / +. Threshold matches
     MobileBottomNav (768px). */
  @media (max-width: 768px) {
    /* Drop the symmetric 1fr|auto|1fr grid: with .toolbar-center hidden,
       the symmetric outer 1fr columns squeeze the title to ~45px. Use
       1fr auto so the left column claims the empty right side's space. */
    .toolbar { grid-template-columns: 1fr auto; }
    .toolbar-center { display: none; }
    .view-label {
      font-size: 13px;
      min-width: 0;
      flex: 1 1 auto;
      /* No max-width cap: the parent toolbar-nav and 1fr-auto grid already
         constrain the title; an explicit 60vw cap forces premature ellipsis. */
    }
    .toolbar-nav { min-width: 0; }
    .toolbar { gap: 4px; padding: 0 8px; }
    /* Tap-target sizing: 40×40 is the practical mobile minimum (we can't
       hit a clean 44 without making the toolbar taller, which would eat
       calendar real estate). flex-shrink:0 prevents these icon buttons
       from being squashed by the title's flex:1. */
    .nav-btn,
    .sidebar-toggle,
    .new-main,
    .new-chev,
    .today-btn { flex-shrink: 0; }
    .nav-btn { width: 40px; height: 40px; }
    .sidebar-toggle { width: 40px; height: 40px; }
    .today-btn { min-height: 36px; padding: 4px 10px; font-size: 12px; }
    .new-main { min-height: 36px; padding: 0 10px; }
    .new-chev { min-height: 36px; padding: 0 8px; }
    .mobile-hide { display: none !important; }
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .icon-btn:hover { background: var(--surface-hover); color: var(--text-primary); }

  /* Synthesis icon signal dot — quiet pixel of red in the top-right corner
     when there's something worth a glance (overdue tasks today, etc.).
     No counter, no animation; just signals "there's something here." */
  .synth-btn { position: relative; }
  .synth-btn.has-signal::after {
    content: '';
    position: absolute;
    top: 6px; right: 6px;
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #c25e4d;
    box-shadow: 0 0 0 2px var(--bg);
  }
</style>
