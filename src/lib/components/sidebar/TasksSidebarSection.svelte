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

  const taskStore = getTasks();
  const prefs = getPrefs();

  const selectedProjectId = $derived(prefs.values.tasksFilterProjectId || null);
  const tasks = $derived(taskStore.items.filter(t => !t.isCompleted));
  const projects = $derived(taskStore.projects || []);

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
      <li>
        <button
          class="proj-row"
          class:active={selectedProjectId === p.id}
          onclick={() => pick(p.id)}
        >
          <span class="dot" style="background: {prefs.values.themeProjectColors ? todoistColorThemed(p.color) : todoistColor(p.color)};"></span>
          <span class="name">{p.name}</span>
          <span class="num">{n}</span>
        </button>
      </li>
    {/each}
  </ul>
</div>

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
  }
  .proj-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border: none;
    background: none;
    text-align: left;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-primary);
    font-size: 12px;
    min-width: 0;
  }
  .proj-row:hover { background: var(--surface-hover); }
  .proj-row.active {
    background: var(--accent-light);
    color: var(--accent);
    font-weight: 600;
  }
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
