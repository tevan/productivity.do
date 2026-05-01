<script>
  import { getContext } from 'svelte';
  import EventChip from './EventChip.svelte';
  import TaskRow from './TaskRow.svelte';
  import { isSameDay, addDays, parseAllDayDate, parseTaskDue } from '../utils/dates.js';
  import { updateEvent, applyLocalPatch } from '../stores/events.svelte.js';
  import { updateTask } from '../stores/tasks.svelte.js';
  import { tooltip } from '../actions/tooltip.js';
  import { createLink } from '../stores/links.svelte.js';

  let { dates = [], events = [], tasks = [], onclickEvent = () => {}, onclickEmpty = () => {} } = $props();

  // App-level context exposes editTask() — used so clicking a task in the
  // calendar opens the TaskEditor modal, matching the sidebar behavior.
  const appCtx = getContext('app');
  function handleTaskClick(task) {
    appCtx?.editTask?.(task);
  }

  let gridEl = $state(null);
  let dragShift = $state(null); // { eventId, deltaDays }
  let taskDragShift = $state(null); // { taskId, deltaDays }
  let suppressClick = null;
  let suppressTaskClick = null;

  function fmtLocalDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function handleTaskMouseDown(e, task) {
    if (e.button !== 0) return;
    if (!gridEl) return;
    // Don't start a drag from the checkbox.
    if (e.target.closest('.task-checkbox')) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = gridEl.getBoundingClientRect();
    const colWidth = rect.width / Math.max(1, dates.length);
    const startX = e.clientX;
    let moved = false;

    function move(moveE) {
      const dx = moveE.clientX - startX;
      if (!moved && Math.abs(dx) < 4) return;
      moved = true;
      const delta = Math.round(dx / colWidth);
      taskDragShift = { taskId: task.id, deltaDays: delta };
    }

    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      const finalShift = taskDragShift;
      taskDragShift = null;
      if (!moved || !finalShift || finalShift.deltaDays === 0) return;

      suppressTaskClick = task.id;
      setTimeout(() => { if (suppressTaskClick === task.id) suppressTaskClick = null; }, 200);

      const due = parseTaskDue(task);
      if (!due) return;
      const newDue = addDays(due, finalShift.deltaDays);
      if (task.dueDatetime) {
        // Preserve time-of-day for datetime tasks.
        const iso = `${fmtLocalDate(newDue)}T${String(due.getHours()).padStart(2,'0')}:${String(due.getMinutes()).padStart(2,'0')}:00`;
        updateTask(task.id, { dueDatetime: iso });
      } else {
        updateTask(task.id, { dueDate: fmtLocalDate(newDue) });
      }
    }

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function handleTaskClickGuarded(task) {
    if (suppressTaskClick === task.id) return;
    appCtx?.editTask?.(task);
  }

  let dropTargetCol = $state(-1);

  function colFromX(clientX) {
    if (!gridEl) return -1;
    const rect = gridEl.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right) return -1;
    const colWidth = rect.width / Math.max(1, dates.length);
    return Math.max(0, Math.min(dates.length - 1, Math.floor((clientX - rect.left) / colWidth)));
  }

  function handleGridDragOver(e) {
    // The dragged item is identified at drop time by reading `application/x-task-id`.
    // We unconditionally preventDefault() on dragover so the browser allows
    // a drop; the drop handler bails out cleanly if no task id is present
    // (e.g. for native browser drags from the OS).
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dropTargetCol = colFromX(e.clientX);
  }
  function handleGridDragEnter(e) {
    e.preventDefault();
  }

  function handleGridDragLeave(e) {
    // Only clear when leaving the grid itself, not when crossing into a child.
    if (!gridEl) return;
    const rect = gridEl.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      dropTargetCol = -1;
    }
  }

  function handleAllDayClick(e) {
    // Only fire if the click landed on the grid background, not on a chip,
    // task row, or drop highlight.
    if (e.target.closest('.cell-task, .allday-event, .more-btn')) return;
    const colIdx = colFromX(e.clientX);
    if (colIdx < 0) return;
    const target = dates[colIdx];
    if (target) onclickEmpty(target);
  }

  function handleGridDrop(e) {
    e.preventDefault();
    const taskId = e.dataTransfer?.getData('application/x-task-id');
    // Recompute column from the actual drop coordinates — don't rely on
    // dropTargetCol, which can be stale or never set if dragover didn't
    // fire on the grid (e.g. the user dragged over a child element the
    // whole time).
    const colIdx = colFromX(e.clientX);
    dropTargetCol = -1;
    if (!taskId || colIdx < 0) return;
    const target = dates[colIdx];
    if (!target) return;
    const task = tasks.find(t => String(t.id) === String(taskId));
    if (!task) return;
    const newDate = fmtLocalDate(target);
    // Dropping into the all-day row means "make this an all-day task on
    // this date" — even if the source had a time. The mirror operation
    // (TimeGrid drop) sets a specific time. Users get a clean way to
    // promote/demote between timed and all-day by dragging back and forth.
    updateTask(task.id, { dueDate: newDate, dueDatetime: null });
  }

  // 3 rows on desktop, 2 on mobile/small-tablet so the all-day stack doesn't
  // crowd the first day-column when weather + working-location + chips all
  // stack. Threshold matches the bottom-nav breakpoint (768px).
  const MAX_VISIBLE_ROWS = $derived.by(() => {
    if (typeof window === 'undefined') return 3;
    return window.innerWidth < 768 ? 2 : 3;
  });

  // Multi-day events render in the top row(s); single-day below. Within each
  // group preserve original order (start time ascending). Stable via index.
  const allDayEvents = $derived(
    events
      .filter(e => e.allDay)
      .map((e, i) => ({ e, i }))
      .sort((a, b) => {
        const aSpan = a.e.start && a.e.end ? Math.max(1, Math.round((parseAllDayDate(a.e.end) - parseAllDayDate(a.e.start)) / 86400000)) : 1;
        const bSpan = b.e.start && b.e.end ? Math.max(1, Math.round((parseAllDayDate(b.e.end) - parseAllDayDate(b.e.start)) / 86400000)) : 1;
        if (aSpan !== bSpan) return bSpan - aSpan; // longer span first
        return a.i - b.i;
      })
      .map(({ e }) => e)
  );

  let expanded = $state(false);

  function getSpanForEvent(event, dates) {
    // All-day events come from Google as YYYY-MM-DD with EXCLUSIVE end
    // (a 1-day event on Apr 30 returns end=May 1). Parse as local midnight
    // so the day-cell match works regardless of tz, then subtract one day
    // from end for inclusive span calculation.
    let eStart = event.allDay ? parseAllDayDate(event.start) : new Date(event.start);
    let eEndExclusive = event.allDay ? parseAllDayDate(event.end) : new Date(event.end);
    if (dragShift && dragShift.eventId === event.id) {
      eStart = addDays(eStart, dragShift.deltaDays);
      eEndExclusive = addDays(eEndExclusive, dragShift.deltaDays);
    }
    const startIdx = dates.findIndex(d => isSameDay(d, eStart) || d >= eStart);
    // For all-day, last visible day is the one BEFORE eEndExclusive.
    const eLastDay = event.allDay ? addDays(eEndExclusive, -1) : eEndExclusive;
    const lastIdx = (() => {
      for (let i = dates.length - 1; i >= 0; i--) {
        if (event.allDay ? isSameDay(dates[i], eLastDay) || dates[i] <= eLastDay : dates[i] < eEndExclusive) return i;
      }
      return -1;
    })();
    // If the event's last day is before the visible range start, it doesn't
    // render in this view. (Without this guard, events ending right at the
    // view-start boundary — e.g. an all-day event with end=2026-04-30 in a
    // view that starts on 2026-04-30 — incorrectly snap to the first column.)
    if (lastIdx < 0 || startIdx < 0) return { startCol: 0, span: 0 };
    const si = Math.max(0, startIdx);
    const ei = lastIdx + 1;
    return { startCol: si, span: Math.max(1, ei - si) };
  }

  function handleAllDayMouseDown(e, event) {
    if (e.button !== 0) return;
    if (!gridEl) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = gridEl.getBoundingClientRect();
    const colWidth = rect.width / Math.max(1, dates.length);
    const startX = e.clientX;
    let moved = false;

    function move(moveE) {
      const dx = moveE.clientX - startX;
      if (!moved && Math.abs(dx) < 4) return;
      moved = true;
      let delta = Math.round(dx / colWidth);
      // Clamp so the event stays partially visible
      dragShift = { eventId: event.id, deltaDays: delta };
    }

    function up(upE) {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      const finalShift = dragShift;
      dragShift = null;
      if (!moved || !finalShift || finalShift.deltaDays === 0) return;

      // Suppress the click that follows mouseup
      suppressClick = event.id;
      setTimeout(() => { if (suppressClick === event.id) suppressClick = null; }, 200);

      const newStart = addDays(new Date(event.start), finalShift.deltaDays);
      const newEnd = addDays(new Date(event.end), finalShift.deltaDays);
      // Optimistic — see note in TimeGrid#onCommit. Without this, releasing
      // the drag clears `dragShift` and the chip flashes back to the
      // original day for a frame before the network response arrives.
      applyLocalPatch(event.id, {
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
      });
      updateEvent(event.calendarId, event.id, {
        summary: event.summary,
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
        allDay: true,
        location: event.location,
        description: event.description,
        calendarId: event.calendarId,
      });
    }

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function handleChipClick(event, e) {
    if (suppressClick === event.id) return;
    onclickEvent(event, e);
  }

  // Drop tasks/notes onto an all-day event to link them.
  let linkDropEventId = $state(null);
  function isLinkableDrag(e) {
    const types = e.dataTransfer?.types || [];
    return types.includes('application/x-task-id') || types.includes('application/x-note-id');
  }
  function handleAllDayEventDragOver(e, event) {
    if (!isLinkableDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
    linkDropEventId = event.id;
  }
  function handleAllDayEventDragLeave() { linkDropEventId = null; }
  async function handleAllDayEventDrop(e, event) {
    if (!isLinkableDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    linkDropEventId = null;
    const taskId = e.dataTransfer.getData('application/x-task-id');
    const noteId = e.dataTransfer.getData('application/x-note-id');
    const fromType = taskId ? 'task' : 'note';
    const fromId = taskId || noteId;
    if (!fromId) return;
    await createLink(fromType, fromId, 'event', `${event.calendarId}|${event.id}`);
  }

  // Tasks per column
  const tasksByCol = $derived.by(() => {
    return dates.map(d => tasks.filter(t => {
      const due = parseTaskDue(t);
      return due && isSameDay(due, d);
    }));
  });

  // Layout strategy (top-down):
  //   1. Multi-day events (span > 1) — top rows, easy to scan across the week.
  //   2. Tasks — middle, per-column, shifted below multi-day rows.
  //   3. Single-day events (span = 1) — below tasks.
  // Each layer reserves rows so the next can stack below it.
  const layout = $derived.by(() => {
    const placed = [];
    let multiDayMaxRow = -1;
    // Pass 1: multi-day events
    for (const event of allDayEvents) {
      const { startCol, span } = getSpanForEvent(event, dates);
      if (span <= 0 || span < 2) continue;
      let row = 0;
      while (placed.some(p => p.row === row && !(startCol >= p.startCol + p.span || startCol + span <= p.startCol))) {
        row++;
      }
      placed.push({ event, startCol, span, row });
      if (row > multiDayMaxRow) multiDayMaxRow = row;
    }
    const taskOffset = multiDayMaxRow + 1; // tasks start below multi-day block
    // Pass 2: single-day events. Floor = taskOffset + max task-count for spanned col.
    for (const event of allDayEvents) {
      const { startCol, span } = getSpanForEvent(event, dates);
      if (span <= 0 || span >= 2) continue;
      const taskCount = tasksByCol[startCol]?.length || 0;
      let row = taskOffset + taskCount;
      while (placed.some(p => p.row === row && !(startCol >= p.startCol + p.span || startCol + span <= p.startCol))) {
        row++;
      }
      placed.push({ event, startCol, span, row });
    }
    return placed;
  });
  // Tasks render at row (taskOffset + tIdx). Expose offset for the markup.
  const taskRowOffset = $derived.by(() => {
    let max = -1;
    for (const event of allDayEvents) {
      const { span } = getSpanForEvent(event, dates);
      if (span >= 2) {
        // Just need to know if any multi-day was placed; actual placement above.
      }
    }
    // Recompute from placed layout (cheap, matches Pass 1).
    let m = -1;
    for (const p of layout) {
      if (p.span >= 2 && p.row > m) m = p.row;
    }
    return m + 1;
  });

  // Maximum row used (for collapse threshold)
  const maxRow = $derived(
    layout.length > 0 ? Math.max(...layout.map(l => l.row)) : -1
  );

  // Total visual rows across the whole zone
  const totalRows = $derived.by(() => {
    const maxTaskRows = tasksByCol.length > 0
      ? Math.max(0, ...tasksByCol.map(c => c.length))
      : 0;
    return Math.max(maxTaskRows, maxRow + 1);
  });

  const collapseAt = MAX_VISIBLE_ROWS;
  const shouldCollapse = $derived(!expanded && totalRows > collapseAt);

  // When collapsed, hide rows >= collapseAt
  const visibleLayout = $derived(
    shouldCollapse ? layout.filter(l => l.row < collapseAt) : layout
  );
  const visibleTasksByCol = $derived(
    shouldCollapse
      ? tasksByCol.map(col => col.slice(0, collapseAt))
      : tasksByCol
  );
  const hiddenCount = $derived.by(() => {
    if (!shouldCollapse) return 0;
    const hiddenAll = layout.length - visibleLayout.length;
    let hiddenTasks = 0;
    for (const col of tasksByCol) {
      if (col.length > collapseAt) hiddenTasks += col.length - collapseAt;
    }
    return hiddenAll + hiddenTasks;
  });
</script>

{#if allDayEvents.length > 0 || tasks.some(t => t.dueDate) || tasks.length > 0}
  <div class="allday-zone" style="--cols: {dates.length}">
    <div class="hour-gutter-spacer"></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="allday-grid"
      bind:this={gridEl}
      ondragenter={handleGridDragEnter}
      ondragover={handleGridDragOver}
      ondragleave={handleGridDragLeave}
      ondrop={handleGridDrop}
      onclick={handleAllDayClick}
    >
      <!-- Drop highlight overlay (purely visual; pointer-events:none so it
           never intercepts clicks on the events/tasks above it). -->
      {#if dropTargetCol >= 0}
        <div
          class="drop-highlight"
          style="grid-column: {dropTargetCol + 1} / span 1; grid-row: 1 / -1"
        ></div>
      {/if}

      <!-- Tasks per column, anchored to row 1+ -->
      {#each visibleTasksByCol as colTasks, colIdx}
        {#each colTasks as task, tIdx (task.id)}
          {@const isShiftedTask = taskDragShift && taskDragShift.taskId === task.id}
          {@const shiftedCol = isShiftedTask ? Math.max(0, Math.min(dates.length - 1, colIdx + taskDragShift.deltaDays)) : colIdx}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="cell-task"
            class:dragging={isShiftedTask}
            style="grid-column: {shiftedCol + 1} / span 1; grid-row: {taskRowOffset + tIdx + 1}"
            onmousedown={(e) => handleTaskMouseDown(e, task)}
          >
            <TaskRow {task} compact onclickTask={handleTaskClickGuarded} />
          </div>
        {/each}
      {/each}

      <!-- All-day events spanning columns -->
      {#each visibleLayout as item}
        {@const isDragging = dragShift && dragShift.eventId === item.event.id}
        {@const isWL = item.event.eventType === 'workingLocation'}
        {#if isWL}
          <!-- Working-location: a thin soft bar across the whole span with
               an inline icon+label pill at the left. Single element so the
               label and tail never disconnect visually. -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="allday-event wl-bar"
            class:dragging={isDragging}
            class:wl-multi={item.span > 1}
            style="grid-column: {item.startCol + 1} / span {item.span}; grid-row: {item.row + 1}"
            use:tooltip={item.event.summary}
            onmousedown={(e) => handleAllDayMouseDown(e, item.event)}
            onclick={(e) => { e.stopPropagation(); handleChipClick(item.event, e); }}
          >
            <span class="wl-pill">
              <svg class="wl-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <span class="wl-label-text">{item.event.summary || 'Home'}</span>
            </span>
          </div>
        {:else}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="allday-event"
            class:dragging={isDragging}
            class:ooo={item.event.eventType === 'outOfOffice'}
            class:link-drop-target={linkDropEventId === item.event.id}
            style="grid-column: {item.startCol + 1} / span {item.span}; grid-row: {item.row + 1}"
            onmousedown={(e) => handleAllDayMouseDown(e, item.event)}
            ondragover={(e) => handleAllDayEventDragOver(e, item.event)}
            ondragleave={handleAllDayEventDragLeave}
            ondrop={(e) => handleAllDayEventDrop(e, item.event)}
          >
            <EventChip event={item.event} compact onclick={handleChipClick} />
          </div>
        {/if}
      {/each}

      {#if hiddenCount > 0 && !expanded}
        <button class="more-btn" onclick={() => expanded = true} use:tooltip={'Show all'}>
          +{hiddenCount} more
        </button>
      {:else if expanded}
        <button class="more-btn collapse" onclick={() => expanded = false} use:tooltip={'Collapse'}>
          Show less
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .allday-zone {
    display: flex;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border-light);
  }
  .hour-gutter-spacer {
    width: 56px;
    flex-shrink: 0;
  }
  .allday-grid {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-auto-rows: minmax(22px, auto);
    row-gap: 2px;
    column-gap: 0;
    padding: 2px 0;
    min-width: 0;
  }

  .cell-task {
    min-width: 0;
    overflow: hidden;
    cursor: grab;
    position: relative;
    z-index: 2;
    height: 22px;
    box-sizing: border-box;
    display: flex;
    align-items: stretch;
    border-radius: var(--radius-sm);
    /* Dashed look without using border (which would eat 2px and shift the
       inner text baseline relative to a sibling event chip on the same
       grid row). The dashed outline sits inside the box. */
    outline: 1px dashed var(--border);
    outline-offset: -1px;
    background: color-mix(in srgb, var(--surface-hover) 50%, transparent);
  }
  .cell-task :global(.task-row) {
    flex: 1;
    background: transparent !important;
    padding: 0 6px !important;
    min-width: 0;
    min-height: 0 !important;
    height: 100%;
    align-items: center;
    font-size: 12px;
    line-height: 1.3;
  }
  .cell-task :global(.task-checkbox) {
    width: 12px !important;
    height: 12px !important;
    flex-shrink: 0;
  }
  .cell-task:hover {
    outline-style: solid;
    background: var(--surface-hover);
  }
  .cell-task:active { cursor: grabbing; }
  .cell-task.dragging {
    opacity: 0.85;
    z-index: 10;
  }

  .drop-highlight {
    pointer-events: none;
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    outline: 2px dashed var(--accent);
    outline-offset: -2px;
    border-radius: var(--radius-sm);
    z-index: 0;
  }

  .allday-event {
    min-width: 0;
    cursor: grab;
    padding: 0 1px;
  }
  .allday-event:active { cursor: grabbing; }
  .allday-event.link-drop-target :global(.event-chip) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .allday-event.dragging {
    opacity: 0.85;
    z-index: 10;
  }
  .allday-event.ooo :global(.event-chip) {
    background: repeating-linear-gradient(45deg,
      color-mix(in srgb, #ef4444 30%, transparent) 0 6px,
      color-mix(in srgb, #ef4444 18%, transparent) 6px 12px) !important;
    color: #fff !important;
    border-left: 3px solid #ef4444 !important;
  }
  /* Working-location bar: soft green band across the full span, with an
     inline icon + label pill anchored to the left. Single element keeps
     the label and the cross-day indicator from ever disconnecting. */
  /* The bar background is thinner than the pill; the pill protrudes
     slightly above/below to keep the icon+label readable. */
  .allday-event.wl-bar {
    align-self: center;
    height: 12px;
    display: flex;
    align-items: center;
    background: color-mix(in srgb, #10b981 14%, transparent);
    border-radius: 6px;
    padding: 0 4px 0 0;
    cursor: pointer;
    overflow: visible;
    color: #047857;
  }
  :global(html.dark) .allday-event.wl-bar {
    background: color-mix(in srgb, #10b981 22%, transparent);
    color: #6ee7b7;
  }
  .allday-event.wl-bar:hover {
    background: color-mix(in srgb, #10b981 22%, transparent);
  }
  .wl-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 6px;
    height: 16px;
    border-radius: 8px;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
    background: var(--surface);
    flex-shrink: 0;
  }
  :global(html.dark) .wl-pill {
    background: color-mix(in srgb, var(--surface) 80%, transparent);
  }
  .wl-icon { flex-shrink: 0; }
  .wl-label-text {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .more-btn {
    grid-column: 1 / -1;
    justify-self: start;
    background: var(--surface);
    border: 1px solid var(--border);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 3px 10px;
    border-radius: 999px;
    line-height: 1.3;
    margin: 2px 0 0 4px;
  }
  .more-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-light); }
</style>
