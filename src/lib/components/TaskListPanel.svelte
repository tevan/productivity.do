<script>
  // Shared task list panel — group-by tabs, multi-select with bulk action
  // bar, and grouped/sub-grouped rendering of TaskRow. Used by both:
  //   - Sidebar.svelte (compact mode, draggable rows for calendar drop)
  //   - TasksView.svelte (full holistic Tasks view in list mode)
  //
  // Behavior baked in here so both consumers get the same rich interactions
  // (shift-range select, cmd-toggle, complete/today/tomorrow/no-date/delete
  // bulk actions). The host passes `compact` to switch density.

  import { getContext } from 'svelte';
  import TaskRow from './TaskRow.svelte';
  import { marquee } from '../actions/marquee.js';
  import { getTasks, completeTask, updateTask, deleteTask } from '../stores/tasks.svelte.js';
  import { getPrefs, updatePref } from '../stores/prefs.svelte.js';
  import { buildTaskGroups, withSubtaskOrder } from '../utils/taskGrouping.js';
  import { addDays } from '../utils/dates.js';
  import { tooltip } from '../actions/tooltip.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';

  let {
    compact = false,                // true = sidebar density, false = full view
    showGroupByTabs = true,         // render the group-by tab strip
    draggable = false,              // enable drag-from-list to all-day-row
    emptyMessage = 'No tasks',
  } = $props();

  // Compact mode (sidebar) collapses long task lists to keep what's
  // beneath the panel — calendars, sets, etc. — discoverable. The user can
  // expand to see all, then collapse back. Threshold matches roughly the
  // first viewport-fold worth of rows in compact mode.
  const COLLAPSED_TASK_LIMIT = 8;
  let expanded = $state(false);

  const taskStore = getTasks();
  const prefs = getPrefs();
  const app = getContext('app');

  const taskGroupBy = $derived(prefs.values.taskGroupBy || 'date');
  // Sidebar's TasksSidebarSection (in Tasks holistic view) writes the active
  // project filter into prefs.values.tasksFilterProjectId. Honor it here so
  // both the sidebar and the holistic Tasks list reflect the chosen project.
  const filterProjectId = $derived(prefs.values.tasksFilterProjectId || null);
  const tasks = $derived(
    taskStore.items.filter(t =>
      !t.isCompleted && (!filterProjectId || t.projectId === filterProjectId)
    )
  );
  const taskGroups = $derived(buildTaskGroups(tasks, taskGroupBy));
  const enabledGroupBys = $derived(
    (prefs.values.taskGroupByOptions && prefs.values.taskGroupByOptions.length > 0)
      ? prefs.values.taskGroupByOptions
      : ['date']
  );
  const groupByLabels = { date: 'Date', project: 'Project', label: 'Label', priority: 'Priority' };

  // Multi-select. Mirrors the previous Sidebar behavior so existing muscle
  // memory keeps working: shift-click extends, cmd/ctrl-click toggles, plain
  // click opens the editor (and clears any selection).
  let selectedIds = $state(new Set());
  let lastClickedId = $state(null);

  // Flat ordered list of currently rendered task ids (in DOM order) for
  // shift-range computations.
  const orderedTaskIds = $derived.by(() => {
    const ids = [];
    for (const g of taskGroups) {
      if (g.subgroups) {
        for (const sub of g.subgroups) {
          for (const t of sub.tasks) ids.push(t.id);
        }
      } else {
        for (const t of g.tasks) ids.push(t.id);
      }
    }
    return ids;
  });

  // Total task count and whether to apply the truncation/fade. Only
  // engages in `compact` (sidebar) mode and only when there are more than
  // COLLAPSED_TASK_LIMIT tasks total.
  const totalTaskCount = $derived(orderedTaskIds.length);
  const shouldTruncate = $derived(compact && !expanded && totalTaskCount > COLLAPSED_TASK_LIMIT);
  // Map a task id to its 0-indexed position so we can hide rows past the
  // limit without mangling the group structure (groups stay intact; rows
  // past the cutoff just hide via CSS).
  const taskPosition = $derived.by(() => {
    const m = new Map();
    orderedTaskIds.forEach((id, i) => m.set(id, i));
    return m;
  });
  function isHidden(taskId) {
    return shouldTruncate && (taskPosition.get(taskId) ?? Infinity) >= COLLAPSED_TASK_LIMIT;
  }

  function handleTaskClick(task, e) {
    if (e.shiftKey && lastClickedId) {
      const ids = orderedTaskIds;
      const a = ids.indexOf(lastClickedId);
      const b = ids.indexOf(task.id);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        const next = new Set(selectedIds);
        for (let i = from; i <= to; i++) next.add(ids[i]);
        selectedIds = next;
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedIds);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      selectedIds = next;
      lastClickedId = task.id;
      return;
    }
    if (selectedIds.size > 0) {
      selectedIds = new Set();
    }
    lastClickedId = task.id;
    app?.editTask?.(task);
  }

  function clearSelection() {
    selectedIds = new Set();
    lastClickedId = null;
  }

  // Marquee callback. `append` is true when the user held shift/cmd/ctrl
  // on mousedown (extends current selection); otherwise replaces.
  function onMarquee(ids, append) {
    if (ids.length === 0) {
      if (!append) clearSelection();
      return;
    }
    const next = append ? new Set(selectedIds) : new Set();
    for (const id of ids) next.add(id);
    selectedIds = next;
    lastClickedId = ids[ids.length - 1];
  }

  async function bulkComplete() {
    const ids = [...selectedIds];
    clearSelection();
    await Promise.all(ids.map(id => completeTask(id)));
  }
  async function bulkRescheduleToday() {
    const today = new Date().toISOString().slice(0, 10);
    const ids = [...selectedIds];
    clearSelection();
    await Promise.all(ids.map(id => updateTask(id, { dueDate: today })));
  }
  async function bulkRescheduleTomorrow() {
    const tomorrow = addDays(new Date(), 1).toISOString().slice(0, 10);
    const ids = [...selectedIds];
    clearSelection();
    await Promise.all(ids.map(id => updateTask(id, { dueDate: tomorrow })));
  }
  async function bulkClearDate() {
    const ids = [...selectedIds];
    clearSelection();
    await Promise.all(ids.map(id => updateTask(id, { dueDate: '' })));
  }
  async function bulkDelete() {
    const ids = [...selectedIds];
    if (prefs.values.confirmDeleteTask !== false) {
      if (!await confirmAction({
        title: `Delete ${ids.length} task${ids.length === 1 ? '' : 's'}?`,
        confirmLabel: 'Delete',
        danger: true,
      })) return;
    }
    clearSelection();
    await Promise.all(ids.map(id => deleteTask(id)));
  }
