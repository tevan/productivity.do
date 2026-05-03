<script>
  import { setContext } from 'svelte';
  import Toolbar from './lib/components/Toolbar.svelte';
  import MobileBottomNav from './lib/components/MobileBottomNav.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import EventPopover from './lib/components/EventPopover.svelte';
  import SearchOverlay from './lib/components/SearchOverlay.svelte';
  import FeedbackModal from './lib/components/FeedbackModal.svelte';
  import FindTimeModal from './lib/components/FindTimeModal.svelte';
  import EventContextMenu from './lib/components/EventContextMenu.svelte';
  import EventEditor from './lib/components/EventEditor.svelte';
  import TaskEditor from './lib/components/TaskEditor.svelte';
  import NoteEditor from './lib/components/NoteEditor.svelte';
  import { loadNotes } from './lib/stores/notes.svelte.js';
  import { loadLinks } from './lib/stores/links.svelte.js';
  import ConfirmRoot from './lib/components/ConfirmRoot.svelte';
  import ScopeModalRoot from './lib/components/ScopeModalRoot.svelte';
  import UpgradeRoot from './lib/components/UpgradeRoot.svelte';
  import FounderThoughtsWidget from './lib/components/FounderThoughtsWidget.svelte';
  import ToastRoot from './lib/components/ToastRoot.svelte';
  import NextDaysView from './lib/views/NextDaysView.svelte';
  import WeekView from './lib/views/WeekView.svelte';
  import MonthView from './lib/views/MonthView.svelte';

  // Lazy-loaded chunks. These views/modals aren't needed for first paint of
  // the calendar (the default landing experience), so deferring them shaves
  // ~80 KB off the main bundle. Each `loadX()` is cached via the dynamic
  // import promise — calling it twice returns the same module.
  let TasksView = $state(null);
  let NotesView = $state(null);
  let Settings = $state(null);
  let GotoDate = $state(null);
  let ShortcutsHelp = $state(null);
  let BookingPageEditor = $state(null);
  let IntegrationsPage = $state(null);
  let AdminMetricsPage = $state(null);
  let AdminIntegrationsPage = $state(null);
  let ProjectPage = $state(null);
  function loadProjectPage() {
    if (!ProjectPage) import('./lib/views/ProjectPage.svelte').then(m => ProjectPage = m.default);
  }
  let TodayPanel = $state(null);
  function loadTodayPanel() {
    if (!TodayPanel) import('./lib/components/TodayPanel.svelte').then(m => TodayPanel = m.default);
  }
  function loadTasksView() {
    if (!TasksView) import('./lib/views/TasksView.svelte').then(m => TasksView = m.default);
  }
  function loadIntegrationsPage() {
    if (!IntegrationsPage) import('./lib/views/IntegrationsPage.svelte').then(m => IntegrationsPage = m.default);
  }
  function loadAdminMetricsPage() {
    if (!AdminMetricsPage) import('./lib/views/AdminMetricsPage.svelte').then(m => AdminMetricsPage = m.default);
  }
  function loadAdminIntegrationsPage() {
    if (!AdminIntegrationsPage) import('./lib/views/AdminIntegrationsPage.svelte').then(m => AdminIntegrationsPage = m.default);
  }
  function loadNotesView() {
    if (!NotesView) import('./lib/views/NotesView.svelte').then(m => NotesView = m.default);
  }
  function loadSettings() {
    if (!Settings) import('./lib/components/Settings.svelte').then(m => Settings = m.default);
  }
  function loadGotoDate() {
    if (!GotoDate) import('./lib/components/GotoDate.svelte').then(m => GotoDate = m.default);
  }
  function loadShortcutsHelp() {
    if (!ShortcutsHelp) import('./lib/components/ShortcutsHelp.svelte').then(m => ShortcutsHelp = m.default);
  }
  function loadBookingPageEditor() {
    if (!BookingPageEditor) import('./lib/components/BookingPageEditor.svelte').then(m => BookingPageEditor = m.default);
  }
  import { getAppView, reconcileAppViewFromPrefs, getVisibleTabs, setAppView } from './lib/stores/appView.svelte.js';
  import { getRoute } from './lib/stores/routeStore.svelte.js';
  import DayView from './lib/views/DayView.svelte';

  import { getView, goToday, goNext, goPrev, setView, setDate, reconcileViewFromPrefs } from './lib/stores/view.svelte.js';
  import { getEvents, fetchEvents } from './lib/stores/events.svelte.js';
  import { computeTravelForEvents } from './lib/stores/travel.svelte.js';
  import { applyColorScheme } from './lib/utils/colorSchemes.js';
  import { isDarkSnapshot } from './lib/utils/theme.svelte.js';
  import { getTasks, fetchTasks } from './lib/stores/tasks.svelte.js';
  import { fetchTaskColumns } from './lib/stores/taskColumns.svelte.js';
  import { getCalendars, fetchCalendars, switchSet } from './lib/stores/calendars.svelte.js';
  import { getPrefs, fetchPrefs } from './lib/stores/prefs.svelte.js';
  import { fetchFocusBlocks } from './lib/stores/focusBlocks.svelte.js';
  import { fetchWeather } from './lib/stores/weather.svelte.js';
  import { schedulePrefetch as schedulePrefetchSynth } from './lib/stores/synthesis.svelte.js';
  // Re-export with the local name expected below.
  const schedulePrefetch = schedulePrefetchSynth;
  import { setupKeyboardShortcuts } from './lib/utils/keyboard.js';
  import { scheduleReminders, clearReminders } from './lib/utils/reminders.js';
  import { api } from './lib/api.js';
  import { parseTaskDue } from './lib/utils/dates.js';

  const view = getView();
  const appView = getAppView();
  const route = getRoute();
  const eventsStore = getEvents();
  const taskStore = getTasks();
  const cals = getCalendars();
  const prefs = getPrefs();

  // Lazy-load app-view chunks the moment the user navigates to them.
  // This is the trigger that pairs with the {:else}<div>Loading…</div>
  // rendered above while the chunk fetches.
  $effect(() => {
    if (appView.current === 'tasks') loadTasksView();
    if (appView.current === 'notes') loadNotesView();
  });
  $effect(() => { if (route.isIntegrations) loadIntegrationsPage(); });
  $effect(() => { if (route.isAdminMetrics) loadAdminMetricsPage(); });
  $effect(() => { if (route.isAdminIntegrations) loadAdminIntegrationsPage(); });
  $effect(() => { if (route.isProject) loadProjectPage(); });

  // If the user hides the active tab in Settings, bounce to the first
  // visible tab so they're not left staring at an invisible view.
  $effect(() => {
    const visible = getVisibleTabs(prefs.values);
    if (visible.length === 0) return; // shouldn't happen — guarded in editor
    if (!visible.find(t => t.id === appView.current)) {
      setAppView(visible[0].id);
    }
  });
  $effect(() => { if (showSettings) loadSettings(); });
  $effect(() => { if (showShortcuts) loadShortcutsHelp(); });
  $effect(() => { if (showGotoDate) loadGotoDate(); });
  $effect(() => { if (editorBookingPage) loadBookingPageEditor(); });
  $effect(() => { if (showTodayPanel) loadTodayPanel(); });

  // Auth state
  let authenticated = $state(false);
  let loading = $state(true);

  // UI state
  let showSettings = $state(false);
  let pendingSettingsTab = $state(null); // initial tab for Settings when opened
  let showShortcuts = $state(false);
  let showGotoDate = $state(false);
  let showSearch = $state(false);
  let showFindTime = $state(false);
  let showFeedback = $state(false);
  let showTodayPanel = $state(false);
  // Auto-hide on narrow viewports; respect the user's explicit preference
  // when they're on a wide enough screen to choose for themselves.
  const _initialSidebarHidden = (() => {
    try {
      const explicit = localStorage.getItem('productivity_sidebar_hidden');
      if (typeof window !== 'undefined' && window.innerWidth < 768) return true;
      return explicit === '1';
    } catch { return false; }
  })();
  let sidebarHidden = $state(_initialSidebarHidden);
  $effect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      if (window.innerWidth < 768 && !sidebarHidden) sidebarHidden = true;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  // Force Day view on phones. 5/7-day grids at <640px squeeze chips to ~57px
  // wide — titles become unreadable. Day view gives one column the full
  // width. Per-form-factor view persistence (see view_persistence_pattern
  // memory) keeps the desktop default intact.
  $effect(() => {
    if (typeof window === 'undefined') return;
    const enforce = () => {
      if (window.innerWidth < 640 && view.currentView !== 'day' && view.currentView !== 'month') {
        setView('day');
      }
    };
    enforce();
    window.addEventListener('resize', enforce);
    return () => window.removeEventListener('resize', enforce);
  });
  function toggleSidebar() {
    sidebarHidden = !sidebarHidden;
    try { localStorage.setItem('productivity_sidebar_hidden', sidebarHidden ? '1' : '0'); } catch {}
  }
  let showEditor = $state(false);
  let editorEvent = $state(null);
  let editorDefaultStart = $state(null);
  let editorDefaultEnd = $state(null);
  let editorTask = $state(null);
  let editorBookingPage = $state(null);
  let editorNote = $state(null);
  // Read-only viewer for deleted records (opened from the Activity feed
  // when the resource was hard-deleted at the source).
  let deletedRecord = $state(null);
  let DeletedRecordViewer = $state(null);
  let popoverEvent = $state(null);
  let popoverPosition = $state({ x: 0, y: 0 });
  let contextEvent = $state(null);
  let contextPosition = $state({ x: 0, y: 0 });
  let hoveredSlot = $state(null); // Date | null

  // Check auth on mount
  $effect(() => {
    checkAuth();
  });

  async function checkAuth() {
    try {
      const res = await api('/api/auth/status');
      if (res.ok) {
        authenticated = true;
        await initData();
      } else {
        // Redirect to login
        window.location.href = '/login';
      }
    } catch {
      // If the API doesn't exist yet, show the app anyway for development
      authenticated = true;
      loading = false;
    }
  }

  async function initData() {
    await fetchPrefs();
    // Restore last view from localStorage; fall back to defaultView if nothing saved.
    const savedView = (() => {
      try { return localStorage.getItem('productivity_last_view'); } catch { return null; }
    })();
    if (!savedView && prefs.values.defaultView) {
      setView(prefs.values.defaultView);
    }
    // Reconcile the locally-hydrated appView (Calendar | Tasks | Notes) with
    // the server's per-form-factor pref. localStorage gave us instant first
    // paint; this corrects to the user's actual preference if they signed in
    // on a new device. See docs/internal/tasks-board.md § View persistence.
    reconcileAppViewFromPrefs(prefs.values);
    reconcileViewFromPrefs(prefs.values);
    // Fetch all data in parallel
    await Promise.all([
      fetchCalendars(),
      fetchTasks(),
      fetchTaskColumns(),
      fetchWeather(),
      fetchFocusBlocks(),
      loadNotes(),
      loadLinks(),
    ]);
    loading = false;

    // After the calendar canvas paints, warm the synthesis layer in the
    // background. Reading three small SQL endpoints once costs single-digit
    // ms; the user pays no perceived latency. The Y panel then opens
    // instantly with real data instead of flickering through a loading
    // state. See docs/internal/synthesis-layer.md.
    schedulePrefetch(1500);
  }

  // Refetch events when view range changes
  $effect(() => {
    if (authenticated && view.viewStart && view.viewEnd) {
      fetchEvents(view.viewStart, view.viewEnd);
    }
  });

  // Filter events by visible calendars + RSVP. By default we hide events
  // the user has declined (matches Google Calendar's default behavior);
  // toggle `showDeclinedEvents` in Settings to keep them visible (with a
  // strikethrough). Tentative ("Maybe") events always render but get a
  // dashed outline + reduced opacity downstream in EventChip.
  const visibleEvents = $derived(
    eventsStore.items.filter(e => {
      if (!cals.visibleCalendarIds.has(e.calendarId)) return false;
      if (prefs.values.hideWorkingLocations && e.eventType === 'workingLocation') {
        return false;
      }
      if (!prefs.values.showDeclinedEvents) {
        const me = (e.attendees || []).find(a => a.self);
        if (me && me.responseStatus === 'declined') return false;
      }
      return true;
    })
  );

  // Trigger travel-time computation when visible events change. The store
  // dedupes its own work so re-triggering on every change is fine.
  $effect(() => {
    if (prefs.values.showTravelBlocks !== false && visibleEvents.length) {
      computeTravelForEvents(visibleEvents);
    }
  });

  function setViewIfEnabled(id) {
    const enabled = prefs.values.enabledViews || [];
    if (enabled.includes(id)) setView(id);
  }

  function viewBySlot(idx) {
    const enabled = prefs.values.enabledViews || [];
    if (enabled[idx]) setView(enabled[idx]);
  }

  let gotoDateAnchor = $state(null);
  function openGotoDate(triggerEl) {
    // The toolbar passes the date label's element so the panel can drop
    // down right under the click instead of opening as a centered modal.
    // Falls back to centered when no trigger is provided (e.g. opened by
    // keyboard shortcut "G").
    gotoDateAnchor = triggerEl || null;
    showGotoDate = true;
  }

  function handleGotoDate(date) {
    setDate(date);
    showGotoDate = false;
    gotoDateAnchor = null;
  }

  // Keyboard shortcuts
  $effect(() => {
    const cleanup = setupKeyboardShortcuts({
      today: goToday,
      prev: goPrev,
      next: goNext,
      // Slot-based numeric shortcuts use the user's enabled view order
      viewSlot1: () => viewBySlot(0),
      viewSlot2: () => viewBySlot(1),
      viewSlot3: () => viewBySlot(2),
      viewSlot4: () => viewBySlot(3),
      // Letter-based shortcuts target a specific view (only if enabled)
      viewDay: () => setViewIfEnabled('day'),
      viewNextDays: () => setViewIfEnabled('nextdays'),
      viewWeek: () => setViewIfEnabled('week'),
      viewMonth: () => setViewIfEnabled('month'),
      newEvent: () => {
        editorEvent = null;
        if (hoveredSlot) {
          editorDefaultStart = hoveredSlot;
          editorDefaultEnd = new Date(hoveredSlot.getTime() + (prefs.values.defaultEventDuration || 30) * 60000);
        } else {
          editorDefaultStart = null;
          editorDefaultEnd = null;
        }
        showEditor = true;
      },
      gotoDate: openGotoDate,
      help: () => { showShortcuts = true; },
      searchEvents: () => { showSearch = true; },
      newNote: () => { editorNote = { title: '', body: '', pinned: false }; },
      findTime: () => { showFindTime = true; },
      todayPanel: () => { showTodayPanel = true; },
      escape: () => {
        if (showTodayPanel) { showTodayPanel = false; return; }
        if (showFindTime) { showFindTime = false; return; }
        if (showSearch) { showSearch = false; return; }
        if (contextEvent) { contextEvent = null; return; }
        if (showGotoDate) { showGotoDate = false; return; }
        if (showShortcuts) { showShortcuts = false; return; }
        if (showSettings) { showSettings = false; return; }
        if (editorTask) { editorTask = null; return; }
        if (editorNote) { editorNote = null; return; }
        if (showEditor) { showEditor = false; return; }
        if (popoverEvent) { popoverEvent = null; return; }
      },
      search: () => { showSearch = true; },
      toggleMode: () => { /* deprecated — input removed from toolbar */ },
      calSet1: () => {
        const sets = cals.sets;
        if (sets[0]) switchSet(sets[0].id);
      },
      calSet2: () => {
        const sets = cals.sets;
        if (sets[1]) switchSet(sets[1].id);
      },
      calSet3: () => {
        const sets = cals.sets;
        if (sets[2]) switchSet(sets[2].id);
      },
    });
    return cleanup;
  });

  // If the current view becomes disabled, fall back to the first enabled view
  $effect(() => {
    const enabled = prefs.values.enabledViews || [];
    if (enabled.length > 0 && !enabled.includes(view.currentView)) {
      setView(enabled[0]);
    }
  });

  // Theme application. Mirrors the resolved theme (light/dark) to localStorage
  // so the inline script in index.html can apply it on the next reload before
  // any CSS evaluates — prevents the white→dark flash on cold loads.
  // Also re-applies the chosen color scheme since accent vars depend on mode.
  $effect(() => {
    const pref = prefs.values.theme;
    let resolved = pref;
    if (!resolved || resolved === 'system') {
      try {
        resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch { resolved = 'light'; }
    }
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(resolved);
    try { localStorage.setItem('productivity_theme', pref || 'system'); } catch {}
    // Re-apply scheme after class flip so light/dark variant matches.
    applyColorScheme(prefs.values.colorScheme || 'default', resolved === 'dark');
  });

  // Color scheme application. Runs whenever scheme changes; the theme effect
  // above also re-applies on light/dark switch.
  $effect(() => {
    const scheme = prefs.values.colorScheme || 'default';
    // Source of truth: prefs.theme + matchMedia (CLAUDE.md). The classList
    // is downstream — reading it can race the theme effect just above.
    applyColorScheme(scheme, isDarkSnapshot());
  });

  // Accent color application. Only honored when the user is on the default
  // color scheme — non-default schemes set their own accent and shouldn't be
  // overridden by the legacy single-color picker.
  $effect(() => {
    const scheme = prefs.values.colorScheme || 'default';
    if (scheme !== 'default') return;
    const accent = prefs.values.accentColor;
    if (accent) {
      document.documentElement.style.setProperty('--accent', accent);
    }
  });

  // Schedule reminders when events or settings change
  $effect(() => {
    if (prefs.values.enableBrowserNotifications && prefs.values.defaultReminderMinutes > 0) {
      scheduleReminders(visibleEvents, prefs.values.defaultReminderMinutes, prefs.values.reminderSound);
    } else {
      clearReminders();
    }
  });

  // Tab title badge: counts today's remaining events + open tasks. Updates
  // whenever the underlying data changes. Mirrors GCal/Fantastical behavior.
  $effect(() => {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(now); endOfDay.setHours(23,59,59,999);
    const remainingEvents = visibleEvents.filter(e => {
      if (e.allDay) return false;
      const s = new Date(e.start);
      return s >= now && s <= endOfDay;
    }).length;
    const openTasks = taskStore.items.filter(t => {
      if (t.isCompleted) return false;
      const due = parseTaskDue(t);
      return due && due <= endOfDay;
    }).length;
    const total = remainingEvents + openTasks;
    document.title = total > 0 ? `(${total}) Productivity` : 'Productivity';
  });

  // Event handlers
  function handleEventClick(event, e) {
    popoverEvent = event;
    popoverPosition = { x: e.clientX + 10, y: e.clientY - 10 };
  }

  function handleEventContext(event, e) {
    popoverEvent = null;
    contextEvent = event;
    contextPosition = { x: e.clientX, y: e.clientY };
  }

  function handleSlotClick(date) {
    editorEvent = null;
    editorDefaultStart = date;
    editorDefaultEnd = new Date(date.getTime() + (prefs.values.defaultEventDuration || 30) * 60000);
    showEditor = true;
  }

  function handleDragCreate({ start, end }) {
    editorEvent = null;
    editorDefaultStart = start;
    editorDefaultEnd = end;
    showEditor = true;
  }

  function handleEditFromPopover(event) {
    popoverEvent = null;
    editorEvent = event;
    showEditor = true;
  }

  function handleDateClick(date) {
    setDate(date);
  }

  function handleAllDayClick(date) {
    // Opens the editor with allDay=true for the clicked column. We pass
    // both start AND end as that exact local-midnight date so EventEditor's
    // initialization paths it through `parseAllDayDate` consistently.
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    editorEvent = { allDay: true, start: d.toISOString(), end: d.toISOString() };
    editorDefaultStart = null;
    editorDefaultEnd = null;
    showEditor = true;
  }

  function handleNewEvent() {
    editorEvent = null;
    editorDefaultStart = null;
    editorDefaultEnd = null;
    showEditor = true;
  }

  function handleEditTask(task) {
    editorTask = task;
  }

  function handleNewTask() {
    // TaskEditor expects an existing task; pass a minimal stub so the user
    // can fill in content and save. The editor's save path creates a new
    // task in Todoist if no id is set.
    editorTask = { content: '', priority: 1, projectId: null, labels: [] };
  }

  function handleNewNote() {
    editorNote = { title: '', body: '', pinned: false };
  }

  setContext('app', {
    editTask: handleEditTask,
    editEvent: (draft) => {
      editorEvent = draft;
      editorDefaultStart = null;
      editorDefaultEnd = null;
      showEditor = true;
    },
    editBookingPage: (page) => { editorBookingPage = page; },
    editNote: (note) => { editorNote = note ?? { title: '', body: '', pinned: false }; },
    // Open Settings (optionally to a specific tab — caller passes a string
    // like 'tasks' or 'focus-blocks' which Settings.svelte interprets).
    openSettings: (tab) => {
      pendingSettingsTab = tab || null;
      showSettings = true;
    },
    // Read-only viewer for a deleted resource. Lazy-loads the chunk on
    // first use to keep the main bundle small.
    viewDeletedRecord: async (rec) => {
      if (!DeletedRecordViewer) {
        const m = await import('./lib/components/DeletedRecordViewer.svelte');
        DeletedRecordViewer = m.default;
      }
      deletedRecord = rec;
    },
  });
</script>

{#if !authenticated}
  <div class="loading-screen" aria-hidden="true"></div>
{:else if route.isIntegrations}
  {#if IntegrationsPage}
    <IntegrationsPage />
  {:else}
    <div class="loading-screen" aria-hidden="true"></div>
  {/if}
{:else if route.isAdminMetrics}
  {#if AdminMetricsPage}
    <AdminMetricsPage />
  {:else}
    <div class="loading-screen" aria-hidden="true"></div>
  {/if}
{:else if route.isAdminIntegrations}
  {#if AdminIntegrationsPage}
    <AdminIntegrationsPage />
  {:else}
    <div class="loading-screen" aria-hidden="true"></div>
  {/if}
{:else if route.isProject}
  {#if ProjectPage}
    <ProjectPage />
  {:else}
    <div class="loading-screen" aria-hidden="true"></div>
  {/if}
{:else}
  {#if eventsStore.loading}
    <div class="top-progress" aria-hidden="true"><div class="top-progress-bar"></div></div>
  {/if}
  <div class="app-layout">
    <Toolbar
      onsettings={() => showSettings = true}
      onhelp={() => showShortcuts = true}
      onnewEvent={handleNewEvent}
      onnewTask={handleNewTask}
      onnewNote={handleNewNote}
      onsearch={() => showSearch = true}
      ontoday={() => showTodayPanel = true}
      ongotoDate={openGotoDate}
      ontoggleSidebar={toggleSidebar}
      {sidebarHidden}
    />
    <div class="app-body">
      {#if !sidebarHidden}
        <Sidebar
          onsettings={() => showSettings = true}
          onhelp={() => showShortcuts = true}
        />
      {/if}
      <main class="main-content">
        {#if appView.current === 'tasks'}
          <!-- Lazily fetched the first time the user opens this view. The
               brief loading gap is cheaper than a 60KB up-front cost. -->
          {#if TasksView}
            <TasksView />
          {:else}
            <div class="lazy-loading">Loading…</div>
          {/if}
        {:else if appView.current === 'notes'}
          {#if NotesView}
            <NotesView />
          {:else}
            <div class="lazy-loading">Loading…</div>
          {/if}
        {:else}
          {#if view.currentView === 'nextdays'}
            <NextDaysView
              events={visibleEvents}
              tasks={taskStore.items}
              onclickEvent={handleEventClick}
              oneditEvent={handleEditFromPopover}
              onclickSlot={handleSlotClick}
              onclickAllDay={handleAllDayClick}
              ondragCreate={handleDragCreate}
              onclickDate={handleDateClick}
              oncontextEvent={handleEventContext}
              onhoverSlot={(d) => hoveredSlot = d}
            />
          {:else if view.currentView === 'week'}
            <WeekView
              events={visibleEvents}
              tasks={taskStore.items}
              onclickEvent={handleEventClick}
              oneditEvent={handleEditFromPopover}
              onclickSlot={handleSlotClick}
              onclickAllDay={handleAllDayClick}
              ondragCreate={handleDragCreate}
              onclickDate={handleDateClick}
              oncontextEvent={handleEventContext}
              onhoverSlot={(d) => hoveredSlot = d}
            />
          {:else if view.currentView === 'month'}
            <MonthView
              events={visibleEvents}
              onclickEvent={handleEventClick}
            />
          {:else if view.currentView === 'day'}
            <DayView
              events={visibleEvents}
              tasks={taskStore.items}
              onclickEvent={handleEventClick}
              oneditEvent={handleEditFromPopover}
              onclickSlot={handleSlotClick}
              onclickAllDay={handleAllDayClick}
              ondragCreate={handleDragCreate}
              onclickDate={handleDateClick}
              oncontextEvent={handleEventContext}
              onhoverSlot={(d) => hoveredSlot = d}
            />
          {/if}
        {/if}
      </main>
    </div>
    <MobileBottomNav
      onsettings={() => showSettings = true}
      onsearch={() => showSearch = true}
      onhelp={() => showShortcuts = true}
    />
  </div>

  <!-- Popover -->
  {#if popoverEvent}
    <EventPopover
      event={popoverEvent}
      position={popoverPosition}
      onclose={() => popoverEvent = null}
      onedit={handleEditFromPopover}
      onmore={(ev, pos) => {
        // Don't close the popover here — the user expects the card to stay
        // visible while the action menu is open. The context menu's own
        // click-outside-to-close handler will dismiss it without affecting
        // the popover. Closing the popover would also re-trigger the
        // event chip's hover state and feel jarring.
        contextEvent = ev;
        contextPosition = pos;
      }}
    />
  {/if}

  <!-- Context menu. Note: the popover stays mounted underneath while the
       menu is open (see onmore handler above) so the user sees the card
       they're acting on. We only close the popover when the menu commits
       to a transition (open editor, delete, …), not when it dismisses. -->
  {#if contextEvent}
    <EventContextMenu
      event={contextEvent}
      position={contextPosition}
      onclose={() => contextEvent = null}
      onedit={(ev) => {
        contextEvent = null;
        popoverEvent = null;
        editorEvent = ev;
        showEditor = true;
      }}
    />
  {/if}

  <!-- Editor -->
  {#if showEditor}
    <EventEditor
      event={editorEvent}
      defaultStart={editorDefaultStart}
      defaultEnd={editorDefaultEnd}
      onclose={() => showEditor = false}
    />
  {/if}

  <!-- Settings (lazy-loaded — heavy with all the tabs) -->
  {#if showSettings && Settings}
    <Settings
      initialTab={pendingSettingsTab}
      onclose={() => { showSettings = false; pendingSettingsTab = null; }}
      onopenFeedback={() => { showSettings = false; showFeedback = true; }}
    />
  {/if}

  <!-- Deleted-record viewer (lazy) -->
  {#if deletedRecord && DeletedRecordViewer}
    <DeletedRecordViewer
      activityId={deletedRecord.id}
      resource={deletedRecord.resource}
      resourceId={deletedRecord.resourceId}
      op={deletedRecord.op}
      label={deletedRecord.label}
      createdAt={deletedRecord.createdAt}
      onclose={() => deletedRecord = null}
    />
  {/if}

  <!-- Shortcuts help (lazy) -->
  {#if showShortcuts && ShortcutsHelp}
    <ShortcutsHelp onclose={() => showShortcuts = false} />
  {/if}

  <!-- Goto date (lazy) -->
  {#if showGotoDate && GotoDate}
    <GotoDate
      currentDate={view.currentDate}
      anchor={gotoDateAnchor}
      onclose={() => { showGotoDate = false; gotoDateAnchor = null; }}
      ongo={handleGotoDate}
    />
  {/if}

  <!-- Feedback (footer button + Settings → Help link) -->
  {#if showFeedback}
    <FeedbackModal onclose={() => showFeedback = false} />
  {/if}

  <!-- Event search overlay (Cmd+F) -->
  {#if showSearch}
    <SearchOverlay onclose={() => showSearch = false} />
  {/if}

  <!-- Find a time modal (F shortcut) -->
  {#if showFindTime}
    <FindTimeModal
      onclose={() => showFindTime = false}
      onpick={({ start, end }) => {
        editorEvent = null;
        editorDefaultStart = start;
        editorDefaultEnd = end;
        showEditor = true;
      }}
    />
  {/if}

  <!-- Today / synthesis overlay (Y shortcut) -->
  {#if showTodayPanel && TodayPanel}
    <svelte:component this={TodayPanel} onclose={() => showTodayPanel = false} />
  {/if}

  <!-- Task editor -->
  {#if editorTask}
    <TaskEditor task={editorTask} onclose={() => editorTask = null} />
  {/if}

  <!-- Note editor -->
  {#if editorNote}
    <NoteEditor note={editorNote} onclose={() => editorNote = null} />
  {/if}

  <!-- Booking page editor -->
  {#if editorBookingPage && BookingPageEditor}
    <BookingPageEditor page={editorBookingPage} onclose={() => editorBookingPage = null} />
  {/if}

  <!-- Global confirm modal (replaces window.confirm) -->
  <ConfirmRoot />
  <!-- Recurring-event scope picker (Edit/Delete this/following/series) -->
  <ScopeModalRoot />
  <!-- Plan-required upgrade modal -->
  <UpgradeRoot />
  <!-- Bottom-center toast stack (success / error / undo) -->
  <ToastRoot />
  <!-- Founder-only inbox widget (gated server-side via /api/founder-thoughts/whoami) -->
  <FounderThoughtsWidget />
{/if}

<style>
  .loading-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 16px;
    color: var(--text-secondary);
    font-size: 14px;
  }

  .loading-spinner {
    width: 28px;
    height: 28px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Indeterminate progress bar pinned to the top of the viewport while
     events are fetching. Mirrors the Gmail/GCal "something is loading"
     pattern — visible but non-blocking. */
  .top-progress {
    position: fixed;
    top: 0; left: 0; right: 0;
    height: 2px;
    z-index: 9999;
    overflow: hidden;
    background: color-mix(in oklab, var(--accent) 18%, transparent);
    pointer-events: none;
  }
  .top-progress-bar {
    position: absolute;
    inset: 0;
    width: 35%;
    background: var(--accent);
    border-radius: 2px;
    animation: top-progress-slide 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }
  @keyframes top-progress-slide {
    0%   { left: -35%; }
    100% { left: 100%; }
  }

  .app-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .app-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* Mobile + small tablet: leave room for the fixed bottom-nav so the
     calendar/list doesn't disappear behind it. Threshold matches
     MobileBottomNav (768px). 56px nav height + iOS safe-area inset. */
  @media (max-width: 768px) {
    .app-body {
      padding-bottom: calc(56px + env(safe-area-inset-bottom, 0));
    }
  }

  .lazy-loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    font-size: 13px;
  }

  .main-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* Dark theme overrides when class-based */
  :global(html.dark) {
    --accent: #60a5fa;
    --accent-hover: #93bbfd;
    --accent-light: #1e3a5f;
    --bg: #0f1115;
    --bg-secondary: #1a1d23;
    --bg-tertiary: #23272e;
    --border: #2d3139;
    --border-light: #23272e;
    --text-primary: #e8eaed;
    --text-secondary: #9ca3af;
    --text-tertiary: #6b7280;
    --text-inverse: #1a1a1a;
    --surface: #1a1d23;
    --surface-hover: #23272e;
    --surface-active: #2d3139;
    --surface-elevated: #23272e;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
    --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.4);
    --color-sky: #1e3a5f;
    --color-lavender: #3b2d5e;
    --color-rose: #5e2d3d;
    --color-peach: #5e3d1e;
    --color-mint: #1e4d2e;
    --color-sage: #2d4e3b;
    --color-butter: #4e4a1e;
    --color-coral: #5e3028;
    --color-lilac: #3e2d5e;
    --color-cloud: #3a3d42;
    --color-powder: #1e3d5e;
    --color-blush: #5e2d38;
  }

  :global(html.light) {
    color-scheme: light;
    --accent: #3b82f6;
    --accent-hover: #2563eb;
    --accent-light: #dbeafe;
    --bg: #ffffff;
    --bg-secondary: #f8f9fa;
    --bg-tertiary: #f1f3f5;
    --border: #e2e5e9;
    --border-light: #eef0f2;
    --text-primary: #1a1a1a;
    --text-secondary: #6b7280;
    --text-tertiary: #9ca3af;
    --text-inverse: #ffffff;
    --surface: #ffffff;
    --surface-hover: #f8f9fa;
    --surface-active: #f1f3f5;
    --surface-elevated: #ffffff;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
    --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12);
    --color-sky: #dbeafe;
    --color-lavender: #e8e0f0;
    --color-rose: #fce4ec;
    --color-peach: #fff0e0;
    --color-mint: #d4edda;
    --color-sage: #e0ede4;
    --color-butter: #fff9c4;
    --color-coral: #ffe0d6;
    --color-lilac: #f0e6ff;
    --color-cloud: #e8eaed;
    --color-powder: #e0f2fe;
    --color-blush: #fde2e8;
  }

  :global(html.dark) {
    color-scheme: dark;
  }
</style>
