<script>
  import { getContext, tick } from 'svelte';
  import { getHourSlots, isToday, isSameDay, formatTime, getDayName } from '../utils/dates.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { getCalendars } from '../stores/calendars.svelte.js';
  import { getEventColor, darkenColor, readableText, readableSubtext, resolveCssVar } from '../utils/colors.js';
  import { updateEvent, applyLocalPatch, deleteEvent } from '../stores/events.svelte.js';
  import { getTasks, updateTask } from '../stores/tasks.svelte.js';
  import AllDayRow from './AllDayRow.svelte';
  import WeatherRow from './WeatherRow.svelte';
  import TimezoneBar from './TimezoneBar.svelte';
  import { createDragHandler, createEventDragHandler } from '../utils/drag.js';
  import { getFocusBlocks, focusBlocksForDate } from '../stores/focusBlocks.svelte.js';
  import { getIsDark } from '../utils/theme.svelte.js';
  import { getTravelBlocks } from '../stores/travel.svelte.js';
  import { tooltip } from '../actions/tooltip.js';
  import { createLink } from '../stores/links.svelte.js';
  import {
    SLOT_MINUTES, SLOTS_PER_DAY,
    slotIndexForDate, slotToHM, dateAtSlot,
    ariaSlotLabel, ariaEventLabel,
    slotKeyAction, eventKeyAction, clampGridFocus,
  } from '../utils/timegridKeyboard.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';

  const focusStore = getFocusBlocks();
  const travelStore = getTravelBlocks();
  void focusStore.items; // ensure rune dep so re-renders pick up new blocks

  let {
    dates = [],
    events = [],
    tasks = [],
    onclickEvent = () => {},
    oneditEvent = () => {},
    onclickSlot = () => {},
    onclickAllDay = () => {},
    ondragCreate = () => {},
    onclickDate = () => {},
    oncontextEvent = () => {},
    onhoverSlot = () => {},
  } = $props();

  const prefs = getPrefs();
  const cals = getCalendars();
  const hours = getHourSlots();
  const is12h = $derived(prefs.values.timeFormat === '12h');
  // Use the shared theme util so isDark stays consistent across the app.
  const darkRef = getIsDark();
  const isDark = $derived(darkRef.value);
  const appCtx = getContext('app');
  const additionalTimezones = $derived(prefs.values.additionalTimezones || []);

  let gridEl = $state(null);
  let scrollContainer = $state(null);
  let dayColumnsEl = $state(null);

  // Scroll to last-saved position (or current hour) on mount
  const SCROLL_KEY = 'productivity_grid_scroll';
  $effect(() => {
    if (!scrollContainer) return;
    let target = -1;
    try {
      const v = localStorage.getItem(SCROLL_KEY);
      if (v != null) target = parseInt(v);
    } catch {}
    if (isNaN(target) || target < 0) {
      const now = new Date();
      target = Math.max(0, now.getHours() * 48 - 100);
    }
    scrollContainer.scrollTop = target;

    // Persist scroll updates (debounced)
    let scrollTimer;
    const onScroll = () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        try { localStorage.setItem(SCROLL_KEY, String(scrollContainer.scrollTop)); } catch {}
      }, 150);
    };
    scrollContainer.addEventListener('scroll', onScroll);
    return () => {
      scrollContainer?.removeEventListener('scroll', onScroll);
      clearTimeout(scrollTimer);
    };
  });

  // Current time indicator
  let nowMinutes = $state(new Date().getHours() * 60 + new Date().getMinutes());
  $effect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      nowMinutes = now.getHours() * 60 + now.getMinutes();
    }, 60000);
    return () => clearInterval(interval);
  });

  const nowTop = $derived((nowMinutes / 60) * 48);
  const todayIndex = $derived(dates.findIndex(d => isToday(d)));

  // Filter timed events (non all-day)
  const timedEvents = $derived(events.filter(e => !e.allDay));

  // Timed tasks (those with a dueDatetime) — render as small chips on the
  // grid so the user can drag-reschedule them between time slots without
  // round-tripping through the editor. Tasks without a time stay in the
  // all-day row.
  const tasksLive = $derived(getTasks().items);
  const timedTasks = $derived(tasksLive.filter(t => !t.isCompleted && t.dueDatetime));
  function tasksForDate(date) {
    return timedTasks.filter(t => {
      const d = new Date(t.dueDatetime);
      return d.toDateString() === date.toDateString();
    });
  }
  function taskMinutes(t) {
    const d = new Date(t.dueDatetime);
    return d.getHours() * 60 + d.getMinutes();
  }
  function handleTaskChipDragStart(e, task) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-task-id', String(task.id));
    e.dataTransfer.setData('text/plain', task.content || '');
  }

  // --- Keyboard navigation (WCAG 2.1.1 — full keyboard support for the grid)
  //
  // Roving-tabindex pattern per WAI-ARIA grid spec: only one element inside
  // the grid is in the tab order at a time. Arrow keys move focus within
  // the grid; Tab leaves the grid entirely. Mode (slot vs event) is
  // determined by which DOM element is currently focused — we don't
  // duplicate it as state. focusedDay/focusedSlot are the tabstop *target*
  // for empty cells; focusedEventId is the tabstop target when an event
  // chip is roving.
  let focusedDay = $state(0);
  let focusedSlot = $state(slotIndexForDate(new Date()));
  // Event id (NOT calendarId+id composite) — used to render exactly one
  // event chip with tabindex=0 at any time. When null and no event is
  // focused, the slot at [focusedDay, focusedSlot] gets the tabstop.
  let focusedEventId = $state(null);
  // Polite-mode aria-live region content. Cleared after announcements so
  // repeated identical actions ("moved by 15 minutes") still fire SR
  // updates instead of being ignored as duplicates.
  let liveAnnouncement = $state('');
  let liveTimer = null;
  // Whenever the visible day-range shrinks (e.g. switching from Week to Day
  // view), clamp the tabstop so the focusable hour-slot is still rendered.
  // Otherwise the user's first Tab into the grid lands on nothing.
  $effect(() => {
    if (dates.length === 0) return;
    if (focusedDay >= dates.length) focusedDay = dates.length - 1;
    if (focusedDay < 0) focusedDay = 0;
  });
  function announce(msg) {
    liveAnnouncement = '';
    // queueMicrotask so the empty string actually flushes before the new
    // one (otherwise SRs treat it as no change). Then a longer delay
    // before clearing so users with slow SRs hear the full message.
    queueMicrotask(() => { liveAnnouncement = msg; });
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { liveAnnouncement = ''; }, 4000);
  }

  // Move focus to a specific slot. Components are looked up via data
  // attributes rather than refs — refs would require a 2D Map keyed by
  // (day, slot) which adds bookkeeping for marginal gain.
  async function focusSlotEl(dayIdx, slotIdx) {
    focusedDay = dayIdx;
    focusedSlot = slotIdx;
    focusedEventId = null;
    await tick();
    const sel = `[data-grid-slot="${dayIdx}-${slotIdx}"]`;
    const el = gridEl?.querySelector(sel);
    if (el) {
      el.focus({ preventScroll: false });
      // Auto-scroll the slot into view if the user navigated off-screen.
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  async function focusEventEl(eventKey) {
    // eventKey is `${calendarId}|${id}` so two events with colliding ids
    // across calendars don't fight over the same DOM target.
    focusedEventId = eventKey;
    await tick();
    const el = gridEl?.querySelector(`[data-grid-event="${CSS.escape(String(eventKey))}"]`);
    if (el) el.focus({ preventScroll: false });
  }
  function eventKeyFor(event) { return `${event.calendarId}|${event.id}`; }

  function handleGridSlotKeydown(e, dayIdx, slotIdx) {
    const action = slotKeyAction(e, { slotIdx, dayIdx, dayCount: dates.length });
    if (!action) return;
    e.preventDefault();
    if (action.type === 'noop') return;
    if (action.type === 'move') {
      const next = clampGridFocus(
        { dayIdx: dayIdx + action.dayDelta, slotIdx: slotIdx + action.slotDelta },
        { dayCount: dates.length },
      );
      focusSlotEl(next.dayIdx, next.slotIdx);
      const date = dates[next.dayIdx];
      announce(ariaSlotLabel(date, next.slotIdx, is12h));
      return;
    }
    if (action.type === 'create') {
      const d = dateAtSlot(dates[dayIdx], slotIdx);
      onclickSlot(d);
    }
  }

  async function handleEventKeydown(e, event) {
    const action = eventKeyAction(e, {
      snapMinutes: prefs.values.dragSnapMinutes || 15,
    });
    if (!action) return;
    e.preventDefault();
    if (action.type === 'edit') { oneditEvent(event); return; }
    if (action.type === 'context') {
      // Synthesize a position-aware event so the existing context menu
      // anchors correctly even though there's no mouse position.
      const el = gridEl?.querySelector(`[data-grid-event="${CSS.escape(eventKeyFor(event))}"]`);
      const rect = el?.getBoundingClientRect();
      const fakeEvent = {
        clientX: rect ? rect.left + 8 : 0,
        clientY: rect ? rect.bottom + 4 : 0,
        preventDefault: () => {},
        stopPropagation: () => {},
      };
      oncontextEvent(event, fakeEvent);
      return;
    }
    if (action.type === 'escape') {
      // Move focus back to the slot under the event's start time.
      const start = new Date(event.start);
      const dayIdx = dates.findIndex(d => isSameDay(d, start));
      if (dayIdx >= 0) focusSlotEl(dayIdx, slotIndexForDate(start));
      return;
    }
    if (action.type === 'delete') {
      const ok = await confirmAction({
        title: 'Delete event?',
        body: `"${event.summary || '(No title)'}" will be removed from your calendar.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      announce(`Deleted ${event.summary || 'event'}`);
      // After delete, return focus to the surrounding slot before the
      // chip disappears from the DOM (otherwise focus jumps to <body>).
      const start = new Date(event.start);
      const dayIdx = dates.findIndex(d => isSameDay(d, start));
      if (dayIdx >= 0) focusSlotEl(dayIdx, slotIndexForDate(start));
      await deleteEvent(event.calendarId, event.id);
      return;
    }
    if (action.type === 'move' || action.type === 'resize') {
      const start = new Date(event.start);
      const end = new Date(event.end);
      const minDelta = action.minuteDelta || 0;
      const dayDelta = action.dayDelta || 0;
      let newStart, newEnd;
      if (action.type === 'resize') {
        newStart = start;
        newEnd = new Date(end.getTime() + minDelta * 60000);
        // Don't allow zero/negative duration.
        if (newEnd.getTime() - newStart.getTime() < 5 * 60000) return;
      } else {
        newStart = new Date(start.getTime() + minDelta * 60000);
        newEnd = new Date(end.getTime() + minDelta * 60000);
        if (dayDelta) {
          newStart.setDate(newStart.getDate() + dayDelta);
          newEnd.setDate(newEnd.getDate() + dayDelta);
        }
      }
      const isoStart = newStart.toISOString();
      const isoEnd = newEnd.toISOString();
      // Optimistic patch — same pattern as drag onCommit.
      applyLocalPatch(event.id, { start: isoStart, end: isoEnd });
      announce(action.type === 'resize'
        ? `Resized to end at ${formatTime(newEnd, is12h)}`
        : `Moved to ${ariaEventLabel({ ...event, start: isoStart, end: isoEnd }, is12h)}`);
      try {
        await updateEvent(event.calendarId, event.id, {
          summary: event.summary,
          start: isoStart,
          end: isoEnd,
          allDay: false,
          location: event.location,
          description: event.description,
          calendarId: event.calendarId,
        });
      } catch (err) {
        announce('Could not update event. Reverting.');
        applyLocalPatch(event.id, { start: event.start, end: event.end });
      }
    }
  }

  // --- Event drag/resize state ---
  let dragPreview = $state(null); // { eventId, start, end, mode }
  let suppressClickFor = null;    // event id for which we just dragged (suppress next click)

  // --- Inline title editing ---
  let editingId = $state(null);
  let editingValue = $state('');

  function beginInlineEdit(event, e) {
    e.stopPropagation();
    e.preventDefault();
    editingId = event.id;
    editingValue = event.summary || '';
  }

  async function commitInlineEdit(event) {
    const newTitle = (editingValue || '').trim();
    const id = editingId;
    editingId = null;
    if (!newTitle || newTitle === (event.summary || '')) return;
    await updateEvent(event.calendarId, event.id, {
      summary: newTitle,
      start: event.start,
      end: event.end,
      allDay: !!event.allDay,
      location: event.location,
      description: event.description,
      calendarId: event.calendarId,
    });
  }

  function cancelInlineEdit() {
    editingId = null;
    editingValue = '';
  }

  function inlineKey(e, event) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitInlineEdit(event);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelInlineEdit();
    }
  }

  function getDayAtX(clientX) {
    if (!dayColumnsEl) return null;
    const cols = dayColumnsEl.querySelectorAll('.day-column');
    for (let i = 0; i < cols.length; i++) {
      const r = cols[i].getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) {
        return dates[i];
      }
    }
    // Clamp to nearest edge column
    if (cols.length > 0) {
      const first = cols[0].getBoundingClientRect();
      const last = cols[cols.length - 1].getBoundingClientRect();
      if (clientX < first.left) return dates[0];
      if (clientX > last.right) return dates[dates.length - 1];
    }
    return null;
  }

  const eventDrag = createEventDragHandler({
    onPreview: ({ event, start, end, mode }) => {
      dragPreview = { eventId: event.id, start, end, mode };
    },
    onCommit: async ({ event, start, end }) => {
      const id = event.id;
      suppressClickFor = id;
      setTimeout(() => { if (suppressClickFor === id) suppressClickFor = null; }, 200);
      const isoStart = start.toISOString();
      const isoEnd = end.toISOString();
      // No change? Clear preview immediately.
      if (new Date(event.start).getTime() === start.getTime() &&
          new Date(event.end).getTime() === end.getTime()) {
        dragPreview = null;
        return;
      }
      // Optimistic update — write the new times directly to the events
      // store before the network round-trip. Without this, dragPreview
      // does the heavy lifting via an `eventsForDate` override; once we
      // clear dragPreview in `finally`, render briefly reads the still-
      // old events array and the chip flashes back to the original spot
      // before the awaited PUT response lands and corrects it.
      // updateEvent() also patches the events array on the server's
      // response, which makes our optimistic write a no-op when the
      // server agrees, or a self-correction when the server returns a
      // different value (e.g. recurrence rounding).
      applyLocalPatch(event.id, { start: isoStart, end: isoEnd });
      try {
        await updateEvent(event.calendarId, event.id, {
          summary: event.summary,
          start: isoStart,
          end: isoEnd,
          allDay: false,
          location: event.location,
          description: event.description,
          calendarId: event.calendarId,
        });
      } finally {
        dragPreview = null;
      }
    },
    onCancel: () => {
      dragPreview = null;
    },
  });

  function handleEventMouseDown(e, event) {
    // Don't drag if clicking the join button
    if (e.target.closest('.join-btn')) return;
    eventDrag.startDrag(e, event, 'move', { getDayAtX });
  }

  // --- Drop tasks/notes onto an event to create a link ---
  // The dataTransfer types used elsewhere are application/x-task-id and
  // application/x-note-id. We accept either and persist the relationship
  // via the links store (no mutation to the source records).
  let dropTargetEventId = $state(null);
  function isLinkableDrag(e) {
    const types = e.dataTransfer?.types || [];
    return types.includes('application/x-task-id') || types.includes('application/x-note-id');
  }
  function handleEventDragOver(e, event) {
    if (!isLinkableDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
    dropTargetEventId = event.id;
  }
  function handleEventDragLeave() {
    dropTargetEventId = null;
  }
  async function handleEventDrop(e, event) {
    if (!isLinkableDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dropTargetEventId = null;
    const taskId = e.dataTransfer.getData('application/x-task-id');
    const noteId = e.dataTransfer.getData('application/x-note-id');
    const fromType = taskId ? 'task' : 'note';
    const fromId = taskId || noteId;
    if (!fromId) return;
    await createLink(fromType, fromId, 'event', `${event.calendarId}|${event.id}`);
  }

  function handleResizeMouseDown(e, event) {
    e.stopPropagation();
    eventDrag.startDrag(e, event, 'resize', { getDayAtX });
  }

  // Drop a task on an empty time slot in the grid → set dueDatetime to that
  // exact time (snapped to dragSnapMinutes). Drop on an event chip still
  // creates a link (handleEventDrop above stops propagation, so column-level
  // drop only fires on empty space). Same column-Y math as event drag.
  let taskDropTarget = $state(null); // { date, minutes } | null
  function isTaskDrag(e) {
    const types = e.dataTransfer?.types || [];
    return types.includes('application/x-task-id');
  }
  function minutesFromDayColumnY(e) {
    // The day-column has top-padding 0; first hour-slot starts at y=0.
    // Each hour is 48px tall; snap to dragSnapMinutes (default 30).
    const col = e.currentTarget;
    const rect = col.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minutes = Math.max(0, Math.min(24 * 60 - 15, (y / 48) * 60));
    const snap = prefs.values.dragSnapMinutes || 30;
    return Math.round(minutes / snap) * snap;
  }
  function handleColumnDragOver(e, date) {
    if (!isTaskDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    taskDropTarget = { date: date.toDateString(), minutes: minutesFromDayColumnY(e) };
  }
  function handleColumnDragLeave() {
    taskDropTarget = null;
  }
  async function handleColumnDrop(e, date) {
    if (!isTaskDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const taskId = e.dataTransfer.getData('application/x-task-id');
    const minutes = minutesFromDayColumnY(e);
    taskDropTarget = null;
    if (!taskId) return;
    const tasksStore = getTasks();
    const task = tasksStore.items.find(t => String(t.id) === String(taskId));
    if (!task) return;
    // Compose YYYY-MM-DDTHH:MM:00 in local time and let updateTask round-trip
    // to Todoist's due_datetime field.
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mi = String(minutes % 60).padStart(2, '0');
    await updateTask(task.id, { dueDatetime: `${yyyy}-${mm}-${dd}T${hh}:${mi}:00`, dueDate: null });
  }

  // Events for a specific date — taking drag preview into account
  function eventsForDate(date) {
    return timedEvents
      .map(e => {
        if (dragPreview && dragPreview.eventId === e.id) {
          return { ...e, start: dragPreview.start, end: dragPreview.end };
        }
        return e;
      })
      .filter(e => isSameDay(new Date(e.start), date));
  }

  // Position an event
  function eventStyle(event) {
    const start = new Date(event.start);
    const end = new Date(event.end);
    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = end.getHours() * 60 + end.getMinutes();
    const top = (startMin / 60) * 48;
    // Shave 2px off the bottom so back-to-back events show a thin visual gap
    // between them (Google Calendar / Fantastical do the same). Floor at 20px
    // so very short events (<10min) don't collapse.
    const height = Math.max(((endMin - startMin) / 60) * 48 - 2, 20);
    return `top: ${top}px; height: ${height}px;`;
  }

  function eventDurationMin(event) {
    return (new Date(event.end) - new Date(event.start)) / 60000;
  }

  // Handle overlapping events. Earlier we computed totalCols as the daily
  // column count, which made every event use the same width even when they
  // didn't overlap each other. Now we group events into "clusters" (chains
  // of mutual overlap) and size events relative to their cluster only —
  // matching how Google Calendar behaves.
  function layoutEvents(dateEvents) {
    if (dateEvents.length === 0) return [];

    const sorted = [...dateEvents].sort((a, b) => new Date(a.start) - new Date(b.start));

    const result = [];
    let cluster = []; // events in the current overlap chain
    let clusterEndMs = 0;

    const flushCluster = () => {
      if (!cluster.length) return;
      // Greedy column assignment within the cluster only.
      const columns = [];
      const placement = new Map();
      for (const ev of cluster) {
        const es = new Date(ev.start).getTime();
        let placed = false;
        for (let col = 0; col < columns.length; col++) {
          const lastInCol = columns[col][columns[col].length - 1];
          if (new Date(lastInCol.end).getTime() <= es) {
            columns[col].push(ev);
            placement.set(ev, col);
            placed = true;
            break;
          }
        }
        if (!placed) {
          placement.set(ev, columns.length);
          columns.push([ev]);
        }
      }
      const totalCols = columns.length;
      for (const ev of cluster) {
        const col = placement.get(ev);
        result.push({
          event: ev,
          left: `${(col / totalCols) * 100}%`,
          width: `${(1 / totalCols) * 100}%`,
        });
      }
    };

    for (const ev of sorted) {
      const es = new Date(ev.start).getTime();
      const ee = new Date(ev.end).getTime();
      if (cluster.length === 0 || es < clusterEndMs) {
        cluster.push(ev);
        clusterEndMs = Math.max(clusterEndMs, ee);
      } else {
        flushCluster();
        cluster = [ev];
        clusterEndMs = ee;
      }
    }
    flushCluster();
    return result;
  }

  // Drag to create. We track a live preview band so the user sees what
  // duration they're selecting; without this they drag blind and can only
  // tell the duration after the editor opens.
  let createPreview = $state(null); // { date, startMinutes, endMinutes }
  const dragHandler = createDragHandler({
    minDurationMinutes: prefs.values.defaultEventDuration || 30,
    snapMinutes: prefs.values.dragSnapMinutes || 30,
    onDragStart: (data) => {
      createPreview = { date: data.date, startMinutes: data.startMinutes, endMinutes: data.endMinutes };
    },
    onDragMove: (data) => {
      createPreview = { date: data.date, startMinutes: data.startMinutes, endMinutes: data.endMinutes };
    },
    onDragEnd: (data) => {
      createPreview = null;
      if (data.cancelled) return;
      ondragCreate(data);
    },
  });

  // Cancel preview if mouse leaves window without releasing on the grid.
  // (Mouseup outside is already wired in createDragHandler, but guard
  // against the preview band lingering if onDragEnd never fires.)
  function clearCreatePreview() { createPreview = null; }

  function handleSlotClick(date, hour) {
    const d = new Date(date);
    d.setHours(hour, 0, 0, 0);
    onclickSlot(d);
  }

  function handleSlotMouseDown(e, date) {
    if (gridEl) {
      dragHandler.handleMouseDown(e, date, gridEl);
    }
  }

  function handleSlotHover(date, hour) {
    const d = new Date(date);
    d.setHours(hour, 0, 0, 0);
    onhoverSlot(d);
  }
  function handleSlotLeave() {
    onhoverSlot(null);
  }

  // Sub-hour hover band that matches the duration of the event a click will
  // create. 30-min default → 24px tall, 60-min → 48px, etc. The start position
  // snaps to dragSnapMinutes so the band lines up with where a drag would
  // begin.
  let hoverBand = $state(null); // { date, startMinutes }
  function handleColumnMouseMove(e, date) {
    if (prefs.values.showHoverSlot === false) return;
    const col = e.currentTarget;
    const rect = col.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minutes = Math.max(0, Math.min(24 * 60, (y / 48) * 60));
    const snap = prefs.values.dragSnapMinutes || 30;
    const startMinutes = Math.floor(minutes / snap) * snap;
    if (!hoverBand || hoverBand.date !== date || hoverBand.startMinutes !== startMinutes) {
      hoverBand = { date, startMinutes };
    }
  }
  function handleColumnMouseLeave() {
    hoverBand = null;
    onhoverSlot(null);
  }

  function handleEventClickGuarded(event, e) {
    if (suppressClickFor === event.id) return;
    onclickEvent(event, e);
  }
</script>

<div class="time-grid-wrapper">
  <!--
    Polite-mode live region for keyboard-driven navigation feedback. When
    the user moves between slots or nudges an event, a description like
    "9:30 AM, Tuesday May 12" or "Moved to ..." is written here so screen
    readers narrate the change. visually-hidden so sighted users don't
    see it. role=status (polite) lets the SR finish current speech first,
    avoiding chatter on rapid arrow-presses.
  -->
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
    {liveAnnouncement}
  </div>

  <!-- Header -->
  <div class="grid-header" style="--cols: {dates.length}">
    <div class="hour-gutter-header"></div>
    {#each dates as date, i}
      <button class="day-header" class:today={isToday(date)} onclick={() => onclickDate(date)} use:tooltip={isToday(date) ? 'Jump to today' : 'Switch to this day'}>
        <span class="day-name">{getDayName(date)}</span>
        <span class="day-number" class:today={isToday(date)}>{date.getDate()}</span>
      </button>
    {/each}
  </div>

  <!-- Weather -->
  <div class="top-row" style="--cols: {dates.length}">
    <div class="hour-gutter-spacer"></div>
    <WeatherRow {dates} />
  </div>

  <!-- Combined all-day + per-column-tasks row -->
  <AllDayRow {dates} {events} {tasks} onclickEvent={onclickEvent} onclickEmpty={onclickAllDay} />

  <!-- Time grid body -->
  <div class="grid-scroll" bind:this={scrollContainer}>
    <div class="grid-body" bind:this={gridEl} style="--cols: {dates.length}">
      <!-- Hour labels -->
      <div class="hour-gutter">
        {#each hours as hour}
          <div class="hour-label">
            {#if hour > 0}
              <span>{formatTime(new Date(2020, 0, 1, hour), is12h)}</span>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Additional timezone columns -->
      {#each additionalTimezones as tz}
        <TimezoneBar timezone={tz} />
      {/each}

      <!-- Day columns -->
      <!--
        Accessibility: this is the WAI-ARIA grid surface. Each day-column is a
        row, each hour-slot is a gridcell. Roving tabindex means only one
        descendant has tabindex=0 at a time; arrow keys move it. See
        ../utils/timegridKeyboard.js for the key→action mapping.
      -->
      <div
        class="day-columns"
        bind:this={dayColumnsEl}
        style="--cols: {dates.length}"
        role="grid"
        aria-label="Calendar time grid. Use arrow keys to navigate, Enter to create an event, Tab to leave the grid."
        aria-rowcount={SLOTS_PER_DAY}
        aria-colcount={dates.length}
      >
      {#each dates as date, colIdx}
        <div
          class="day-column"
          class:today={isToday(date)}
          class:past={prefs.values.dimPastEvents && date < new Date() && !isToday(date)}
          class:task-drop-active={taskDropTarget?.date === date.toDateString()}
          onmousemove={(e) => handleColumnMouseMove(e, date)}
          onmouseleave={handleColumnMouseLeave}
          ondragover={(e) => handleColumnDragOver(e, date)}
          ondragleave={handleColumnDragLeave}
          ondrop={(e) => handleColumnDrop(e, date)}
          role="row"
          aria-rowindex={colIdx + 1}
          aria-label={new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date)}
        >
          <!-- Focus blocks (background bands) -->
          {#each focusBlocksForDate(date) as fb (fb.id)}
            {@const fbStart = parseInt(fb.startTime.slice(0, 2)) * 60 + parseInt(fb.startTime.slice(3, 5))}
            {@const fbEnd = parseInt(fb.endTime.slice(0, 2)) * 60 + parseInt(fb.endTime.slice(3, 5))}
            <div class="focus-band"
              style="top: {(fbStart / 60) * 48}px; height: {((fbEnd - fbStart) / 60) * 48}px;">
              <span class="focus-band-label">{fb.label}</span>
            </div>
          {/each}

          <!-- Drag-to-create live preview -->
          {#if createPreview && createPreview.date && new Date(createPreview.date).toDateString() === date.toDateString()}
            {@const cs = createPreview.startMinutes}
            {@const ce = createPreview.endMinutes}
            {@const durMin = Math.max(ce - cs, 15)}
            {@const csDate = (() => { const d = new Date(date); d.setHours(Math.floor(cs / 60), cs % 60, 0, 0); return d; })()}
            {@const ceDate = (() => { const d = new Date(date); d.setHours(Math.floor(ce / 60), ce % 60, 0, 0); return d; })()}
            <div class="create-preview"
              style="top: {(cs / 60) * 48}px; height: {(durMin / 60) * 48}px;">
              <span class="create-preview-label">
                {formatTime(csDate, is12h)} – {formatTime(ceDate, is12h)}
                <span class="create-preview-dur">({durMin} min)</span>
              </span>
            </div>
          {/if}

          <!-- Hover band — height matches defaultEventDuration so the visual
               feedback equals the event a click would create. -->
          {#if hoverBand && hoverBand.date === date && !createPreview && prefs.values.showHoverSlot !== false}
            {@const dur = prefs.values.defaultEventDuration || 30}
            <div class="hover-band"
              style="top: {(hoverBand.startMinutes / 60) * 48}px; height: {(dur / 60) * 48}px;"></div>
          {/if}

          <!-- Task drop preview — when the user is dragging a task over this
               column, show a thin highlighted band where it would land. -->
          {#if taskDropTarget?.date === date.toDateString()}
            {@const dur = prefs.values.defaultTaskDuration || prefs.values.defaultEventDuration || 30}
            <div class="task-drop-band"
              style="top: {(taskDropTarget.minutes / 60) * 48}px; height: {(dur / 60) * 48}px;"></div>
          {/if}

          <!-- Hour slots — one per hour, focusable via roving tabindex.
               Keyboard users land on these cells, then Enter/Space opens
               the new-event flow at that time. Mouse users keep using
               drag-to-create (handled by onmousedown). -->
          {#each hours as hour, slotIdx}
            <div
              class="hour-slot"
              class:no-hover={prefs.values.showHoverSlot === false}
              role="gridcell"
              aria-colindex={slotIdx + 1}
              tabindex={focusedEventId === null && focusedDay === colIdx && focusedSlot === slotIdx ? 0 : -1}
              data-grid-slot="{colIdx}-{slotIdx}"
              aria-label={ariaSlotLabel(date, slotIdx, is12h)}
              ondblclick={() => handleSlotClick(date, hour)}
              onclick={() => { focusedDay = colIdx; focusedSlot = slotIdx; focusedEventId = null; }}
              onmousedown={(e) => handleSlotMouseDown(e, date)}
              onmouseenter={() => prefs.values.showHoverSlot !== false && handleSlotHover(date, hour)}
              onmouseleave={handleSlotLeave}
              onkeydown={(e) => handleGridSlotKeydown(e, colIdx, slotIdx)}
              onfocus={() => { focusedDay = colIdx; focusedSlot = slotIdx; focusedEventId = null; }}
            ></div>
          {/each}

          <!-- Events -->
          {#each layoutEvents(eventsForDate(date)) as item}
            {@const _ = prefs.values.colorScheme}
            {@const color = getEventColor(item.event, cals.items)}
            {@const bgFallback = isDark ? color.dark : color.light}
            {@const resolvedBg = color.varName ? resolveCssVar(color.varName, bgFallback) : bgFallback}
            {@const bg = color.varName ? `var(${color.varName}, ${bgFallback})` : bgFallback}
            {@const textColor = readableText(resolvedBg)}
            {@const subtextColor = readableSubtext(resolvedBg)}
            {@const isShort = eventDurationMin(item.event) <= 30}
            {@const isDragging = dragPreview && dragPreview.eventId === item.event.id}
            {@const travel = travelStore.items[item.event.id]}
            {#if travel && prefs.values.showTravelBlocks !== false}
              {@const travelMin = travel.minutes ?? 15}
              {@const evStart = new Date(item.event.start)}
              {@const evMinOfDay = evStart.getHours() * 60 + evStart.getMinutes()}
              {@const travelTopMin = Math.max(evMinOfDay - travelMin, 0)}
              {@const travelHeight = (travelMin / 60) * 48}
              <div class="travel-block"
                style="top: {(travelTopMin / 60) * 48}px; height: {travelHeight}px; left: {item.left}; width: {item.width};"
                use:tooltip={`Travel from ${travel.originLabel} (~${travelMin}m)`}>
                <span class="travel-label">
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M3 11l6-5-6-5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  {travel.minutes ? `${travel.minutes}m` : '~'}
                </span>
              </div>
            {/if}
            {@const isEditing = editingId === item.event.id}
            {@const myRsvp = (item.event.attendees || []).find(a => a.self)?.responseStatus}
            {@const calName = cals.items.find(c => c.id === item.event.calendarId)?.summary || ''}
            {@const tipText = calName ? `${item.event.summary || '(No title)'}\n${calName}` : (item.event.summary || '')}
            <div
              class="event-positioned"
              class:dragging={isDragging}
              class:link-drop-target={dropTargetEventId === item.event.id}
              use:tooltip={tipText}
              style="{eventStyle(item.event)} left: {item.left}; width: {item.width};"
              role="gridcell"
              tabindex={focusedEventId === eventKeyFor(item.event) ? 0 : -1}
              data-grid-event={eventKeyFor(item.event)}
              aria-label={ariaEventLabel(item.event, is12h) +
                '. Press Enter to edit, arrows to move, Alt+arrow to resize, Delete to remove.'}
              onmousedown={(e) => { if (!isEditing) handleEventMouseDown(e, item.event); }}
              onclick={(e) => { e.stopPropagation(); if (!isEditing) handleEventClickGuarded(item.event, e); }}
              ondblclick={(e) => { e.stopPropagation(); e.preventDefault(); oneditEvent(item.event); }}
              oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); oncontextEvent(item.event, e); }}
              onkeydown={(e) => { if (!isEditing) handleEventKeydown(e, item.event); }}
              onfocus={() => { focusedEventId = eventKeyFor(item.event); }}
              ondragover={(e) => handleEventDragOver(e, item.event)}
              ondragleave={handleEventDragLeave}
              ondrop={(e) => handleEventDrop(e, item.event)}
            >
              <div
                class="event-block"
                class:compact={isShort}
                class:tentative={myRsvp === 'tentative'}
                class:declined={myRsvp === 'declined'}
                style="background: {bg}; border-left: 3px solid {darkenColor(bgFallback, 0.3)};"
              >
                {#if isEditing}
                  <input
                    class="event-inline-input"
                    style="color: {textColor}"
                    bind:value={editingValue}
                    onkeydown={(e) => inlineKey(e, item.event)}
                    onblur={() => commitInlineEdit(item.event)}
                    onclick={(e) => e.stopPropagation()}
                    onmousedown={(e) => e.stopPropagation()}
                    autofocus
                  />
                {:else if isShort}
                  <span class="event-block-inline" style="color: {textColor}">
                    <span class="event-block-time-inline" style="color: {subtextColor}">{formatTime(item.event.start, is12h)}</span>
                    {item.event.summary || '(No title)'}
                  </span>
                {:else}
                  <span class="event-block-time" style="color: {subtextColor}">{formatTime(item.event.start, is12h)}</span>
                  <span class="event-block-title" style="color: {textColor}">{item.event.summary || '(No title)'}</span>
                  {#if item.event.location}
                    <span class="event-block-location" style="color: {subtextColor}">{item.event.location}</span>
                  {/if}
                {/if}
                <!-- Resize handle -->
                {#if !isEditing}
                  <div
                    class="event-resize-handle"
                    onmousedown={(e) => handleResizeMouseDown(e, item.event)}
                  ></div>
                {/if}
              </div>
            </div>
          {/each}

          <!-- Timed task chips: thin overlay positioned by dueDatetime.
               Draggable so the user can re-time across the grid or drop on
               the all-day row to clear the time. Click opens the editor.
               Keyboard: Enter opens the editor. Arrow navigation continues
               to traverse hour slots (chips are a secondary surface). -->
          {#each tasksForDate(date) as task (task.id)}
            {@const m = taskMinutes(task)}
            {@const dur = task.estimatedMinutes || prefs.values.defaultTaskDuration || 30}
            <div
              class="task-chip"
              role="button"
              tabindex="0"
              aria-label={`Task: ${task.content}. Press Enter to edit.`}
              draggable="true"
              ondragstart={(e) => handleTaskChipDragStart(e, task)}
              onclick={(e) => { e.stopPropagation(); appCtx?.editTask?.(task); }}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  appCtx?.editTask?.(task);
                }
              }}
              style="top: {(m / 60) * 48}px; height: {Math.max((dur / 60) * 48, 18)}px;"
              use:tooltip={task.content}
            >
              <svg width="9" height="9" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.4"/>
                <path d="M4.5 7l2 2 3.5-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="task-chip-label">{task.content}</span>
            </div>
          {/each}

          <!-- Current time line -->
          {#if colIdx === todayIndex && todayIndex >= 0}
            <div class="now-line" style="top: {nowTop}px">
              <div class="now-dot"></div>
            </div>
          {/if}
        </div>
      {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .time-grid-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .grid-header {
    display: flex;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    background: var(--surface);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .hour-gutter-header {
    width: 56px;
    flex-shrink: 0;
  }

  .hour-gutter-spacer {
    width: 56px;
    flex-shrink: 0;
  }

  .day-header {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px 0 4px;
    min-width: 0;
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    font: inherit;
    border-radius: var(--radius-sm);
  }
  .day-header:hover {
    background: var(--surface-hover);
  }

  .day-name {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .day-header.today .day-name { color: var(--accent); }

  .day-number {
    font-size: 22px;
    font-weight: 300;
    color: var(--text-primary);
    line-height: 1.2;
  }
  .day-number.today {
    background: var(--accent);
    color: var(--text-inverse);
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-weight: 500;
    font-size: 16px;
  }

  .top-row {
    display: flex;
    flex-shrink: 0;
  }

  .grid-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .grid-body {
    display: flex;
    position: relative;
    min-height: calc(24 * 48px);
  }

  .hour-gutter {
    width: 56px;
    flex-shrink: 0;
  }

  .hour-label {
    height: 48px;
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    padding-right: 8px;
  }

  .hour-label span {
    font-size: 11px;
    color: var(--text-tertiary);
    transform: translateY(-7px);
    white-space: nowrap;
  }

  .day-columns {
    flex: 1;
    display: flex;
    min-width: 0;
  }

  .day-column {
    flex: 1;
    position: relative;
    border-left: 1px solid color-mix(in srgb, var(--border-light) 60%, transparent);
    min-width: 0;
  }
  .day-column.today { opacity: 1; background: color-mix(in srgb, var(--accent-light) 8%, transparent); }
  .day-column.past { opacity: 0.6; }
  .focus-band {
    position: absolute;
    left: 2px;
    right: 2px;
    background: repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 8%, transparent) 0 8px,
      color-mix(in srgb, var(--accent) 14%, transparent) 8px 16px
    );
    border-left: 2px solid var(--accent);
    border-radius: 4px;
    pointer-events: none;
    z-index: 0;
  }
  .focus-band-label {
    position: absolute;
    top: 2px;
    left: 6px;
    font-size: 10px;
    font-weight: 600;
    color: var(--accent);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    opacity: 0.85;
  }

  .travel-block {
    position: absolute;
    background: repeating-linear-gradient(
      45deg,
      color-mix(in srgb, var(--text-tertiary) 22%, transparent) 0 4px,
      color-mix(in srgb, var(--text-tertiary) 14%, transparent) 4px 8px
    );
    border-radius: 4px 4px 0 0;
    pointer-events: none;
    z-index: 0;
    overflow: hidden;
  }
  .travel-label {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    font-weight: 500;
    color: var(--text-secondary);
    padding: 2px 6px;
    white-space: nowrap;
  }

  .create-preview {
    position: absolute;
    left: 2px;
    right: 2px;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    border: 1.5px solid var(--accent);
    border-radius: 4px;
    pointer-events: none;
    z-index: 5;
    display: flex;
    align-items: flex-start;
    padding: 4px 6px;
  }
  .create-preview-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    white-space: nowrap;
  }
  .create-preview-dur {
    font-weight: 400;
    margin-left: 4px;
    opacity: 0.75;
  }

  .hour-slot {
    height: 48px;
    border-bottom: 1px solid color-mix(in srgb, var(--border-light) 50%, transparent);
    cursor: pointer;
    transition: background 0.08s;
    /* Outline rather than border on focus: no layout shift. Inset slightly
       so the ring isn't bisected by the row divider above/below. */
    outline: none;
  }
  .hour-slot:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
    background: color-mix(in srgb, var(--accent-light) 35%, transparent);
    z-index: 3;
    position: relative;
  }
  /* Visually-hidden utility for the aria-live region. Position absolute so
     it's removed from layout but still in the accessibility tree. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  /* Hover bg is now drawn by .hover-band (sub-hour, snap-aware). The
     hour-slot stays as a click/drag target only. */
  .hover-band {
    position: absolute;
    left: 0;
    right: 0;
    background: color-mix(in srgb, var(--accent-light) 55%, transparent);
    pointer-events: none;
    z-index: 1;
    border-radius: 2px;
  }
  .task-drop-band {
    position: absolute;
    left: 2px;
    right: 2px;
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    border: 1.5px dashed var(--accent);
    pointer-events: none;
    z-index: 4;
    border-radius: 4px;
  }
  .task-chip {
    position: absolute;
    left: 2px;
    right: 2px;
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 500;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    border-left: 3px solid var(--accent);
    cursor: grab;
    overflow: hidden;
  }
  .task-chip:active { cursor: grabbing; }
  .task-chip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    z-index: 6;
  }
  .task-chip:hover {
    background: color-mix(in srgb, var(--accent) 14%, var(--surface));
  }
  .task-chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .day-column.task-drop-active {
    background: color-mix(in srgb, var(--accent) 4%, transparent);
  }

  .event-positioned {
    position: absolute;
    z-index: 5;
    padding: 0 2px;
    box-sizing: border-box;
    cursor: grab;
    outline: none;
  }
  .event-positioned:active { cursor: grabbing; }
  /* When a keyboard user focuses an event chip, draw a ring AROUND the
     chip's border-left bar (which is the visual "this is an event" cue).
     Use focus-visible so mouse users don't see a halo on every click. */
  .event-positioned:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
    z-index: 25;
  }
  .event-positioned.link-drop-target {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    border-radius: var(--radius-sm);
  }
  .event-positioned.dragging {
    z-index: 20;
    opacity: 0.85;
    box-shadow: var(--shadow-md);
  }

  .event-block {
    position: relative;
    height: 100%;
    border-radius: var(--radius-sm);
    padding: 3px 6px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .event-block.compact {
    flex-direction: row;
    align-items: center;
    padding: 1px 6px;
  }

  /* RSVP "maybe": diagonal stripes + dashed border. */
  .event-block.tentative {
    background-image: repeating-linear-gradient(
      135deg,
      transparent 0 6px,
      rgba(255,255,255,0.18) 6px 10px
    ) !important;
    border-left-style: dashed !important;
    opacity: 0.85;
  }
  /* RSVP "no": muted + strikethrough. */
  .event-block.declined { opacity: 0.5; }
  .event-block.declined .event-block-title,
  .event-block.declined .event-block-inline { text-decoration: line-through; }

  .event-block-inline {
    font-size: 11px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .event-block-time-inline {
    font-size: 10px;
    font-weight: 500;
    margin-right: 4px;
  }

  .event-block-time {
    font-size: 10px;
    font-weight: 500;
  }

  .event-block-title {
    font-size: 12px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .event-block-location {
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .event-inline-input {
    width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    font-size: 12px;
    font-weight: 500;
    color: inherit;
    outline: none;
    font-family: inherit;
  }

  .event-resize-handle {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 8px;
    cursor: ns-resize;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 2px;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .event-resize-handle::after {
    content: '';
    width: 22px;
    height: 3px;
    border-radius: 2px;
    background: currentColor;
    opacity: 0.45;
  }
  .event-positioned:hover .event-resize-handle { opacity: 1; }
  .event-resize-handle:hover { background: rgba(0, 0, 0, 0.05); }
  .event-resize-handle:hover::after { opacity: 0.7; }

  .now-line {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 8;
    height: 2px;
    background: var(--error);
    pointer-events: none;
  }

  .now-dot {
    position: absolute;
    left: -5px;
    top: -4px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--error);
  }
</style>
