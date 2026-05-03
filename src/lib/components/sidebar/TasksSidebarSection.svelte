<script>
  // Sidebar-only Tasks navigator — used when the user is in the Tasks
  // holistic view. Lets the user filter the main pane by project (or All).
  //
  // Selection state lives in prefs.values.tasksFilterProjectId so the
  // choice persists across reloads. The TasksView reads the same pref to
  // narrow what it renders.
  //
  // Future expansion: Todoist saved filters (when /api/tasks/filters
  // returns non-empty), labels, "Today", "Overdue" smart views.

  import { getTasks } from '../../stores/tasks.svelte.js';
  import { getPrefs, updatePref } from '../../stores/prefs.svelte.js';
  import { todoistColor, todoistColorThemed } from '../../utils/dates.js';
  import { tooltip } from '../../actions/tooltip.js';
  import { onMount } from 'svelte';
  import { api } from '../../api.js';
  import { navigate } from '../../stores/routeStore.svelte.js';
  import { showToast } from '../../utils/toast.svelte.js';

  const taskStore = getTasks();
  const prefs = getPrefs();

  const selectedProjectId = $derived(prefs.values.tasksFilterProjectId || null);
  const tasks = $derived(taskStore.items.filter(t => !t.isCompleted));
  const projects = $derived(taskStore.projects || []);

  // Project meta (pinned, due_date) so we can render pin indicator + the
  // due-soon dot on the sidebar row. Refreshed on mount and after pin
  // changes.
  let projectMeta = $state(new Map());
  async function loadProjectMeta() {
    try {
      const res = await api('/api/project-meta');
      if (res?.ok) {
        const m = new Map();
        for (const it of (res.items || [])) m.set(it.projectId, it);
        projectMeta = m;
      }
    } catch {}
  }
  onMount(loadProjectMeta);

  // Count tasks per project so the user sees workload distribution at a glance.
  const counts = $derived.by(() => {
    const m = new Map();
    for (const t of tasks) {
      const k = t.projectId || null;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  });

  function pick(id) {
    updatePref('tasksFilterProjectId', id);
  }
  function openProject(id) {
    if (!id) return;
    navigate(`/projects/${encodeURIComponent(id)}`);
  }
  // Right-click context menu coordinates
  let menu = $state(null); // { x, y, projectId, pinned }
  function onContextMenu(e, project) {
    e.preventDefault();
    const meta = projectMeta.get(project.id);
    menu = {
      x: e.clientX, y: e.clientY,
      projectId: project.id,
      pinned: !!meta?.pinnedAt,
    };
  }
  function closeMenu() { menu = null; }
  async function togglePin() {
    if (!menu) return;
    const { projectId, pinned } = menu;
    closeMenu();
    try {
      const res = await api(
        `/api/project-meta/${encodeURIComponent(projectId)}`,
        { method: 'PUT', body: JSON.stringify({ pinned: !pinned }) }
      );
      if (res?.ok) {
        loadProjectMeta();
      } else if (res?.code === 'pin_limit') {
        showToast({ message: res.error || 'Pin limit reached', kind: 'error' });
      }
    } catch (e) {
      showToast({ message: String(e?.message || e), kind: 'error' });
    }
  }
</script>

<div class="tasks-section">
  <div class="section-head">
    <h4>Filter by</h4>
  </div>
  <ul class="proj-list">
    <li>
      <button
        class="proj-row"
        class:active={!selectedProjectId}
        onclick={() => pick(null)}
      >
        <span class="dot" style="background: var(--text-tertiary);"></span>
        <span class="name">All tasks</span>
        <span class="num">{tasks.length}</span>
      </button>
    </li>
    {#each projects as p (p.id)}
      {@const n = counts.get(p.id) || 0}
      {@const meta = projectMeta.get(p.id)}
      <li>
        <div
          class="proj-row"
          class:active={selectedProjectId === p.id}
        >
          <button
            class="proj-tap"
            onclick={() => pick(p.id)}
            oncontextmenu={(e) => onContextMenu(e, p)}
            title="Click to filter · Right-click for more"
          >
            <span class="dot" style="background: {prefs.values.themeProjectColors ? todoistColorThemed(p.color) : todoistColor(p.color)};"></span>
            <span class="name">{p.name}</span>
            {#if meta?.pinnedAt}
              <span class="pin-dot" title="Pinned to decision surface">📌</span>
            {/if}
            <span class="num">{n}</span>
          </button>
          <button
            class="proj-page-btn"
            onclick={() => openProject(p.id)}
            use:tooltip={'Open project page'}
            aria-label="Open project page"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
              <path d="M6 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </li>
    {/each}
  </ul>
</div>

{#if menu}
  <div class="ctx-overlay" onclick={closeMenu} role="presentation"></div>
  <div class="ctx-menu" style="left: {menu.x}px; top: {menu.y}px;">
    <button onclick={() => { openProject(menu.projectId); closeMenu(); }}>Open project page</button>
    <button onclick={togglePin}>{menu.pinned ? 'Unpin from decisions' : 'Pin to decisions'}</button>
  </div>
{/if}

<style>
  .tasks-section {
    padding: 8px 8px 12px;
    border-bottom: 1px solid var(--border-light);
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    overflow: hidden;
  }
  .section-head {
    margin-bottom: 6px;
    padding: 0 4px;
  }
  .section-head h4 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
    margin: 0;
  }
  .proj-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    min-height: 0;
    max-height: 60vh;
    /* Breathing room between rows so the active fill doesn't crowd
       neighbors. Each li takes its own gap; the row chip itself stays
       full-width inside. */
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .proj-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0;
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 12px;
    min-width: 0;
    /* Suppress the browser's default focus outline. Real focus visibility
       is supplied by .proj-tap:focus-visible below — matches the rest of
       the sidebar's focus language and never leaves a stray black box. */
    outline: none;
  }
  .proj-row:hover { background: var(--surface-hover); }
  .proj-row.active {
    background: var(--accent-light);
    color: var(--accent);
    font-weight: 600;
  }
  .proj-row.active .proj-tap, .proj-row.active .proj-page-btn { color: inherit; }
  .proj-tap {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    /* Bumped horizontal padding so the active fill has breathing room
       around the dot/text instead of touching the edge. */
    padding: 7px 12px;
    border: none;
    background: none;
    text-align: left;
    color: inherit;
    font: inherit;
    cursor: pointer;
    border-radius: var(--radius-sm);
    min-width: 0;
    outline: none;
  }
  .proj-tap:focus-visible {
    box-shadow: 0 0 0 2px var(--accent);
  }
  /* The "All tasks" button is on .proj-row directly (no inner .proj-tap
     wrapper), so apply the same focus treatment there. */
  button.proj-row {
    border: none;
    background: none;
    padding: 7px 12px;
    text-align: left;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  button.proj-row:focus-visible {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .proj-page-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    width: 22px;
    height: 22px;
    margin-right: 4px;
    border-radius: var(--radius-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .proj-row:hover .proj-page-btn { opacity: 1; }
  .proj-page-btn:hover { background: var(--hover); color: var(--text-primary); }
  .pin-dot { font-size: 10px; flex-shrink: 0; }

  .ctx-overlay { position: fixed; inset: 0; z-index: 90; }
  .ctx-menu {
    position: fixed;
    z-index: 100;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
    box-shadow: var(--shadow-lg);
    padding: 4px;
    min-width: 180px;
    display: flex;
    flex-direction: column;
  }
  .ctx-menu button {
    background: none;
    border: none;
    padding: 8px 12px;
    text-align: left;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 13px;
    border-radius: var(--radius-sm, 6px);
  }
  .ctx-menu button:hover { background: var(--hover); }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .num {
    font-size: 10px;
    color: var(--text-tertiary);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
    min-width: 22px;
    text-align: right;
  }
  .proj-row.active .num { color: inherit; opacity: 0.7; }
</style>
