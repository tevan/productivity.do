<script>
  // Holistic Tasks view — full-screen list / kanban for tasks.
  // See docs/internal/tasks-board.md for the design.
  //
  // Two modes: list (group by date/project/label/priority — same as sidebar)
  // and board (per-user customizable columns). Mode persists per form-factor
  // via tasksView_<desktop|mobile> server pref.

  import { getContext, onMount } from 'svelte';
  import { getTasks, moveTaskToColumn, reorderTasksInColumn, completeTask, updateTask, deleteTask } from '../stores/tasks.svelte.js';
  import { getTaskColumns, fetchTaskColumns, renameColumn, addColumn, removeColumn } from '../stores/taskColumns.svelte.js';
  import TaskListPanel from '../components/TaskListPanel.svelte';
  import Dropdown from '../components/Dropdown.svelte';
  import { getPrefs, updatePref } from '../stores/prefs.svelte.js';
  import { readLocalView, reconcileFromPrefs, writeView, getFormFactor } from '../utils/viewPersistence.js';
  import { tooltip } from '../actions/tooltip.js';
  import { marquee } from '../actions/marquee.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';
  import { renderInlineMarkdown } from '../utils/inlineMarkdown.js';
  import { parseTaskDue, addDays } from '../utils/dates.js';

  const taskStore = getTasks();
  const columnStore = getTaskColumns();
  const prefs = getPrefs();
  const app = getContext('app');

  // View mode (list/board) — server pref, per form factor.
  const VIEW_NAME = 'tasksView';
  const VALID_MODES = ['list', 'board'];
  let mode = $state(readLocalView(VIEW_NAME, VALID_MODES, 'list'));

  // After prefs load, reconcile to the server-side value if it differs.
  $effect(() => {
    if (prefs.values && Object.keys(prefs.values).length > 0) {
      const v = reconcileFromPrefs(prefs.values, VIEW_NAME, VALID_MODES, 'list');
      if (v !== mode) mode = v;
    }
  });

  function setMode(v) {
    if (!VALID_MODES.includes(v)) return;
    mode = v;
    writeView(VIEW_NAME, v);
  }

  onMount(() => { fetchTaskColumns(); });

  // Project filter (driven by the sidebar's TasksSidebarSection in Tasks view).
  // Same pref key as TaskListPanel so the list and board agree on what's shown.
  const filterProjectId = $derived(prefs.values.tasksFilterProjectId || null);
  const tasks = $derived(
    taskStore.items.filter(t =>
      !t.isCompleted && (!filterProjectId || t.projectId === filterProjectId)
    )
  );
  // All tasks (incl. completed) — for the Done column. Filter is still
  // applied so the Done column reflects the same project scope.
  const allTasks = $derived(
    taskStore.items.filter(t => !filterProjectId || t.projectId === filterProjectId)
  );
  // ---- Board multi-select ----
  // Mirrors TaskListPanel: shift-click extends, cmd/ctrl-click toggles, plain
  // click opens the editor (and clears any selection). Selection survives a
  // mode flip but is local to this view (the list inside TaskListPanel keeps
  // its own selection — they don't share, intentionally).
  let selectedIds = $state(new Set());
  let lastClickedId = $state(null);

  // Flat ordered list of task ids in DOM order (column-by-column, top-to-bottom)
  // for shift-range computations.
  const orderedBoardIds = $derived.by(() => {
    const ids = [];
    for (const col of columnStore.items) {
      for (const t of tasksForColumn(col)) ids.push(t.id);
    }
    return ids;
  });

  function handleBoardCardClick(task, e) {
    if (e.shiftKey && lastClickedId) {
      const ids = orderedBoardIds;
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
      if (next.has(task.id)) next.delete(task.id); else next.add(task.id);
      selectedIds = next;
      lastClickedId = task.id;
      return;
    }
    if (selectedIds.size > 0) { selectedIds = new Set(); }
    lastClickedId = task.id;
    app?.editTask?.(task);
  }

  function clearSelection() {
    selectedIds = new Set();
    lastClickedId = null;
  }

  function onBoardMarquee(ids, append) {
    if (ids.length === 0) {
      if (!append) clearSelection();
      return;
    }
    const next = append ? new Set(selectedIds) : new Set();
    for (const id of ids) next.add(id);
    selectedIds = next;
    lastClickedId = ids[ids.length - 1];
  }

  // ---- Bulk actions (board) ----
  // Same set as TaskListPanel + a board-specific "Move to column" via a
  // dropdown that reflects the user's columns.
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
  async function bulkMoveToColumn(statusKey) {
    if (statusKey === 'done') { await bulkComplete(); return; }
    const ids = [...selectedIds];
    clearSelection();
    await Promise.all(ids.map(id => moveTaskToColumn(id, statusKey)));
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

  // Board-card click handler — list view's clicks are owned by TaskListPanel.
  function handleClick(task) { app?.editTask?.(task); }

  // ---- Board: tasks per column ----
  // sortBy is per-column, stored in prefs as `taskBoardSort_<statusKey>`.
  // Defaults to 'manual' once the user has dragged anything in this column,
  // otherwise 'due'.
  function getColumnSort(statusKey) {
    return prefs.values[`taskBoardSort_${statusKey}`] || 'due';
  }
  function setColumnSort(statusKey, value) {
    updatePref(`taskBoardSort_${statusKey}`, value);
  }

  function tasksForColumn(col) {
    let pool;
    if (col.statusKey === 'done') {
      // Done is virtual — last 14 days of completed tasks. Todoist's truth.
      const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
      pool = allTasks.filter(t => t.isCompleted);
      // We don't have a reliable completedAt on the cached row; show all
      // currently-cached completed tasks. They'll roll off as the cache
      // refreshes. Acceptable for v1.
    } else if (col.statusKey === 'todo') {
      // Default column — every open task without an explicit status.
      pool = tasks.filter(t => !t.localStatus || t.localStatus === 'todo');
    } else {
      pool = tasks.filter(t => t.localStatus === col.statusKey);
    }
    const sortBy = getColumnSort(col.statusKey);
    return [...pool].sort((a, b) => {
      switch (sortBy) {
        case 'manual':
          return (a.localPosition ?? 1e9) - (b.localPosition ?? 1e9);
        case 'priority':
          // Todoist priority: 4 = P1 (highest), 1 = P4 (none). Higher first.
          return (b.priority || 1) - (a.priority || 1);
        case 'created':
          return (b.id || '').localeCompare(a.id || '');
        case 'due':
        default: {
          const aD = a.dueDatetime || a.dueDate || '￿';
          const bD = b.dueDatetime || b.dueDate || '￿';
          return aD.localeCompare(bD);
        }
      }
    });
  }

  // ---- Drag and drop ----
  let draggingId = $state(null);
  let dragOverCol = $state(null);

  function onCardDragStart(e, taskId) {
    draggingId = taskId;
    e.dataTransfer.effectAllowed = 'move';
    // If this card is part of a multi-select, drag the whole set. Otherwise
    // just the single id (legacy behavior). Single-id field is kept for
    // back-compat with the existing onColDrop handler.
    const ids = selectedIds.has(taskId) ? [...selectedIds] : [taskId];
    e.dataTransfer.setData('application/x-task-id', String(taskId));
    e.dataTransfer.setData('application/x-task-ids', JSON.stringify(ids));
  }
  function onCardDragEnd() {
    draggingId = null;
    dragOverCol = null;
  }
  function onColDragOver(e, col) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragOverCol = col.statusKey;
  }
  function onColDragLeave(e) {
    // Only clear when leaving the column entirely, not just moving across cards.
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (dragOverCol === e.currentTarget.dataset.statusKey) dragOverCol = null;
  }
  async function onColDrop(e, col) {
    e.preventDefault();
    const idsRaw = e.dataTransfer.getData('application/x-task-ids');
    let ids = [];
    try { ids = JSON.parse(idsRaw || '[]'); } catch { ids = []; }
    if (ids.length === 0) {
      const id = e.dataTransfer.getData('application/x-task-id');
      if (id) ids = [id];
    }
    if (ids.length === 0) return;
    dragOverCol = null;
    draggingId = null;
    if (col.statusKey === 'done') {
      // "Done" is virtual — moving here means complete-the-task.
      await Promise.all(ids.map(id => completeTask(id)));
      clearSelection();
      return;
    }
    await Promise.all(ids.map(id => moveTaskToColumn(id, col.statusKey)));
    // Manual sort so the dragged group stays where dropped. Append in the
    // order they were originally selected (selectedIds preserves insertion).
    setColumnSort(col.statusKey, 'manual');
    const ordered = tasksForColumn(col);
    const idSet = new Set(ids.map(String));
    const without = ordered.filter(t => !idSet.has(String(t.id)));
    const final = [...without.map(t => t.id), ...ids];
    reorderTasksInColumn(final);
    if (ids.length > 1) clearSelection();
  }

  // ---- Inline column rename ----
  let editingColId = $state(null);
  let editingName = $state('');
  function startRename(col) {
    editingColId = col.id;
    editingName = col.name;
  }
  function commitRename() {
    if (editingColId == null) return;
    const name = editingName.trim();
    if (name) renameColumn(editingColId, name);
    editingColId = null;
  }
  function cancelRename() {
    editingColId = null;
  }

  // Inline-add column: clicking "+ Column" reveals a small text input where
  // the button was. Enter commits, Esc/blur cancels — same shape as the
  // rename input. No window.prompt() per CLAUDE.md UI rules.
  let addingColumn = $state(false);
  let newColumnName = $state('');
  function startAddColumn() {
    addingColumn = true;
    newColumnName = '';
  }
  async function commitAddColumn() {
    const name = newColumnName.trim();
    addingColumn = false;
    newColumnName = '';
    if (!name) return;
    await addColumn(name);
  }
  function cancelAddColumn() {
    addingColumn = false;
    newColumnName = '';
  }

  async function handleRemoveColumn(col) {
    const ok = await confirmAction({
      title: `Remove "${col.name}"?`,
      body: 'Tasks in this column will move back to To Do. This does NOT affect Todoist.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok) removeColumn(col.id);
  }

  function isSystemColumn(statusKey) {
    return statusKey === 'todo' || statusKey === 'in_progress' || statusKey === 'done';
  }
</script>

<div class="tasks-view">
  <!-- Heading lives in the toolbar (top-left, where the date range sits in
       Calendar view). The List/Board toggle is the only in-body chrome. -->
  <header class="view-header">
    <div class="mode-toggle" role="tablist">
      <button class:active={mode === 'list'} onclick={() => setMode('list')} role="tab">List</button>
      <button class:active={mode === 'board'} onclick={() => setMode('board')} role="tab">Board</button>
    </div>
  </header>

  {#if mode === 'list'}
    <div class="list-pane">
      <!-- Same TaskListPanel as the sidebar so multi-select, bulk actions,
           group-by tabs, and inline complete behave identically. The
           holistic view passes compact=false for full-width TaskRows. -->
      <TaskListPanel
        compact={false}
        showGroupByTabs={true}
        emptyMessage={'No tasks. Create one with N or the + button.'}
      />
    </div>
  {:else}
    <div
      class="board-pane"
      use:marquee={{
        itemSelector: '.board-card',
        getId: el => el.dataset.taskId,
        onSelect: onBoardMarquee,
      }}
    >
      {#if selectedIds.size > 0}
        <div class="bulk-bar">
          <span class="bulk-count">{selectedIds.size} selected</span>
          <button class="bulk-btn" onclick={bulkComplete} use:tooltip={'Complete'}>✓ Complete</button>
          <button class="bulk-btn" onclick={bulkRescheduleToday} use:tooltip={'Move to today'}>Today</button>
          <button class="bulk-btn" onclick={bulkRescheduleTomorrow} use:tooltip={'Move to tomorrow'}>Tomorrow</button>
          <button class="bulk-btn" onclick={bulkClearDate} use:tooltip={'Clear due date'}>No date</button>
          <Dropdown
            value=""
            onchange={(v) => v && bulkMoveToColumn(v)}
            options={[
              { value: '', label: 'Move to…', disabled: true },
              ...columnStore.items.map(c => ({ value: c.statusKey, label: c.name })),
            ]}
          />
          <button class="bulk-btn bulk-btn-danger" onclick={bulkDelete} use:tooltip={'Delete'}>Delete</button>
          <button class="bulk-btn-clear" onclick={clearSelection} use:tooltip={'Clear selection'} aria-label="Clear selection">×</button>
        </div>
      {/if}
      {#if !columnStore.loaded}
        <div class="board-loading">Loading columns…</div>
      {:else if columnStore.items.length === 0}
        <div class="board-loading">No columns yet. <button class="link-btn" onclick={startAddColumn}>Add one</button></div>
      {/if}
      {#each columnStore.items as col (col.id)}
        {@const colTasks = tasksForColumn(col)}
        <div
          class="board-col"
          class:drag-over={dragOverCol === col.statusKey}
          class:has-color={!!col.color}
          data-status-key={col.statusKey}
          style:--col-tint={col.color || 'transparent'}
          ondragover={(e) => onColDragOver(e, col)}
          ondragleave={onColDragLeave}
          ondrop={(e) => onColDrop(e, col)}
          role="region"
        >
          <header class="board-col-header">
            {#if editingColId === col.id}
              <input
                class="board-col-name-input"
                bind:value={editingName}
                onblur={commitRename}
                onkeydown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') cancelRename();
                }}
              />
            {:else}
              <h3
                class="board-col-h"
                ondblclick={() => startRename(col)}
                use:tooltip={'Double-click to rename'}
              >
                {col.name}
                <span class="count">{colTasks.length}</span>
              </h3>
            {/if}
            <div class="board-col-actions">
              <Dropdown
                value={getColumnSort(col.statusKey)}
                onchange={(v) => setColumnSort(col.statusKey, v)}
                options={[
                  { value: 'due', label: 'Due' },
                  { value: 'priority', label: 'Priority' },
                  { value: 'manual', label: 'Manual' },
                  { value: 'created', label: 'Created' },
                ]}
              />
              {#if !isSystemColumn(col.statusKey)}
                <button class="icon-btn" onclick={() => handleRemoveColumn(col)} use:tooltip={'Remove column'} aria-label="Remove column">×</button>
              {/if}
            </div>
          </header>
          <div class="board-col-list">
            {#each colTasks as task (task.id)}
              <div
                class="board-card"
                class:dragging={draggingId === task.id}
                class:selected={selectedIds.has(task.id)}
                data-task-id={task.id}
                draggable="true"
                ondragstart={(e) => onCardDragStart(e, task.id)}
                ondragend={onCardDragEnd}
                onclick={(e) => handleBoardCardClick(task, e)}
                onkeydown={(e) => e.key === 'Enter' && handleClick(task)}
                role="button"
                tabindex="0"
              >
                <div class="board-card-content">{@html renderInlineMarkdown(task.content)}</div>
                {#if task.dueDate || task.dueDatetime}
                  <div class="board-card-meta">
                    {parseTaskDue(task)?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </div>
                {/if}
              </div>
            {/each}
            {#if colTasks.length === 0}
              <div class="board-col-empty">Drop here</div>
            {/if}
          </div>
        </div>
      {/each}
      {#if columnStore.items.length > 0 && columnStore.items.length < 5}
        {#if addingColumn}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="board-col-add-input"
            bind:value={newColumnName}
            onblur={commitAddColumn}
            onkeydown={(e) => {
              if (e.key === 'Enter') commitAddColumn();
              else if (e.key === 'Escape') cancelAddColumn();
            }}
            placeholder="Column name"
            autofocus
          />
        {:else}
          <button class="board-col-add" onclick={startAddColumn} use:tooltip={'Add column (max 5)'}>
            + Column
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .board-loading {
    padding: 24px;
    color: var(--text-tertiary);
    font-size: 13px;
  }
  .link-btn {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: inherit;
    padding: 0;
    text-decoration: underline;
  }
  .tasks-view {
    flex: 1;
    overflow: auto;
    background: var(--bg);
    padding: 24px 32px 48px;
  }
  .view-header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    margin-bottom: 20px;
  }
  .mode-toggle {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 3px;
    background: var(--bg-secondary);
  }
  .mode-toggle button {
    padding: 5px 14px;
    border: none;
    background: transparent;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .mode-toggle button.active {
    background: var(--surface);
    color: var(--text-primary);
    box-shadow: var(--shadow-sm);
  }

  .list-pane { max-width: 720px; margin: 0 auto; }
  .group { margin-bottom: 24px; }
  .group-h {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
    padding: 8px 0 4px;
    border-bottom: 1px solid var(--border-light);
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .group-count {
    font-size: 11px;
    color: var(--text-tertiary);
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
  }
  .subgroup-h {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    margin: 12px 0 4px;
  }

  .board-pane {
    display: flex;
    gap: 12px;
    height: 100%;
    align-items: stretch;
  }
  .board-col {
    flex: 1 1 0;
    min-width: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 200px;
    transition: border-color 0.12s, background 0.12s;
  }
  .board-col.drag-over {
    border-color: var(--accent);
    background: var(--accent-light);
  }
  /* User-picked pastel tint. Applied to the column header background as a
     soft band rather than the whole column body — Notion-style: visible
     identity, doesn't compete with task content. The CSS var is set inline
     via `style:--col-tint` so the color is whatever hex the user chose. */
  .board-col.has-color .board-col-header {
    background: var(--col-tint);
    margin: -10px -10px 4px;
    padding: 8px 10px;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    border-bottom: 1px solid color-mix(in srgb, var(--col-tint) 60%, var(--border));
  }
  .board-col.has-color .board-col-h {
    color: var(--text-primary);
  }
  .board-col-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 4px;
  }
  .board-col-h {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: text;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .board-col-name-input {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
    padding: 2px 4px;
    border: 1px solid var(--accent);
    border-radius: 3px;
    background: var(--surface);
    color: var(--text-primary);
    min-width: 0;
  }
  .board-col-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  .icon-btn {
    background: none;
    border: none;
    width: 18px;
    height: 18px;
    border-radius: 3px;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn:hover { color: var(--error, #d33); background: var(--surface-hover); }

  .board-col-list { display: flex; flex-direction: column; gap: 4px; flex: 1; min-height: 40px; }
  .board-col-empty {
    font-size: 11px;
    color: var(--text-tertiary);
    padding: 12px 4px;
    text-align: center;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    margin-top: 4px;
  }
  .board-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    font-size: 13px;
    cursor: grab;
    line-height: 1.3;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .board-card:active { cursor: grabbing; }
  .board-card:hover { border-color: var(--accent); }
  .board-card.dragging { opacity: 0.4; }
  .board-card.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
    box-shadow: 0 0 0 1px var(--accent);
  }
  /* Bulk-action bar shared with TaskListPanel; same visual language. */
  .bulk-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    margin-bottom: 8px;
    background: var(--surface-elevated);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    flex-wrap: wrap;
    position: sticky;
    top: 8px;
    z-index: 5;
  }
  .bulk-count { font-weight: 600; color: var(--accent); margin-right: 4px; font-size: 13px; }
  .bulk-btn {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    color: var(--text-primary);
  }
  .bulk-btn:hover { background: var(--surface-hover); }
  .bulk-btn-danger { color: var(--error, #c62828); border-color: var(--error, #c62828); }
  .bulk-btn-danger:hover { background: color-mix(in srgb, var(--error, #c62828) 12%, var(--surface)); }
  .bulk-btn-clear {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 4px 6px;
    color: var(--text-tertiary);
    margin-left: auto;
  }
  .board-card-meta {
    font-size: 10px;
    color: var(--text-tertiary);
  }
  .board-card-content :global(strong) { font-weight: 700; }
  .board-card-content :global(em) { font-style: italic; }
  .board-card-content :global(del) { color: var(--text-tertiary); }
  .board-card-content :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.92em;
    background: var(--surface-hover);
    padding: 0 4px;
    border-radius: 3px;
  }
  .board-card-content :global(a.auto-link) {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-color: var(--accent-light);
  }

  .board-col-add {
    flex: 0 0 auto;
    align-self: flex-start;
    padding: 6px 12px;
    background: none;
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    color: var(--text-tertiary);
    font-size: 12px;
    cursor: pointer;
    height: fit-content;
    margin-top: 0;
  }
  .board-col-add:hover { color: var(--accent); border-color: var(--accent); }
  .board-col-add-input {
    flex: 0 0 auto;
    align-self: flex-start;
    padding: 6px 12px;
    width: 160px;
    background: var(--surface);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: 12px;
    height: fit-content;
    outline: none;
  }

  .empty {
    text-align: center;
    color: var(--text-tertiary);
    padding: 48px 0;
    font-size: 13px;
  }
  /* (kbd styles removed — empty-state copy no longer references shortcuts) */

  /* Mobile + small tablet: switch the kanban from spread-to-fit to
     horizontal scroll so columns stay legible at ~280px each. Snap-to-column
     makes the swipe feel native. Threshold matches the mobile bottom nav. */
  @media (max-width: 768px) {
    .tasks-view { padding: 16px 12px 16px; }
    .board-pane {
      overflow-x: auto;
      scroll-snap-type: x proximity;
      padding-bottom: 8px;
      /* Bleed past the page padding so the first/last cards align with edge. */
      margin: 0 -12px;
      padding-left: 12px;
      padding-right: 12px;
    }
    .board-col {
      flex: 0 0 280px;
      scroll-snap-align: start;
    }
    .board-col-add {
      flex: 0 0 auto;
      align-self: flex-start;
    }
    .view-header {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 12px;
    }
  }
</style>
