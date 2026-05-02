<script>
  import { getContext } from 'svelte';
  import { createEvent, updateEvent } from '../stores/events.svelte.js';
  import { getCalendars } from '../stores/calendars.svelte.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { PASTEL_COLORS } from '../utils/colors.js';
  import { api } from '../api.js';
  import Dropdown from './Dropdown.svelte';
  import { tooltip } from '../actions/tooltip.js';

  let { event = null, defaultStart = null, defaultEnd = null, onclose = () => {} } = $props();
  const appCtx = getContext('app');

  // Convert this in-progress event into a task draft. Carries title +
  // description. Due date carries over only when editing an existing event
  // — for a brand-new event, the start time is auto-set to "now" and would
  // make a fresh task look immediately overdue.
  function switchToTask() {
    const draft = {
      content: summary || '',
      description: description || '',
      priority: 1,
      projectId: null,
      labels: [],
    };
    if (isEdit && startDate) {
      if (allDay || !startTime) {
        draft.dueDate = startDate;
      } else {
        draft.dueDatetime = `${startDate}T${startTime}:00`;
      }
    }
    onclose();
    appCtx?.editTask?.(draft);
  }

  const cals = getCalendars();
  const prefs = getPrefs();

  const isEdit = $derived(!!event?.id);

  let summary = $state(event?.summary || '');
  let startDate = $state('');
  let startTime = $state('');
  let endDate = $state('');
  let endTime = $state('');
  let allDay = $state(event?.allDay || false);
  let location = $state(event?.location || '');
  let description = $state(event?.description || '');
  let calendarId = $state(event?.calendarId || '');
  let colorIndex = $state(0);
  let recurrence = $state('none');
  let recurrenceUntil = $state('');
  // For editing instances of a recurring series.
  let recurrenceScope = $state('instance'); // 'instance' | 'series' | 'following'

  // Templates: load on mount; user can pick to prefill the form.
  let templates = $state([]);
  $effect(() => {
    if (isEdit) return;
    api('/api/event-templates').then(r => {
      if (r?.ok) templates = r.templates || [];
    }).catch(() => {});
  });

  function applyTemplate(tplId) {
    const t = templates.find(x => x.id === Number(tplId));
    if (!t) return;
    summary = t.summary || t.name;
    description = t.description || '';
    location = t.location || '';
    if (t.calendarId) calendarId = t.calendarId;
    // Adjust end based on template duration.
    const s = startDate && startTime ? new Date(`${startDate}T${startTime}`) : new Date();
    const e = new Date(s.getTime() + (t.durationMinutes || 30) * 60000);
    endDate = formatLocalDate(e);
    endTime = formatLocalTime(e);
  }
  // True when editing an event that is part of a recurring series.
  const isRecurring = $derived(!!event?.recurringEventId || !!(event?.recurrence && event.recurrence.length));

  // Initialize dates from props. We re-run only when the *event* identity
  // changes — referencing prefs.values.defaultEventDuration inside this
  // effect previously caused any pref update (color scheme, theme, etc.)
  // to overwrite in-progress edits with the original event's values.
  // Capture the duration eagerly via $derived.by() outside the effect so the
  // dependency graph excludes prefs once the effect has run for this event.
  let lastEventKey = $state(null);
  $effect(() => {
    const key = event ? `${event.calendarId}|${event.id || 'new'}|${event.start}|${event.end}|${event.allDay}` : 'none';
    if (key === lastEventKey) return;
    lastEventKey = key;

    let s, e;
    if (event?.allDay && event?.start) {
      // Parse all-day strings as LOCAL midnight (not UTC) and convert
      // Google's exclusive end back to inclusive for display.
      const [sy, sm, sd] = String(event.start).slice(0, 10).split('-').map(Number);
      s = new Date(sy, sm - 1, sd);
      const [ey, em, ed] = String(event.end || event.start).slice(0, 10).split('-').map(Number);
      e = new Date(ey, em - 1, ed - 1);
      if (e < s) e = new Date(s);
    } else {
      s = event?.start ? new Date(event.start) : (defaultStart || new Date());
      e = event?.end ? new Date(event.end) :
        (defaultEnd || new Date(s.getTime() + (prefs.values.defaultEventDuration || 30) * 60000));
    }

    startDate = formatLocalDate(s);
    startTime = formatLocalTime(s);
    endDate = formatLocalDate(e);
    endTime = formatLocalTime(e);

    if (!calendarId && cals.items.length > 0) {
      calendarId = cals.items.find(c => c.primaryCal)?.id || cals.items[0]?.id || '';
    }
  });

  function formatLocalDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function formatLocalTime(d) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  async function handleSave() {
    const start = allDay ? `${startDate}T00:00:00` : `${startDate}T${startTime}:00`;
    const end = allDay ? `${endDate}T23:59:59` : `${endDate}T${endTime}:00`;

    // Build recurrence value: preset string OR object with until.
    let recurrenceValue = null;
    if (recurrence !== 'none') {
      if (recurrenceUntil) {
        const freqMap = {
          daily: 'DAILY', weekly: 'WEEKLY', biweekly: 'WEEKLY',
          monthly: 'MONTHLY', yearly: 'YEARLY', weekdays: 'WEEKLY',
        };
        const freq = freqMap[recurrence] || 'WEEKLY';
        recurrenceValue = { freq, until: recurrenceUntil };
        if (recurrence === 'biweekly') recurrenceValue.interval = 2;
        if (recurrence === 'weekdays') recurrenceValue.byDay = ['MO','TU','WE','TH','FR'];
      } else {
        recurrenceValue = recurrence;
      }
    }

    const data = {
      summary,
      start,
      end,
      allDay,
      location,
      description,
      calendarId,
      recurrence: recurrenceValue,
    };
    if (isEdit && isRecurring) data.scope = recurrenceScope;

    if (isEdit) {
      await updateEvent(event.calendarId, event.id, data);
    } else {
      await createEvent(data);
    }
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
</script>

<!--
  Modal dialog. Backdrop is purely visual + click-to-close convenience;
  Esc on the modal itself also closes (via handleKeydown), so the
  backdrop's lack of keyboard equivalent is OK — the user can already
  dismiss without a mouse. role=presentation on backdrop tells SR to
  ignore it; role=dialog + aria-modal on the modal traps SR cursor.
-->
<div class="editor-backdrop" onclick={onclose} role="presentation"></div>
<div class="editor-modal" role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit event' : 'New event'} onkeydown={handleKeydown}>
  <div class="editor-header">
    <h2>{isEdit ? 'Edit Event' : 'New Event'}</h2>
    <div class="header-actions">
      {#if !isEdit}
        <button class="switch-type" onclick={switchToTask} use:tooltip={'Convert to a task — title, notes, and date carry over'}>
          Convert to task →
        </button>
      {/if}
      <button class="close-btn" onclick={onclose}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M13.5 4.5L4.5 13.5M4.5 4.5L13.5 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </div>

  <div class="editor-body">
    {#if !isEdit && templates.length > 0}
      <div class="field template-picker">
        <label class="field-label">Use template</label>
        <Dropdown
          value={null}
          ariaLabel="Template"
          placeholder="Choose a template…"
          onchange={(v) => { if (v) applyTemplate(v); }}
          options={templates.map(t => ({ value: t.id, label: t.name }))}
        />
      </div>
    {/if}

    <div class="field">
      <input
        type="text"
        bind:value={summary}
        placeholder="Event title"
        class="title-input"
      />
    </div>

    <div class="field-row">
      <label class="toggle-label">
        <input type="checkbox" bind:checked={allDay} />
        All day
      </label>
    </div>

    <div class="field-row">
      <div class="field">
        <label class="field-label">Start</label>
        <input type="date" bind:value={startDate} />
        {#if !allDay}
          <input type="time" bind:value={startTime} />
        {/if}
      </div>
      <div class="field">
        <label class="field-label">End</label>
        <input type="date" bind:value={endDate} />
        {#if !allDay}
          <input type="time" bind:value={endTime} />
        {/if}
      </div>
    </div>

    <div class="field">
      <label class="field-label">Location</label>
      <input type="text" bind:value={location} placeholder="Add location" />
    </div>

    <div class="field">
      <label class="field-label">Description</label>
      <textarea bind:value={description} placeholder="Add description" rows="6"></textarea>
    </div>

    <div class="field-row">
      <div class="field">
        <label class="field-label">Calendar</label>
        <Dropdown
          bind:value={calendarId}
          ariaLabel="Calendar"
          options={cals.items.map(c => ({ value: c.id, label: c.summary }))}
        />
      </div>

      <div class="field">
        <label class="field-label">Repeat</label>
        <Dropdown
          bind:value={recurrence}
          ariaLabel="Repeat"
          options={[
            { value: 'none', label: 'No repeat' },
            { value: 'daily', label: 'Daily' },
            { value: 'weekdays', label: 'Weekdays (Mon–Fri)' },
            { value: 'weekly', label: 'Weekly' },
            { value: 'biweekly', label: 'Every 2 weeks' },
            { value: 'monthly', label: 'Monthly' },
            { value: 'yearly', label: 'Yearly' },
          ]}
        />
      </div>
    </div>
    {#if recurrence !== 'none'}
      <div class="field-row">
        <div class="field">
          <label class="field-label">End repeat (optional)</label>
          <input type="date" bind:value={recurrenceUntil} min={startDate} />
        </div>
        {#if isEdit && isRecurring}
          <div class="field">
            <label class="field-label">Apply change to</label>
            <Dropdown
              bind:value={recurrenceScope}
              ariaLabel="Apply change to"
              options={[
                { value: 'instance', label: 'This event only' },
                { value: 'following', label: 'This and following' },
                { value: 'series', label: 'All events in series' },
              ]}
            />
          </div>
        {/if}
      </div>
    {/if}

    <div class="field">
      <label class="field-label">Color</label>
      <div class="color-picker">
        {#each PASTEL_COLORS as c, i}
          <button
            class="color-swatch"
            class:selected={colorIndex === i}
            style="background: var({c.varName}, {c.light})"
            onclick={() => colorIndex = i}
            use:tooltip={c.name}
          ></button>
        {/each}
      </div>
    </div>
  </div>

  <div class="editor-footer">
    <button class="cancel-btn" onclick={onclose}>Cancel</button>
    <button class="save-btn" onclick={handleSave}>
      {isEdit ? 'Save' : 'Create'}
    </button>
  </div>
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
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--border-light);
  }

  .editor-header h2 {
    font-size: 16px;
    font-weight: 600;
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
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }

  .field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .field-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
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
  input:focus, select:focus, textarea:focus {
    border-color: var(--accent);
  }
  textarea { resize: vertical; min-height: 120px; }

  select {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' fill='none' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 28px;
    cursor: pointer;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    cursor: pointer;
  }
  .toggle-label input { width: 16px; height: 16px; cursor: pointer; accent-color: var(--accent); }

  .color-picker {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .color-swatch {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
  }
  .color-swatch:hover { transform: scale(1.15); }
  .color-swatch.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-light); }

  .editor-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--border-light);
    background: var(--bg-secondary);
  }

  .cancel-btn, .save-btn {
    padding: 6px 16px;
    border: none;
    border-radius: var(--radius-md);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .cancel-btn { background: var(--surface); color: var(--text-secondary); border: 1px solid var(--border); }
  .cancel-btn:hover { background: var(--surface-hover); }
  .save-btn { background: var(--accent); color: white; }
  .save-btn:hover { background: var(--accent-hover); }
</style>
