<script>
  import { completeTask, reopenTask } from '../stores/tasks.svelte.js';
  import { isSameDay, formatDate, parseTaskDue } from '../utils/dates.js';
  import { tooltip } from '../actions/tooltip.js';
  import { renderInlineMarkdown } from '../utils/inlineMarkdown.js';

  let { task, compact = false, onclickTask = null, selected = false, onclickTaskMeta = null, indent = 0, draggable = false } = $props();

  function handleDragStart(e) {
    if (!draggable) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-task-id', task.id);
    e.dataTransfer.setData('text/plain', task.content);
  }

  const isOverdue = $derived.by(() => {
    if (task.isCompleted) return false;
    const due = parseTaskDue(task);
    if (!due) return false;
    // For datetime-due tasks: overdue if past now.
    if (task.dueDatetime) return due < new Date();
    // For date-only tasks: overdue only after the due day has fully passed.
    return due < new Date() && !isSameDay(due, new Date());
  });

  const overdueLabel = $derived.by(() => {
    if (!isOverdue) return '';
    const due = parseTaskDue(task);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDay = new Date(due);
    dueDay.setHours(0, 0, 0, 0);
    const days = Math.round((today - dueDay) / 86400000);
    const when = formatDate(due);
    if (days === 1) return `Overdue — was due yesterday (${when})`;
    return `Overdue by ${days} days — was due ${when}`;
  });

  let completing = $state(false);

  async function handleToggle() {
    completing = true;
    if (task.isCompleted) {
      await reopenTask(task.id);
    } else {
      await completeTask(task.id);
    }
    completing = false;
  }

  const priorityColors = {
    4: 'var(--error)',
    3: '#f59e0b',
    2: 'var(--accent)',
    1: 'var(--text-tertiary)',
  };
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="task-row"
  class:compact
  class:completed={task.isCompleted}
  class:completing
  class:selected
  class:subtask={indent > 0}
  class:draggable
  data-task-id={task.id}
  style:padding-left={indent > 0 ? `${6 + indent * 16}px` : null}
  draggable={draggable ? 'true' : undefined}
  ondragstart={handleDragStart}
  onclick={(e) => onclickTask?.(task, e)}
>
  <button
    class="task-checkbox"
    onclick={(e) => { e.stopPropagation(); handleToggle(); }}
    style="border-color: {priorityColors[task.priority] || priorityColors[1]}"
    aria-label={task.isCompleted ? 'Reopen task' : 'Complete task'}
  >
    {#if task.isCompleted}
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    {/if}
  </button>
  <div class="task-info">
    <span class="task-title">
      {#if isOverdue}
        <span class="overdue-icon" data-tooltip={overdueLabel} aria-label={overdueLabel}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M6 3.4V6l1.8 1.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      {/if}
      <span class="title-text">{@html renderInlineMarkdown(task.content)}</span>
      {#if task.isRecurring}
        <span class="recurring-badge" use:tooltip={task.dueString || 'Recurring'}>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M2 6a4 4 0 016-3.5M10 6a4 4 0 01-6 3.5M3 1.5l-1 1 1 1M9 10.5l1-1-1-1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>
          </svg>
        </span>
      {/if}
    </span>
    {#if task.projectName && !compact}
      <span class="task-project">{task.projectName}</span>
    {/if}
  </div>
  {#if task.dueDate && !compact}
    <span class="task-date" class:overdue={isOverdue}>
      {formatDate(task.dueDate)}
    </span>
  {/if}
</div>

<style>
  .task-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: opacity 0.3s;
  }
  .task-row:hover { background: var(--surface-hover); }
  .task-row.selected {
    background: var(--accent-light);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .task-row.selected:hover { background: var(--accent-light); }
  .task-row.compact { padding: 3px 4px; gap: 6px; }
  .task-row.completing { opacity: 0.5; }
  .task-row.completed .task-title { text-decoration: line-through; color: var(--text-tertiary); }

  .task-checkbox {
    width: 16px;
    height: 16px;
    border: 1.5px solid;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: none;
    cursor: pointer;
    color: var(--text-primary);
    transition: background 0.1s;
    /* Hit target: pseudo-element extends the tap surface to ~36px without
       changing visual size, hitting WCAG 2.5.5 territory on mobile. */
    position: relative;
  }
  .task-checkbox::after {
    content: '';
    position: absolute;
    inset: -10px;
  }
  .task-checkbox:hover { background: var(--surface-active); }
  .task-row.completed .task-checkbox {
    background: currentColor;
    color: var(--accent);
  }
  .task-row.completed .task-checkbox svg path {
    stroke: white;
  }

  .task-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .task-title {
    font-size: 12px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .task-title :global(strong) { font-weight: 700; }
  .task-title :global(em) { font-style: italic; }
  .task-title :global(del) { color: var(--text-tertiary); }
  .task-title :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.92em;
    background: var(--surface-hover);
    padding: 0 4px;
    border-radius: 3px;
  }
  .task-title :global(a.auto-link) {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-color: var(--accent-light);
  }
  .overdue-icon {
    display: inline-flex;
    align-items: center;
    color: var(--error);
    margin-right: 3px;
    vertical-align: -1px;
    position: relative;
  }
  .overdue-icon::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%) translateY(2px);
    background: var(--text-primary);
    color: var(--surface);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s, transform 0.12s;
    z-index: 100;
    box-shadow: var(--shadow-md);
  }
  .overdue-icon:hover::after {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  .task-project {
    font-size: 10px;
    color: var(--text-tertiary);
  }

  .task-date {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .task-date.overdue { color: var(--error); font-weight: 500; }

  .recurring-badge {
    display: inline-flex;
    margin-left: 4px;
    color: var(--text-tertiary);
    vertical-align: middle;
  }
</style>
