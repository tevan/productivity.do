<script>
  // Lets the user reorder and hide the top-level workspace tabs (Calendar /
  // Tasks / Notes today; integration-driven tabs in the future).
  //
  // Pref shape:
  //   appTabs: { order: ['calendar','tasks','notes'], hidden: [] }
  //
  // Constraints:
  //   - At least one tab must remain visible (otherwise the user lands on
  //     a broken app); the last visible tab's hide button is disabled.
  //   - Visible count is capped at MAX_VISIBLE_TABS — see appView store.

  import { getPrefs, updatePref } from '../stores/prefs.svelte.js';
  import { ALL_APP_TABS, MAX_VISIBLE_TABS } from '../stores/appView.svelte.js';
  import { tooltip } from '../actions/tooltip.js';

  const prefs = getPrefs();

  // Read current state from prefs, falling back to defaults.
  const config = $derived.by(() => {
    const cfg = prefs.values.appTabs || {};
    const order = Array.isArray(cfg.order) && cfg.order.length
      ? cfg.order
      : ALL_APP_TABS.map(t => t.id);
    const hidden = new Set(Array.isArray(cfg.hidden) ? cfg.hidden : []);
    // Build the rendered list — order first, then any tabs missing from
    // order get appended (so a newly-introduced tab still shows up).
    const rendered = order
      .map(id => ALL_APP_TABS.find(t => t.id === id))
      .filter(Boolean);
    for (const t of ALL_APP_TABS) {
      if (!rendered.find(o => o.id === t.id)) rendered.push(t);
    }
    return { rendered, hidden };
  });

  const visibleCount = $derived(config.rendered.filter(t => !config.hidden.has(t.id)).length);

  function persist(order, hidden) {
    updatePref('appTabs', { order, hidden: Array.from(hidden) });
  }

  function toggleHidden(id) {
    const hidden = new Set(config.hidden);
    if (hidden.has(id)) {
      // Re-enabling: enforce the cap. If we'd exceed MAX_VISIBLE_TABS,
      // refuse silently — Settings UI grays the checkbox out, but defend.
      if (visibleCount >= MAX_VISIBLE_TABS) return;
      hidden.delete(id);
    } else {
      // Hiding: enforce at-least-one-visible.
      if (visibleCount <= 1) return;
      hidden.add(id);
    }
    persist(config.rendered.map(t => t.id), hidden);
  }

  // Drag-to-reorder. Mirrors BoardColumnsEditor's pattern.
  let dragId = $state(null);
  let dragOverId = $state(null);

  function onDragStart(e, t) {
    dragId = t.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', t.id);
  }
  function onDragOver(e, t) {
    if (!dragId || t.id === dragId) return;
    e.preventDefault();
    dragOverId = t.id;
  }
  function onDragLeave(t) {
    if (dragOverId === t.id) dragOverId = null;
  }
  function onDrop(e, target) {
    e.preventDefault();
    if (!dragId || dragId === target.id) { dragId = null; dragOverId = null; return; }
    const ids = config.rendered.map(t => t.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(target.id);
    if (fromIdx < 0 || toIdx < 0) { dragId = null; dragOverId = null; return; }
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    persist(ids, config.hidden);
    dragId = null;
    dragOverId = null;
  }
  function onDragEnd() { dragId = null; dragOverId = null; }
</script>

<div class="tabs-editor">
  <p class="help-text">
    Drag to reorder the tabs in the top bar. Hide ones you don't use.
    Up to {MAX_VISIBLE_TABS} visible at a time; at least one must stay visible.
  </p>
  <ul class="tab-list">
    {#each config.rendered as tab (tab.id)}
      {@const isHidden = config.hidden.has(tab.id)}
      {@const lastVisible = !isHidden && visibleCount <= 1}
      {@const wouldExceedCap = isHidden && visibleCount >= MAX_VISIBLE_TABS}
      <li
        class="tab-row"
        class:dragging={dragId === tab.id}
        class:drag-over={dragOverId === tab.id}
        class:hidden={isHidden}
        draggable="true"
        ondragstart={(e) => onDragStart(e, tab)}
        ondragover={(e) => onDragOver(e, tab)}
        ondragleave={() => onDragLeave(tab)}
        ondrop={(e) => onDrop(e, tab)}
        ondragend={onDragEnd}
      >
        <span class="grip" aria-hidden="true">⋮⋮</span>
        <span class="label">{tab.label}</span>
        {#if isHidden}<span class="hidden-pill">Hidden</span>{/if}
        <label
          class="toggle"
          class:disabled={lastVisible || wouldExceedCap}
          use:tooltip={
            lastVisible ? 'At least one tab must stay visible'
            : wouldExceedCap ? `Maximum ${MAX_VISIBLE_TABS} visible tabs`
            : (isHidden ? 'Show this tab' : 'Hide this tab')
          }
        >
          <input
            type="checkbox"
            checked={!isHidden}
            disabled={lastVisible || wouldExceedCap}
            onchange={() => toggleHidden(tab.id)}
          />
          <span>Visible</span>
        </label>
      </li>
    {/each}
  </ul>
</div>

<style>
  .tabs-editor { display: flex; flex-direction: column; gap: 12px; }
  .help-text { font-size: 13px; color: var(--text-secondary); margin: 0; line-height: 1.5; }
  .tab-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tab-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    cursor: grab;
    transition: opacity 0.15s, border-color 0.15s, background 0.15s;
  }
  .tab-row:active { cursor: grabbing; }
  .tab-row.dragging { opacity: 0.4; }
  .tab-row.drag-over { border-color: var(--accent); background: var(--accent-light); }
  .tab-row.hidden .label { color: var(--text-tertiary); }
  .grip {
    color: var(--text-tertiary);
    font-size: 11px;
    letter-spacing: -2px;
    flex-shrink: 0;
    user-select: none;
  }
  .label { flex: 1; font-size: 13px; font-weight: 500; color: var(--text-primary); }
  .hidden-pill {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 999px;
    color: var(--text-tertiary);
    background: color-mix(in srgb, var(--text-tertiary) 12%, transparent);
    border: 1px solid var(--border);
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .toggle.disabled { cursor: not-allowed; opacity: 0.55; }
  .toggle input { cursor: inherit; }
</style>
