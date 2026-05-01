<script>
  import { getContext } from 'svelte';
  import MiniCalendar from './MiniCalendar.svelte';
  import TodaysEventsSection from './sidebar/TodaysEventsSection.svelte';
  import NotesSidebarSection from './sidebar/NotesSidebarSection.svelte';
  import TasksSidebarSection from './sidebar/TasksSidebarSection.svelte';
  import TaskListPanel from './TaskListPanel.svelte';
  import { getAppView } from '../stores/appView.svelte.js';
  import CalendarSets from './CalendarSets.svelte';
  import NotificationBell from './NotificationBell.svelte';
  import { getCalendars, toggleCalendar } from '../stores/calendars.svelte.js';
  // TaskRow + completeTask/updateTask/deleteTask + buildTaskGroups +
  // withSubtaskOrder + confirmAction were used by the inline task list
  // implementation; that lives in TaskListPanel now.
  import { getTasks } from '../stores/tasks.svelte.js';
  import { getNotes } from '../stores/notes.svelte.js';
  import { getEvents, manualResync } from '../stores/events.svelte.js';

  let { onsettings = () => {}, onhelp = () => {} } = $props();
  const eventsStore = getEvents();
  // Tick every 30s so "synced N min ago" relative time updates without a full re-render.
  let nowTick = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => { nowTick = Date.now(); }, 30_000);
    return () => clearInterval(id);
  });
  function syncTooltip() {
    const ts = eventsStore.lastSyncedAt;
    if (!ts) return { title: 'Not synced yet', sub: 'Click to fetch your events' };
    const d = new Date(ts);
    const is12h = prefs?.values?.timeFormat !== '24h';
    const now = new Date();
    const today = new Date(now); today.setHours(0,0,0,0);
    const dayOf = new Date(d); dayOf.setHours(0,0,0,0);
    const dayDiff = Math.round((today - dayOf) / 86400000);
    let dayLabel;
    if (dayDiff === 0) dayLabel = 'Today';
    else if (dayDiff === 1) dayLabel = 'Yesterday';
    else {
      // M/D, with YYYY when before this year.
      const m = d.getMonth() + 1;
      const day = d.getDate();
      dayLabel = d.getFullYear() === now.getFullYear() ? `${m}/${day}` : `${m}/${day}/${d.getFullYear()}`;
    }
    return { title: `Last sync ${dayLabel} at ${formatTime(d, is12h)}`, sub: 'Click to re-sync' };
  }
  function syncLabel() {
    if (eventsStore.lastSyncFailed) return 'Sync failed';
    const ts = eventsStore.lastSyncedAt;
    if (!ts) return 'Not synced';
    const diff = Math.max(0, (nowTick - ts) / 1000);
    if (diff < 60) return 'Synced just now';
    if (diff < 3600) return `Synced ${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `Synced ${Math.floor(diff / 3600)}h ago`;
    return `Synced ${Math.floor(diff / 86400)}d ago`;
  }
  import { getPrefs, updatePref } from '../stores/prefs.svelte.js';
  import { getView } from '../stores/view.svelte.js';
  import { getCalendarColor } from '../utils/colors.js';
  import { isSameDay, formatTime, formatDate } from '../utils/dates.js';
  import { tooltip } from '../actions/tooltip.js';
  import {
    getBookingPages,
    fetchBookingPages,
    createBookingPage,
  } from '../stores/bookingPages.svelte.js';

  const app = getContext('app');

  const COLLAPSE_KEY = 'productivity_sidebar_collapsed';

  const cals = getCalendars();
  const taskStore = getTasks();
  const notesStore = getNotes();
  const appViewStore = getAppView();
  // Read synchronously OUTSIDE the $state initializer so the evaluated value
  // is committed before any reactivity begins — guards against any
  // "default flicker" where Svelte renders 'tasks' for one frame before the
  // IIFE resolves to 'notes'.
  const _initialSidebarTab = (() => {
    try { return localStorage.getItem('productivity_sidebar_tab') || 'tasks'; }
    catch { return 'tasks'; }
  })();
  let sidebarTab = $state(/** @type {'tasks'|'notes'} */ (_initialSidebarTab));
  function setSidebarTab(t) {
    sidebarTab = t;
    try { localStorage.setItem('productivity_sidebar_tab', t); } catch {}
  }
  // Sidebar width — persisted to localStorage, drag the right edge to resize.
  const SIDEBAR_W_KEY = 'productivity_sidebar_width';
  const MIN_W = 200;
  const MAX_W = 420;
  const _initialSidebarWidth = (() => {
    try {
      const v = parseInt(localStorage.getItem(SIDEBAR_W_KEY) || '', 10);
      return Number.isFinite(v) && v >= MIN_W && v <= MAX_W ? v : 240;
    } catch { return 240; }
  })();
  let sidebarWidth = $state(_initialSidebarWidth);
  // Sync width to the preset whenever it's standard/wide. 'custom' means the
  // user dragged the resizer — we honor whatever they set in localStorage.
  $effect(() => {
    const preset = prefs.values.sidebarWidthPreset;
    if (preset === 'standard') sidebarWidth = 240;
    else if (preset === 'wide') sidebarWidth = 320;
  });
  $effect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
  });
  let resizing = $state(false);
  function startResize(e) {
    e.preventDefault();
    resizing = true;
    const startX = e.clientX;
    const startW = sidebarWidth;
    function onMove(ev) {
      const next = Math.max(MIN_W, Math.min(MAX_W, startW + (ev.clientX - startX)));
      sidebarWidth = next;
    }
    function onUp() {
      resizing = false;
      try { localStorage.setItem(SIDEBAR_W_KEY, String(sidebarWidth)); } catch {}
      // User dragged → switch preset to 'custom' so the $effect doesn't reset.
      updatePref('sidebarWidthPreset', 'custom');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
  function resetWidth() {
    sidebarWidth = 240;
    try { localStorage.setItem(SIDEBAR_W_KEY, '240'); } catch {}
    updatePref('sidebarWidthPreset', 'standard');
  }

  function fmtRelativeTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
  }
  function noteSnippet(body) {
    if (!body) return '';
    const text = body.replace(/[#*_`>\-\[\]]/g, '').replace(/\n+/g, ' ').trim();
    return text.length > 80 ? text.slice(0, 80) + '…' : text;
  }
  const prefs = getPrefs();
  const view = getView();

  // Collapsed section state (persisted to localStorage)
  let collapsed = $state(loadCollapsed());

  function loadCollapsed() {
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  }

  function toggleCollapse(section) {
    collapsed = { ...collapsed, [section]: !collapsed[section] };
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed)); } catch {}
  }

  // Hidden calendars from sidebar list
  const hiddenCalendarIds = $derived(new Set(prefs.values.hiddenCalendarIds || []));

  function toggleHideCalendar(id) {
    const current = prefs.values.hiddenCalendarIds || [];
    if (current.includes(id)) {
      updatePref('hiddenCalendarIds', current.filter(c => c !== id));
    } else {
      updatePref('hiddenCalendarIds', [...current, id]);
    }
  }

  const visibleCals = $derived(cals.items.filter(c => !hiddenCalendarIds.has(c.id)));
  // Mirror Google Calendar's split: "My calendars" = owner/writer, "Other
  // calendars" = read-only feeds you've subscribed to. The "Other" group
  // only renders when at least one such calendar is visible — solo accounts
  // never see the header.
  function isMyCalendar(c) {
    const role = c.access_role || c.accessRole;
    if (!role) return true; // unknown access — assume mine
    return role === 'owner' || role === 'writer';
  }
  const myCals = $derived(visibleCals.filter(isMyCalendar));
  const otherCals = $derived(visibleCals.filter(c => !isMyCalendar(c)));

  // (task grouping derivations now live inside TaskListPanel)

  const totalTasks = $derived(taskStore.items.filter(t => !t.isCompleted).length);

  const sectionsVisible = $derived(
    prefs.values.sidebarSections || { miniCalendar: true, tasks: true, notes: true, sets: true, bookingPages: true, calendars: true }
  );

  const bookingPagesStore = getBookingPages();
  const bookingPages = $derived(bookingPagesStore.items);
  let copiedPageId = $state(null);

  $effect(() => { if (sectionsVisible.bookingPages !== false) fetchBookingPages(); });

  async function handleNewBookingPage() {
    const page = await createBookingPage();
    if (page) app?.editBookingPage?.(page);
  }

  function handleCopyBookingLink(p, e) {
    e.stopPropagation();
    const url = `${window.location.origin}/book/${p.slug}`;
    navigator.clipboard.writeText(url).then(() => {
      copiedPageId = p.id;
      setTimeout(() => { if (copiedPageId === p.id) copiedPageId = null; }, 1200);
    });
  }

  // Multi-select + bulk actions for the task list moved into
  // TaskListPanel.svelte so the sidebar and the holistic Tasks view share
  // the same behavior.
