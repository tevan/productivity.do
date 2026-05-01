<script>
  // Board column manager for Settings → Tasks. Lets users:
  //   - Rename any column inline.
  //   - Delete custom columns (system columns are protected).
  //   - Add a new column up to the cap (5 total).
  //
  // Reorder is intentionally NOT exposed here — Done must stay rightmost,
  // and users haven't asked for re-ordering. We can add a drag handle later
  // if needed without changing the API.

  import { onMount } from 'svelte';
  import { getTaskColumns, fetchTaskColumns, renameColumn, recolorColumn, addColumn, removeColumn, reorderColumns } from '../stores/taskColumns.svelte.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';

  // Notion-style pastel swatches. The first option clears the color
  // (returns the column to the neutral surface). Hex chosen for ~AA
  // contrast with var(--text-primary) on light + var(--text-on-pastel)
  // on dark themes — see TasksView .board-col-header rules.
  const PASTEL_PALETTE = [
    { value: null,      label: 'Default' },
    { value: '#fde2e2', label: 'Rose' },
    { value: '#ffe7d6', label: 'Peach' },
    { value: '#fef3c7', label: 'Yellow' },
    { value: '#dcfce7', label: 'Green' },
    { value: '#cffafe', label: 'Sky' },
    { value: '#dbeafe', label: 'Blue' },
    { value: '#e9d5ff', label: 'Purple' },
    { value: '#f3e8ff', label: 'Lavender' },
    { value: '#e5e7eb', label: 'Gray' },
  ];

  const store = getTaskColumns();
  let errMsg = $state('');
  let dragId = $state(null);
  let dragOverId = $state(null);

  let newName = $state('');
  let editingId = $state(null);
  let editingValue = $state('');

  onMount(() => { if (!store.loaded) fetchTaskColumns(); });

  function isSystem(statusKey) {
    return statusKey === 'todo' || statusKey === 'in_progress' || statusKey === 'done';
  }

  function startEdit(col) {
    editingId = col.id;
    editingValue = col.name;
  }
  function commitEdit() {
    if (editingId == null) return;
    const v = editingValue.trim();
    if (v) renameColumn(editingId, v);
    editingId = null;
  }
  function cancelEdit() { editingId = null; }

  async function add() {
    if (!newName.trim()) return;
    errMsg = '';
    const res = await addColumn(newName.trim());
    if (res?.ok) {
      newName = '';
    } else {
      errMsg = res?.error || 'Could not add column';
    }
  }

  // Drag-to-reorder. Done is forced rightmost server-side; the UI also blocks
  // dragging Done so the user doesn't try to fight the server.
  function onDragStart(e, col) {
    if (col.statusKey === 'done') { e.preventDefault(); return; }
    dragId = col.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(col.id));
  }
  function onDragOver(e, col) {
    if (dragId == null || col.id === dragId) return;
    e.preventDefault();
    dragOverId = col.id;
  }
  function onDragLeave(col) {
    if (dragOverId === col.id) dragOverId = null;
  }
  function onDrop(e, target) {
    e.preventDefault();
    if (dragId == null || dragId === target.id) {
      dragId = null; dragOverId = null;
      return;
    }
    const ordered = [...store.items];
    const fromIdx = ordered.findIndex(c => c.id === dragId);
    const toIdx = ordered.findIndex(c => c.id === target.id);
    if (fromIdx < 0 || toIdx < 0) {
      dragId = null; dragOverId = null;
      return;
    }
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    reorderColumns(ordered.map(c => c.id));
    dragId = null;
    dragOverId = null;
  }
  function onDragEnd() {
    dragId = null;
    dragOverId = null;
  }

  async function remove(col) {
    const ok = await confirmAction({
      title: `Remove "${col.name}"?`,
      body: 'Tasks in this column will move back to To Do. This does NOT affect Todoist.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok) await removeColumn(col.id);
  }
</script>

<div class="board-columns-editor">
  <ol class="cols">
    {#each store.items as col (col.id)}
      <li
        class="col-row"
        class:drag-over={dragOverId === col.id}
        class:dragging={dragId === col.id}
        draggable={col.statusKey !== 'done'}
        ondragstart={(e) => onDragStart(e, col)}
        ondragover={(e) => onDragOver(e, col)}
        ondragleave={() => onDragLeave(col)}
        ondrop={(e) => onDrop(e, col)}
        ondragend={onDragEnd}
      >
        {#if col.statusKey !== 'done'}
          <span class="drag-handle" aria-hidden="true">⋮⋮</span>
        {:else}
          <span class="drag-handle drag-handle-locked" aria-hidden="true">⋮⋮</span>
        {/if}
        {#if editingId === col.id}
          <input
            class="col-input"
            bind:value={editingValue}
            onblur={commitEdit}
            onkeydown={(e) => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') cancelEdit();
            }}
          />
        {:else}
          <button class="col-name" onclick={() => startEdit(col)} title="Click to rename">
            {col.name}
          </button>
        {/if}
        <span class="col-key">{col.statusKey}</span>
        <div class="color-picker" data-marquee-skip>
          {#each PASTEL_PALETTE as p}
            <button
              type="button"
              class="swatch"
              class:active={(col.color || null) === p.value}
              class:swatch-default={p.value === null}
              style:background={p.value || 'transparent'}
              title={p.label}
              aria-label={`${p.label} color`}
              onclick={() => recolorColumn(col.id, p.value)}
            ></button>
          {/each}
        </div>
        {#if !isSystem(col.statusKey)}
          <button class="col-remove" onclick={() => remove(col)} aria-label="Remove column">×</button>
        {:else}
          <span class="col-system" title="System column — name is editable, but it can't be removed">system</span>
        {/if}
      </li>
    {/each}
  </ol>

  {#if store.items.length < 5}
    <div class="add-row">
      <input
        type="text"
        placeholder="New column name…"
        bind:value={newName}
        onkeydown={(e) => e.key === 'Enter' && add()}
        maxlength="40"
      />
      <button class="btn-primary" onclick={add} disabled={!newName.trim()}>Add column</button>
    </div>
  {:else}
    <p class="help-text">Maximum reached (5 columns). Remove one to add another.</p>
  {/if}
  {#if errMsg}<p class="err">{errMsg}</p>{/if}
</div>

<style>
  .board-columns-editor { margin-top: 8px; }
  .cols { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-direction: column; gap: 6px; }
  .col-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    transition: border-color 0.1s, background 0.1s;
  }
  .col-row[draggable="true"] { cursor: grab; }
  .col-row[draggable="true"]:active { cursor: grabbing; }
  .col-row.drag-over { border-color: var(--accent); background: var(--accent-light); }
  .col-row.dragging { opacity: 0.4; }
  .drag-handle {
    color: var(--text-tertiary);
    font-size: 12px;
    letter-spacing: -2px;
    user-select: none;
    flex-shrink: 0;
  }
  .drag-handle-locked { opacity: 0.25; }
  .color-picker {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }
  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1.5px solid var(--border);
    padding: 0;
    cursor: pointer;
    transition: transform 0.08s, border-color 0.08s;
  }
  .swatch:hover { transform: scale(1.15); }
  .swatch.active {
    border-color: var(--text-primary);
    box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--text-primary);
  }
  .swatch-default {
    /* Diagonal slash through transparent so the "Default / no color" option
       is visually distinct from a near-white swatch. */
    background-image: linear-gradient(45deg, transparent 47%, var(--text-tertiary) 47%, var(--text-tertiary) 53%, transparent 53%) !important;
  }
  .col-name {
    background: none;
    border: none;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    cursor: text;
    text-align: left;
    flex: 1;
    min-width: 0;
  }
  .col-name:hover { background: var(--surface-hover); }
  .col-input {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    padding: 2px 6px;
    border: 1px solid var(--accent);
    border-radius: 3px;
    background: var(--bg);
    color: var(--text-primary);
  }
  .col-key {
    font-size: 10px;
    font-family: ui-monospace, monospace;
    color: var(--text-tertiary);
    background: var(--bg-secondary);
    padding: 2px 6px;
    border-radius: 3px;
  }
  .col-system {
    font-size: 10px;
    color: var(--text-tertiary);
    font-style: italic;
  }
  .col-remove {
    background: none;
    border: none;
    width: 22px;
    height: 22px;
    border-radius: 3px;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }
  .col-remove:hover { color: var(--error, #d33); background: var(--surface-hover); }

  .add-row { display: flex; gap: 8px; align-items: center; }
  .add-row input {
    flex: 1;
    padding: 6px 10px;
    font-size: 13px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-primary);
  }
  .btn-primary {
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: white;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .help-text { font-size: 11px; color: var(--text-tertiary); margin: 8px 0 0; }
  .err { font-size: 11px; color: var(--error, #d33); margin: 8px 0 0; }
</style>
