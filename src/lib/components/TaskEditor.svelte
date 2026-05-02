<script>
  import { getContext } from 'svelte';
  import { updateTask, deleteTask, completeTask, reopenTask, createTask, getTasks } from '../stores/tasks.svelte.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';
  import { api } from '../api.js';
  import { parseTaskDue, todoistColor, todoistColorThemed, lowerAmPm } from '../utils/dates.js';
  import Dropdown from './Dropdown.svelte';
  import { tooltip } from '../actions/tooltip.js';
  import RevisionHistoryPanel from './RevisionHistoryPanel.svelte';

  let { task = null, onclose = () => {} } = $props();
  let historyOpen = $state(false);
  const appCtx = getContext('app');

  function switchToEvent() {
    // Translate the in-progress task into an event draft. Title → summary,
    // description → description. Due date becomes the event start; if no
    // time was set, default to a 9am block at the user's defaultEventDuration.
    const draft = { summary: content || '', description: description || '' };
    const dur = (estimatedMinutes && Number(estimatedMinutes) > 0) ? Number(estimatedMinutes) : 30;
    let s = null;
    if (dueDate) {
      if (dueTime) {
        s = new Date(`${dueDate}T${dueTime}:00`);
      } else {
        s = new Date(`${dueDate}T09:00:00`);
      }
    }
    if (s) {
      draft.start = s.toISOString();
      draft.end = new Date(s.getTime() + dur * 60000).toISOString();
    }
    onclose();
    appCtx?.editEvent?.(draft);
  }

  const taskStore = getTasks();
  const prefs = getPrefs();

  let content = $state(task?.content || '');
  let description = $state(task?.description || '');
  let priority = $state(task?.priority || 1);
  let projectId = $state(task?.projectId || null);
  let labelsText = $state((task?.labels || []).join(', '));
  let dueDate = $state(task?.dueDate || (task?.dueDatetime ? task.dueDatetime.slice(0, 10) : ''));
  let dueTime = $state(task?.dueDatetime ? task.dueDatetime.slice(11, 16) : '');
  let estimatedMinutes = $state(task?.estimatedMinutes || 30);
  let saving = $state(false);
  let scheduling = $state(false);
  let scheduleNotice = $state('');

  const projects = $derived(taskStore.projects || []);

  async function handleSave() {
    if (saving || !content.trim()) return;
    saving = true;
    const labels = labelsText
      .split(',')
      .map(l => l.trim())
      .filter(Boolean);

    const payload = {
      content,
      description,
      priority,
      labels,
      estimatedMinutes: Number(estimatedMinutes) || null,
    };

    if (projectId && projectId !== task.projectId) {
      payload.projectId = projectId;
    }

    if (dueDate) {
      if (dueTime) {
        payload.dueDatetime = `${dueDate}T${dueTime}:00`;
      } else {
        payload.dueDate = dueDate;
      }
    } else {
      // No date - explicitly clear by sending empty string (Todoist convention)
      payload.dueDate = '';
    }

    if (task?.id) {
      await updateTask(task.id, payload);
    } else {
      // Creating a new task — Todoist API ignores empty dueDate so don't
      // send the explicit clear in that case.
      if (payload.dueDate === '') delete payload.dueDate;
      await createTask(payload);
    }
    saving = false;
    onclose();
  }

  async function handleDelete() {
    if (!task?.id) return;
    if (prefs.values.confirmDeleteTask !== false) {
      const ok = await confirmAction({ title: 'Delete task?', body: `"${task.content}" will be removed.`, confirmLabel: 'Delete', danger: true });
      if (!ok) return;
    }
    await deleteTask(task.id);
    onclose();
  }

  let scheduleStatus = $state(''); // '' | 'ok' | 'error'

  const isOverdue = $derived.by(() => {
    if (task?.isCompleted) return false;
    const d = parseTaskDue(task);
    if (!d) return false;
    if (task.dueDatetime) return d < new Date();
    // Date-only due: overdue only after the entire day has passed (local).
    const endOfDue = new Date(d);
    endOfDue.setHours(23, 59, 59, 999);
    return endOfDue < new Date();
  });

  const overdueLabel = $derived.by(() => {
    if (!isOverdue) return '';
    const d = parseTaskDue(task);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDay = new Date(d);
    dueDay.setHours(0, 0, 0, 0);
    const days = Math.round((today - dueDay) / 86400000);
    const fmt = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    if (days === 0) return `Was due earlier today`;
    if (days === 1) return `Overdue by 1 day — was due ${fmt}`;
    return `Overdue by ${days} days — was due ${fmt}`;
  });

  async function handleAutoSchedule() {
    if (!task?.id || scheduling) return;
    scheduling = true;
    scheduleNotice = '';
    scheduleStatus = '';
    try {
      const tz = (() => {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
      })();
      const res = await api(`/api/tasks/${task.id}/auto-schedule`, {
        method: 'POST',
        body: JSON.stringify({
          estimatedMinutes: Number(estimatedMinutes) || 30,
          timezone: tz,
        }),
      });
      if (res?.ok) {
        const when = new Date(res.startIso);
        const fmt = lowerAmPm(when.toLocaleString(undefined, {
          weekday: 'short', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit',
        }));
        scheduleNotice = `Scheduled for ${fmt}`;
        scheduleStatus = 'ok';
      } else {
        scheduleNotice = res?.error || 'Could not find a free slot.';
        scheduleStatus = 'error';
      }
    } catch (err) {
      scheduleNotice = err.message || 'Auto-schedule failed.';
      scheduleStatus = 'error';
    } finally {
      scheduling = false;
    }
  }

  async function handleToggleComplete() {
    if (!task?.id) return;
    if (task.isCompleted) await reopenTask(task.id);
    else await completeTask(task.id);
    onclose();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      onclose();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  }

  // Priority icons render as a 3-bar signal-strength glyph: more filled bars =
  // higher priority. "None" shows an empty/dimmed glyph. This communicates
  // hierarchy at a glance better than 4 identical flag shapes did.
  const PRIORITIES = [
    { value: 4, label: 'Urgent', color: 'var(--error)', bars: 3 },
    { value: 3, label: 'High',   color: '#f59e0b',      bars: 2 },
    { value: 2, label: 'Medium', color: 'var(--accent)', bars: 1 },
    { value: 1, label: 'None',   color: 'var(--text-tertiary)', bars: 0 },
  ];
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="editor-backdrop" onclick={onclose}></div>
<div class="editor-modal" role="dialog" aria-label="Edit task">
  <div class="editor-header">
    <h2>{task?.id ? 'Edit Task' : 'Task'}</h2>
    <div class="header-actions">
      {#if !task?.id}
        <button class="switch-type" onclick={switchToEvent} use:tooltip={'Convert to a calendar event — title, notes, and due date carry over'}>
          Convert to event →
        </button>
      {/if}
      <button class="close-btn" onclick={onclose} aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M13.5 4.5L4.5 13.5M4.5 4.5L13.5 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </div>

  <div class="editor-body">
    {#if isOverdue}
      <div class="overdue-banner" role="alert">
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.3"/>
          <path d="M6 3.4V6l1.8 1.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{overdueLabel || 'Overdue'}</span>
      </div>
    {/if}

    <div class="field">
      <input
        type="text"
        bind:value={content}
        placeholder="Task title"
        class="title-input"
        autofocus
      />
    </div>

    <div class="field">
      <label class="field-label">Description</label>
      <textarea
        bind:value={description}
        placeholder="Notes…"
        rows="4"
      ></textarea>
    </div>

    <div class="field-row">
      <div class="field">
        <label class="field-label">Due date</label>
        <input type="date" class:overdue-input={isOverdue} bind:value={dueDate} />
      </div>
      <div class="field">
        <label class="field-label">Time (optional)</label>
        <input type="time" bind:value={dueTime} disabled={!dueDate} />
      </div>
      {#if dueDate}
        <button type="button" class="clear-btn" onclick={() => { dueDate = ''; dueTime = ''; }}>Clear</button>
      {/if}
    </div>

    <div class="field-row">
      <div class="field">
        <label class="field-label">Project</label>
        <Dropdown
          bind:value={projectId}
          ariaLabel="Project"
          options={(() => {
            // Todoist's "Inbox" project is part of the projects list — don't
            // synthesize a duplicate. If we can identify the Inbox project,
            // its id becomes the canonical "Inbox" value (still null-safe
            // since the backend resolves a missing projectId to Inbox).
            const opts = projects.map(p => ({
              value: p.id,
              label: p.name,
              color: (prefs.values.themeProjectColors ? todoistColorThemed(p.color) : todoistColor(p.color)) || 'var(--text-tertiary)',
            }));
            const hasInbox = projects.some(p => p.name?.toLowerCase() === 'inbox');
            return hasInbox ? opts : [{ value: null, label: 'Inbox', color: 'var(--text-tertiary)' }, ...opts];
          })()}
        />
      </div>
      <div class="field">
        <label class="field-label">Priority</label>
        <Dropdown
          bind:value={priority}
          ariaLabel="Priority"
          options={PRIORITIES.map(p => ({ value: p.value, label: p.label, color: p.color }))}
        />
      </div>
    </div>

    <div class="field">
      <label class="field-label">Labels (comma separated)</label>
      <input type="text" bind:value={labelsText} placeholder="work, urgent, errand" />
    </div>

    <div class="section-divider"></div>

    <div class="schedule-section">
      <div class="schedule-header">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
          <path d="M2 6h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
        <h3>Auto-schedule on calendar</h3>
      </div>
      <p class="section-help">
        Find the next free slot in your work hours that fits the duration below, and place this task on your calendar.
      </p>
      <div class="field-row schedule-row">
        <div class="field">
          <label class="field-label">Estimated minutes</label>
          <input type="number" min="15" max="480" step="15" bind:value={estimatedMinutes} />
        </div>
        <div class="field schedule-action">
          <button type="button" class="auto-schedule-btn" onclick={handleAutoSchedule} disabled={!task?.id || scheduling}>
            {#if scheduling}
              Finding slot…
            {:else}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Find a slot
            {/if}
          </button>
        </div>
      </div>
      {#if scheduleNotice}
        <div class="schedule-notice" class:is-error={scheduleStatus === 'error'} class:is-ok={scheduleStatus === 'ok'}>{scheduleNotice}</div>
      {/if}
    </div>
  </div>

  <div class="editor-footer">
    <button class="footer-btn footer-btn-danger" onclick={handleDelete} use:tooltip={'Delete task'} aria-label="Delete task">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2.5 4h9M5 4V2.5h4V4M3.5 4l.5 8h6l.5-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    {#if task?.id}
      <button class="footer-btn" onclick={() => historyOpen = true} use:tooltip={'Version history'} aria-label="Version history">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>
        </svg>
      </button>
    {/if}
    {#if task?.id}
      <button
        class="footer-btn complete-btn"
        class:reopen={task?.isCompleted}
        onclick={handleToggleComplete}
        use:tooltip={task?.isCompleted ? 'Reopen task' : 'Mark complete'}
        aria-label={task?.isCompleted ? 'Reopen task' : 'Mark complete'}
      >
        {#if task?.isCompleted}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M2 4l3-3 3 3M5 1v8a3 3 0 0 0 3 3h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        {/if}
      </button>
    {/if}
    <div class="footer-spacer"></div>
    <button class="footer-btn cancel-btn" onclick={onclose}>Cancel</button>
    <button class="footer-btn save-btn" onclick={handleSave} disabled={saving || !content.trim()}>
      {saving ? 'Saving…' : 'Save'}
    </button>
  </div>
  {#if historyOpen && task?.id}
    <RevisionHistoryPanel
      resource="tasks"
      id={task.id}
      onclose={() => historyOpen = false}
    />
  {/if}
</div>

<style>
  .editor-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 1000;
  }
  .editor-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1001;
    width: 560px;
    max-width: calc(100vw - 16px);
    max-height: 90vh;
    overflow-y: auto;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
  }
  @media (max-width: 600px) {
    .editor-modal {
      width: calc(100vw - 16px);
      max-height: calc(100vh - 32px);
      top: 16px;
      left: 8px;
      right: 8px;
      transform: none;
    }
  }
  .editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px 10px;
    border-bottom: 1px solid var(--border-light);
  }
  .editor-header h2 {
    font-size: 16px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .overdue-input {
    border-color: var(--error) !important;
    color: var(--error) !important;
    background: color-mix(in srgb, var(--error) 8%, var(--bg-secondary)) !important;
  }
  .overdue-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--error) 12%, transparent);
    color: var(--error);
    font-size: 12px;
    font-weight: 500;
    border: 1px solid color-mix(in srgb, var(--error) 30%, transparent);
  }
  .section-divider {
    height: 1px;
    background: var(--border-light);
    margin: 4px -20px 0;
  }
  .schedule-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .schedule-header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-primary);
  }
  .schedule-header h3 {
    font-size: 14px;
    font-weight: 600;
    margin: 0;
  }
  .section-help {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.45;
    margin: 0;
  }
  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    cursor: pointer;
  }
  .close-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
  .header-actions { display: inline-flex; align-items: center; gap: 8px; }
  .switch-type {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: 12px;
    padding: 4px 10px;
    cursor: pointer;
  }
  .switch-type:hover { background: var(--surface-hover); color: var(--accent); border-color: var(--accent); }

  .editor-body {
    padding: 14px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  .field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }
  .field-row {
    display: flex;
    gap: 12px;
    align-items: flex-end;
  }

  .title-input {
    font-size: 18px;
    font-weight: 500;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    outline: none;
    color: var(--text-primary);
    width: 100%;
  }
  .title-input:focus { border-color: var(--accent); }
  .title-input::placeholder { color: var(--text-tertiary); }

  input[type="date"],
  input[type="time"],
  input[type="text"],
  input[type="number"],
  select,
  textarea {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    font-size: 13px;
    outline: none;
    color: var(--text-primary);
    width: 100%;
  }
  input:focus, select:focus, textarea:focus { border-color: var(--accent); }
  textarea { resize: vertical; min-height: 80px; }
  input:disabled { opacity: 0.5; cursor: not-allowed; }

  select {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' fill='none' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 28px;
    cursor: pointer;
  }

  .clear-btn {
    height: 32px;
    padding: 0 12px;
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .clear-btn:hover { background: var(--surface-hover); color: var(--text-primary); }

  .priority-row {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .priority-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .priority-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
  .priority-btn.active {
    background: color-mix(in srgb, var(--p-color) 15%, transparent);
    color: var(--p-color);
    border-color: var(--p-color);
  }

  .schedule-row { align-items: end; }
  .schedule-action { flex: 1; }
  .auto-schedule-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent-light);
    color: var(--accent);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    width: 100%;
    justify-content: center;
  }
  .auto-schedule-btn:hover:not(:disabled) {
    background: var(--accent);
    color: white;
  }
  .auto-schedule-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .schedule-notice {
    margin-top: 8px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-size: 12px;
  }
  .schedule-notice.is-ok {
    background: color-mix(in oklab, #22c55e 15%, transparent);
    color: #16a34a;
  }
  .schedule-notice.is-error {
    background: color-mix(in oklab, #f59e0b 18%, transparent);
    color: #b45309;
  }
  :global(html.dark) .schedule-notice.is-ok { color: #4ade80; }
  :global(html.dark) .schedule-notice.is-error { color: #fbbf24; }

  .editor-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--border-light);
    background: var(--bg-secondary);
  }
  .footer-spacer { flex: 1; }

  .footer-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .footer-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
  .footer-btn-danger { color: var(--error); border-color: transparent; padding: 6px 8px; }
  .footer-btn-danger:hover { background: color-mix(in srgb, var(--error) 12%, transparent); color: var(--error); }
  .complete-btn {
    padding: 6px 8px;
    color: var(--success, #16a34a);
    border-color: transparent;
  }
  .complete-btn:hover { background: color-mix(in srgb, var(--success, #16a34a) 14%, transparent); color: var(--success, #16a34a); }
  .complete-btn.reopen { color: var(--text-secondary); }
  .complete-btn.reopen:hover { color: var(--text-primary); background: var(--surface-hover); }
  .save-btn { background: var(--accent); color: white; border-color: var(--accent); }
  .save-btn:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: white; }
  .save-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .cancel-btn { color: var(--text-secondary); }
</style>