</script>

<aside class="sidebar" class:collapsed={!view.sidebarOpen} class:resizing>
  <div class="sidebar-content">
    <!-- Per-view primary section. Goes FIRST so the most-relevant content
         is at the top of the sidebar (no scrolling past the mini-cal in
         Notes view to find your notes). The two sidebars used to feel
         like they were competing — putting the active domain's navigator
         at the top makes the layout legible at a glance.
         See docs/internal/holistic-views.md. -->
    {#if appViewStore.current === 'notes'}
      <NotesSidebarSection />
    {:else if appViewStore.current === 'tasks'}
      <TasksSidebarSection />
    {/if}

    <!-- MiniCalendar and TodaysEventsSection are calendar-view-only.
         In Tasks/Notes views the date pickers and "today's events" strip
         felt out of place — those views are about WHAT, not WHEN. Trying
         the no-calendar/no-events sidebar there to see how it reads;
         we may add a compact peek back later. -->
    {#if appViewStore.current === 'calendar' && sectionsVisible.miniCalendar !== false}
      <MiniCalendar />
    {/if}

    <!-- Hide the Tasks/Notes sidebar section in the Tasks and Notes
         holistic views — it duplicated the main pane and felt clashy.
         Calendar view still shows it (most-used sidebar). The
         TodaysEventsSection above covers the cross-domain peek. -->
    {#if sectionsVisible.tasks !== false && appViewStore.current === 'calendar'}
    <!-- Tasks section — own collapsible group. Used to share a tab toggle
         with Notes; split because the "either/or" toggle hid content the
         user wanted both of. -->
    <div class="sidebar-section">
      <div class="section-header-row">
        <button class="section-header" onclick={() => toggleCollapse('tasks')}>
          <svg class="chevron" class:rotated={!collapsed.tasks} width="10" height="10" viewBox="0 0 10 10">
            <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
          <h3 class="section-title">
            Tasks
            {#if totalTasks > 0}<span class="section-count">{totalTasks}</span>{/if}
          </h3>
        </button>
        <button
          class="header-action"
          onclick={() => app?.editTask?.({ content: '', priority: 1, projectId: null, labels: [] })}
          use:tooltip={'New task'}
        >+</button>
      </div>
      {#if !collapsed.tasks}
        <!-- Task list rendering lives in TaskListPanel so the sidebar and
             the holistic Tasks view share group-by + multi-select + bulk
             actions verbatim. Behavior changes happen in one place. -->
        <TaskListPanel compact draggable />
      {/if}
    </div>
    {/if}

    {#if sectionsVisible.notes !== false && appViewStore.current === 'calendar'}
    <!-- Notes section — own collapsible group. -->
    <div class="sidebar-section">
      <div class="section-header-row">
        <button class="section-header" onclick={() => toggleCollapse('notes')}>
          <svg class="chevron" class:rotated={!collapsed.notes} width="10" height="10" viewBox="0 0 10 10">
            <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
          <h3 class="section-title">
            Notes
            {#if notesStore.items.length > 0}<span class="section-count">{notesStore.items.length}</span>{/if}
          </h3>
        </button>
        <button
          class="header-action"
          onclick={() => app?.editNote?.()}
          use:tooltip={'New note'}
        >+</button>
      </div>
      {#if !collapsed.notes}
        <div class="notes-list">
          {#if notesStore.loading}
            <p class="empty-text">Loading notes...</p>
          {:else if notesStore.items.length === 0}
            <p class="empty-text">No notes yet. Click + to create one.</p>
          {:else}
            {#each notesStore.items as note (note.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="note-row"
                draggable="true"
                ondragstart={(e) => { e.dataTransfer.setData('application/x-note-id', String(note.id)); e.dataTransfer.effectAllowed = 'link'; }}
                onclick={() => app?.editNote?.(note)}
              >
                {#if note.pinned}
                  <svg class="pin-icon" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2l-1 8 5 4v2H6v-2l5-4-1-8h4z"/></svg>
                {/if}
                <div class="note-row-content">
                  <div class="note-row-title">{note.title || 'Untitled'}</div>
                  {#if note.body}
                    <div class="note-row-snippet">{noteSnippet(note.body)}</div>
                  {/if}
                </div>
                <span class="note-row-time">{fmtRelativeTime(note.updatedAt)}</span>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
    {/if}

    {#if sectionsVisible.sets !== false && appViewStore.current === 'calendar'}
    <!-- Calendar Sets section. Calendar-domain only — hidden in Tasks/Notes
         views to keep the sidebar focused on the active workspace. -->
    <div class="sidebar-section">
      <button class="section-header" onclick={() => toggleCollapse('sets')}>
        <svg class="chevron" class:rotated={!collapsed.sets} width="10" height="10" viewBox="0 0 10 10">
          <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
        <h3 class="section-title">Calendar Sets</h3>
      </button>
      {#if !collapsed.sets}
        <CalendarSets />
      {/if}
    </div>
    {/if}

    {#if sectionsVisible.bookingPages !== false && appViewStore.current === 'calendar'}
    <!-- Booking pages — calendar-domain only. -->
    <div class="sidebar-section">
      <div class="section-header-row">
        <button class="section-header" onclick={() => toggleCollapse('bookingPages')}>
          <svg class="chevron" class:rotated={!collapsed.bookingPages} width="10" height="10" viewBox="0 0 10 10">
            <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
          <h3 class="section-title">Booking pages</h3>
        </button>
        <button class="header-action" onclick={handleNewBookingPage} use:tooltip={'New booking page'}>+</button>
      </div>
      {#if !collapsed.bookingPages}
        <div class="booking-pages-list">
          {#if bookingPages.length === 0}
            <p class="empty-text">No booking pages yet.</p>
          {:else}
            {#each bookingPages as p (p.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="booking-page-item"
                class:inactive={!p.isActive}
                onclick={() => app?.editBookingPage?.(p)}
                use:tooltip={'Edit page'}
              >
                <span class="bp-dot" style="background: {p.color || p.brandColor || '#6366f1'}"></span>
                <span class="bp-title">{p.title}</span>
                <button class="bp-copy" onclick={(e) => handleCopyBookingLink(p, e)} use:tooltip={'Copy link'}>
                  {#if copiedPageId === p.id}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-6" stroke="#10b981" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  {:else}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <rect x="2" y="2" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1"/>
                      <rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1" fill="white"/>
                    </svg>
                  {/if}
                </button>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
    {/if}

    {#if sectionsVisible.calendars !== false && appViewStore.current === 'calendar'}
    <!-- Calendars list — calendar-domain only. -->
    <div class="sidebar-section">
      <button class="section-header" onclick={() => toggleCollapse('calendars')}>
        <svg class="chevron" class:rotated={!collapsed.calendars} width="10" height="10" viewBox="0 0 10 10">
          <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
        <h3 class="section-title">Calendars</h3>
        {#if hiddenCalendarIds.size > 0}
          <span class="section-count" use:tooltip={'{hiddenCalendarIds.size} hidden'}>{visibleCals.length}/{cals.items.length}</span>
        {/if}
      </button>
      {#if !collapsed.calendars}
        <div class="calendar-list">
          {#if otherCals.length > 0}
            <div class="cal-subgroup-h">My calendars</div>
          {/if}
          {#each myCals as cal (cal.id)}
            {@const color = getCalendarColor(cal)}
            <div class="calendar-item-wrap">
              <label class="calendar-item">
                <input
                  type="checkbox"
                  checked={cals.visibleCalendarIds.has(cal.id)}
                  onchange={() => toggleCalendar(cal.id, prefs.values.syncCalendarVisibility)}
                />
                <span class="cal-dot" style="background: {color.light}"></span>
                <span class="cal-name">{cal.summary}</span>
              </label>
              <button class="cal-hide-btn" onclick={() => toggleHideCalendar(cal.id)} use:tooltip={'Hide from list'}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1.5 6C2.5 3.5 4 2 6 2C8 2 9.5 3.5 10.5 6C9.5 8.5 8 10 6 10C4 10 2.5 8.5 1.5 6Z" stroke="currentColor" stroke-width="1"/>
                  <circle cx="6" cy="6" r="1.5" stroke="currentColor" stroke-width="1"/>
                  <line x1="1" y1="11" x2="11" y2="1" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          {/each}
          {#if otherCals.length > 0}
            <div class="cal-subgroup-h">Other calendars</div>
            {#each otherCals as cal (cal.id)}
              {@const color = getCalendarColor(cal)}
              <div class="calendar-item-wrap">
                <label class="calendar-item">
                  <input
                    type="checkbox"
                    checked={cals.visibleCalendarIds.has(cal.id)}
                    onchange={() => toggleCalendar(cal.id, prefs.values.syncCalendarVisibility)}
                  />
                  <span class="cal-dot" style="background: {color.light}"></span>
                  <span class="cal-name">{cal.summary}</span>
                </label>
                <button class="cal-hide-btn" onclick={() => toggleHideCalendar(cal.id)} use:tooltip={'Hide from list'}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M1.5 6C2.5 3.5 4 2 6 2C8 2 9.5 3.5 10.5 6C9.5 8.5 8 10 6 10C4 10 2.5 8.5 1.5 6Z" stroke="currentColor" stroke-width="1"/>
                    <circle cx="6" cy="6" r="1.5" stroke="currentColor" stroke-width="1"/>
                    <line x1="1" y1="11" x2="11" y2="1" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
    {/if}
  </div>
  <div class="sidebar-footer">
    <div class="footer-actions">
      <NotificationBell />
      <button class="footer-btn" onclick={onhelp} use:tooltip={'Keyboard shortcuts (?)'} aria-label="Keyboard shortcuts">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </button>
      <button class="footer-btn" onclick={onsettings} use:tooltip={'Settings'} aria-label="Settings">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </button>
    </div>
    <button
      class="sync-status"
      class:failed={eventsStore.lastSyncFailed}
      use:tooltip={syncTooltip()}
      onclick={() => manualResync(view.viewStart, view.viewEnd)}
      disabled={eventsStore.loading}
    >
      {eventsStore.loading ? 'Syncing…' : syncLabel()}
    </button>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="sidebar-resizer"
    onmousedown={startResize}
    ondblclick={resetWidth}
    aria-hidden="true"
  ></div>
</aside>

<style>
  .sidebar {
    width: var(--sidebar-width);
    border-right: 1px solid var(--border);
    background: var(--bg-secondary);
    flex-shrink: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .sidebar-footer {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-top: 1px solid var(--border-light);
    background: var(--bg-secondary);
    gap: 8px;
    min-width: 0;
  }
  .footer-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .footer-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .footer-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
  .sync-status {
    font-size: 11px;
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    background: none;
    border: none;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-family: inherit;
  }
  .sync-status:hover:not(:disabled) { color: var(--text-secondary); background: var(--surface-hover); }
  .sync-status:disabled { cursor: default; opacity: 0.85; }
  .sync-status.failed { color: var(--error, #ef4444); }
  .sidebar:not(.resizing) { transition: width 0.2s, opacity 0.2s; }
  .sidebar-resizer {
    position: absolute;
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 30;
    background: transparent;
  }
  .sidebar-resizer:hover,
  .sidebar.resizing .sidebar-resizer {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .sidebar.collapsed {
    width: 0;
    overflow: hidden;
    border-right: none;
  }

  .sidebar-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: var(--radius-sm);
    width: 100%;
    text-align: left;
  }
  .section-header:hover {
    background: var(--surface-hover);
  }

  .section-header-row {
    display: flex;
    align-items: center;
    width: 100%;
  }
  .section-header-row .section-header {
    flex: 1;
  }

  .chevron {
    color: var(--text-tertiary);
    flex-shrink: 0;
    transition: transform 0.15s ease;
    transform: rotate(0deg);
  }
  .chevron.rotated {
    transform: rotate(90deg);
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
  }

  .section-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px;
    border-bottom: 1px solid var(--border-light);
  }
  .chevron-btn {
    background: none;
    border: none;
    padding: 4px;
    cursor: pointer;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .chevron-btn:hover { color: var(--text-primary); }
  .section-tab {
    background: none;
    border: none;
    padding: 6px 8px;
    /* Equal-width tabs so the click target extends past the label —
       previously the button hugged the word and ~half the row was dead
       space. */
    flex: 1 1 0;
    min-width: 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .section-tab:hover { color: var(--text-secondary); background: var(--surface-hover); }
  .section-tab.active { color: var(--accent); background: var(--accent-light); }
  .add-btn {
    margin-left: auto;
    background: none;
    border: 1px solid var(--border);
    padding: 0;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .add-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--surface-hover); }

  .new-row-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    width: calc(100% - 16px);
    margin: 6px 8px 0;
    padding: 6px 10px;
    background: none;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .new-row-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
    border-style: solid;
    background: var(--accent-light);
  }

  .notes-list {
    padding: 4px 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .note-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    min-width: 0;
  }
  .note-row:hover { background: var(--surface-hover); }
  .pin-icon {
    color: var(--accent);
    margin-top: 2px;
    flex-shrink: 0;
  }
  .note-row-content {
    flex: 1;
    min-width: 0;
  }
  .note-row-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .note-row-snippet {
    font-size: 11px;
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }
  .note-row-time {
    font-size: 10px;
    color: var(--text-tertiary);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .section-count {
    font-size: 10px;
    font-weight: 500;
    color: var(--text-tertiary);
    /* Use tabular-nums so 1 → 50 → 100 all occupy the same width and the
       Notes header doesn't jiggle as the count populates from the API. */
    font-variant-numeric: tabular-nums;
    margin-left: 4px;
    /* No background pill — 3-digit counts (288 tasks) overflowed the rounded
       pill. The bare number reads cleaner and gives the +button room to
       breathe. */
  }

  /* Task list / group / bulk-bar styles moved into TaskListPanel.svelte. */

  .empty-text {
    font-size: 12px;
    color: var(--text-tertiary);
    padding: 4px;
  }

  .cal-subgroup-h {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
    padding: 6px 4px 2px;
    margin-top: 2px;
  }
  .cal-subgroup-h:first-child { margin-top: 0; }
  .calendar-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .calendar-item-wrap {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .calendar-item-wrap:hover .cal-hide-btn {
    opacity: 1;
  }

  .calendar-item {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    cursor: pointer;
    min-width: 0;
  }
  .calendar-item:hover {
    background: var(--surface-hover);
  }

  .calendar-item input[type="checkbox"] {
    width: 14px;
    height: 14px;
    cursor: pointer;
    accent-color: var(--accent);
    flex-shrink: 0;
  }

  .cal-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .cal-name {
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cal-hide-btn {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    opacity: 0;
    flex-shrink: 0;
    margin-left: -22px;
    transition: opacity 0.1s, margin-left 0.1s;
  }
  .calendar-item-wrap:hover .cal-hide-btn {
    margin-left: 0;
  }
  .cal-hide-btn:hover {
    color: var(--error);
    background: var(--surface-hover);
  }

  .header-action {
    margin-left: auto;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 3px;
    font-size: 14px;
    line-height: 1;
  }
  .header-action:hover {
    background: var(--surface-active);
    color: var(--text-primary);
  }

  .booking-pages-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .booking-page-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    cursor: pointer;
    color: var(--text-primary);
  }
  .booking-page-item:hover {
    background: var(--surface-hover);
  }
  .booking-page-item.inactive { opacity: 0.55; }
  .bp-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .bp-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bp-copy {
    width: 22px;
    height: 22px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    flex-shrink: 0;
    opacity: 0;
  }
  .booking-page-item:hover .bp-copy { opacity: 1; }
  .bp-copy:hover { background: var(--surface-active); color: var(--text-primary); }
</style>