</script>

<div class="task-list-panel" class:compact>
  {#if showGroupByTabs}
    <div class="task-controls">
      <span class="control-label">Group by</span>
      <div class="group-by-tabs">
        {#each enabledGroupBys as val}
          <button
            class="group-tab"
            class:active={taskGroupBy === val}
            onclick={() => updatePref('taskGroupBy', val)}
          >{groupByLabels[val]}</button>
        {/each}
      </div>
    </div>
  {/if}

  {#if selectedIds.size > 0}
    <div class="bulk-bar">
      <span class="bulk-count">{selectedIds.size} selected</span>
      <button class="bulk-btn" onclick={bulkComplete} use:tooltip={'Complete'}>✓</button>
      <button class="bulk-btn" onclick={bulkRescheduleToday} use:tooltip={'Move to today'}>Today</button>
      <button class="bulk-btn" onclick={bulkRescheduleTomorrow} use:tooltip={'Move to tomorrow'}>Tomorrow</button>
      <button class="bulk-btn" onclick={bulkClearDate} use:tooltip={'Clear due date'}>No date</button>
      <button class="bulk-btn bulk-btn-danger" onclick={bulkDelete} use:tooltip={'Delete'}>Delete</button>
      <button class="bulk-btn-clear" onclick={clearSelection} use:tooltip={'Clear selection'}>×</button>
    </div>
  {/if}

  <div
    class="task-list"
    use:marquee={{
      itemSelector: '.task-row',
      getId: el => el.dataset.taskId,
      onSelect: onMarquee,
    }}
  >
    {#if taskStore.loading && tasks.length === 0}
      <p class="empty-text">Loading tasks…</p>
    {:else if taskGroups.length === 0}
      <p class="empty-text">{emptyMessage}</p>
    {:else}
      {#each taskGroups as group (group.label)}
        <div class="task-group">
          <div class="task-group-header" class:overdue={group.isOverdue}>
            {group.label}
            <span class="group-count">{group.tasks?.length ?? 0}</span>
          </div>
          {#if group.subgroups}
            {#each group.subgroups as sub (sub.label)}
              <div class="task-subgroup">
                <div class="task-subgroup-header">{sub.label}</div>
                {#each withSubtaskOrder(sub.tasks) as { task, indent } (task.id)}
                  <div class="task-row-wrap" class:hidden-task={isHidden(task.id)}>
                    <TaskRow {task} {indent} {compact} {draggable} onclickTask={handleTaskClick} selected={selectedIds.has(task.id)} />
                  </div>
                {/each}
              </div>
            {/each}
          {:else}
            {#each withSubtaskOrder(group.tasks) as { task, indent } (task.id)}
              <div class="task-row-wrap" class:hidden-task={isHidden(task.id)}>
                <TaskRow {task} {indent} {compact} {draggable} onclickTask={handleTaskClick} selected={selectedIds.has(task.id)} />
              </div>
            {/each}
          {/if}
        </div>
      {/each}
      {#if compact && totalTaskCount > COLLAPSED_TASK_LIMIT}
        {#if shouldTruncate}
          <!-- Fade overlay sits above the last visible row in compact view
               so the cutoff feels intentional rather than abrupt. -->
          <div class="fade-overlay" aria-hidden="true"></div>
        {/if}
        <button class="show-more" onclick={() => expanded = !expanded}>
          {#if expanded}
            Show less
          {:else}
            Show {totalTaskCount - COLLAPSED_TASK_LIMIT} more
          {/if}
        </button>
      {/if}
    {/if}
  </div>
</div>

<style>
  .task-list-panel { display: flex; flex-direction: column; min-height: 0; position: relative; }
  .task-list { display: flex; flex-direction: column; gap: 2px; flex: 1; min-height: 0; position: relative; }
  .task-list-panel.compact .task-list { gap: 1px; }

  .task-row-wrap.hidden-task { display: none; }
  /* The fade is positioned above the bottom-most visible rows so the
     transition from "your tasks" → "more below" reads as a continuation,
     not a hard truncation. ~28px is roughly two compact rows. */
  .fade-overlay {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 28px; /* sits just above the show-more button */
    height: 36px;
    background: linear-gradient(to bottom, transparent, var(--bg-primary));
    pointer-events: none;
  }
  .show-more {
    background: none;
    border: none;
    padding: 6px 10px;
    margin-top: 2px;
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-sm);
    width: 100%;
  }
  .show-more:hover { background: var(--surface-hover); }

  .task-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px 6px;
    border-bottom: 1px solid var(--border-light);
  }
  .control-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
  }
  .group-by-tabs { display: flex; gap: 2px; }
  .group-tab {
    background: none;
    border: 1px solid transparent;
    padding: 3px 8px;
    font-size: 11px;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .group-tab:hover { color: var(--text-primary); background: var(--surface-hover); }
  .group-tab.active {
    color: var(--accent);
    background: var(--accent-light);
    border-color: var(--accent);
  }

  .bulk-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--accent-light);
    border-bottom: 1px solid var(--border-light);
    flex-wrap: wrap;
  }
  .bulk-count {
    font-size: 11px;
    color: var(--accent);
    font-weight: 600;
    margin-right: 4px;
  }
  .bulk-btn {
    padding: 3px 8px;
    font-size: 11px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .bulk-btn:hover { border-color: var(--accent); color: var(--accent); }
  .bulk-btn-danger { color: var(--error, #d33); }
  .bulk-btn-danger:hover { background: var(--error, #d33); color: white; border-color: var(--error, #d33); }
  .bulk-btn-clear {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 6px;
    margin-left: auto;
  }

  .task-group { display: flex; flex-direction: column; }
  .task-group-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 8px 8px 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
  }
  .task-group-header.overdue { color: var(--error, #d33); }
  .group-count {
    font-size: 10px;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
  }
  .task-subgroup { padding-left: 4px; }
  .task-subgroup-header {
    font-size: 10px;
    color: var(--text-tertiary);
    padding: 4px 4px 2px;
  }
  .empty-text {
    font-size: 12px;
    color: var(--text-tertiary);
    padding: 16px;
    text-align: center;
  }
</style>
