<script>
  /*
   * ProjectPage — the project as a first-class destination, not a filter.
   *
   * Hero: project name + momentum dot + due-date countdown + intent line.
   * Body: tasks list, linked events, linked notes, time-spent slice.
   *
   * Tier A is read-mostly. Inline editors for intent line, due date,
   * rhythm, and pin/unpin land in Tier B (this same file).
   */
  import { onMount, onDestroy, getContext } from 'svelte';
  import { api } from '../api.js';
  import { showToast } from '../utils/toast.svelte.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';
  import { navigate, getRoute } from '../stores/routeStore.svelte.js';
  import { setAppView } from '../stores/appView.svelte.js';
  import { setDate } from '../stores/view.svelte.js';

  const route = getRoute();
  const appCtx = getContext('app');

  let ctx = $state(null);
  let loading = $state(true);
  let error = $state(null);
  let interval;
  // Inline-edit state
  let editingIntent = $state(false);
  let intentDraft = $state('');
  let editingDueDate = $state(false);
  let dueDateDraft = $state('');
  let savingMeta = $state(false);
  let editingRhythm = $state(false);
  let rhythmDraft = $state(emptyRhythm());

  function emptyRhythm() {
    return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
  }

  async function load() {
    const projectId = route.projectId;
    if (!projectId) return;
    try {
      const res = await api(`/api/projects/${encodeURIComponent(projectId)}/context`);
      if (res?.ok) {
        ctx = res;
        // Initialize draft state with what's saved
        intentDraft = res.meta.intentLine || '';
        dueDateDraft = res.meta.dueDate || '';
        rhythmDraft = res.meta.rhythm
          ? { ...emptyRhythm(), ...res.meta.rhythm }
          : emptyRhythm();
      } else {
        error = res?.error || 'Could not load project.';
      }
    } catch (e) {
      error = String(e?.message || e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    load();
    interval = setInterval(load, 60_000);
  });
  onDestroy(() => { if (interval) clearInterval(interval); });

  // ---- Meta upserts ----
  async function saveMeta(patch) {
    if (!ctx) return;
    savingMeta = true;
    try {
      const res = await api(
        `/api/project-meta/${encodeURIComponent(ctx.project.id)}`,
        { method: 'PUT', body: JSON.stringify(patch) }
      );
      if (res?.ok) {
        ctx.meta = {
          dueDate: res.item?.dueDate ?? null,
          intentLine: res.item?.intentLine ?? null,
          rhythm: res.item?.rhythm ?? null,
          pinnedAt: res.item?.pinnedAt ?? null,
        };
      } else if (res?.code === 'pin_limit') {
        showToast(res.error || 'Pin limit reached', 'error');
      }
    } catch (e) {
      showToast(String(e?.message || e), 'error');
    } finally {
      savingMeta = false;
    }
  }

  function commitIntent() {
    const trimmed = intentDraft.trim();
    saveMeta({ intentLine: trimmed || null });
    editingIntent = false;
  }
  function commitDueDate() {
    saveMeta({ dueDate: dueDateDraft || null });
    editingDueDate = false;
  }
  async function togglePin() {
    if (!ctx) return;
    await saveMeta({ pinned: !ctx.meta.pinnedAt });
  }
  async function clearDueDate() {
    if (!await confirmAction({ title: 'Clear project due date?', message: 'You can re-add it any time.' })) return;
    dueDateDraft = '';
    saveMeta({ dueDate: null });
  }
  async function clearIntent() {
    if (!await confirmAction({ title: 'Remove project intent line?', message: '"What does done look like" — leave it empty?' })) return;
    intentDraft = '';
    saveMeta({ intentLine: null });
  }
  function commitRhythm() {
    // Strip empty days entirely so the JSON stays terse.
    const clean = {};
    for (const day of ['mon','tue','wed','thu','fri','sat','sun']) {
      const ws = (rhythmDraft[day] || []).filter(w => w.start && w.end && w.start < w.end);
      if (ws.length) clean[day] = ws;
    }
    saveMeta({ rhythm: Object.keys(clean).length ? clean : null });
    editingRhythm = false;
  }
  function addRhythmWindow(day) {
    rhythmDraft[day] = [...(rhythmDraft[day] || []), { start: '09:00', end: '12:00' }];
  }
  function removeRhythmWindow(day, idx) {
    rhythmDraft[day] = (rhythmDraft[day] || []).filter((_, i) => i !== idx);
  }

  // ---- Format helpers ----
  function fmtCountdown(dueDate) {
    if (!dueDate) return null;
    const now = new Date();
    const target = new Date(`${dueDate}T23:59:59`).getTime();
    const days = Math.floor((target - now.getTime()) / 86_400_000);
    if (days < 0) return { text: `Overdue by ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'}`, tone: 'overdue' };
    if (days === 0) return { text: 'Due today', tone: 'soon' };
    if (days === 1) return { text: 'Due tomorrow', tone: 'soon' };
    if (days <= 3) return { text: `${days} days left`, tone: 'soon' };
    if (days <= 14) return { text: `${days} days left`, tone: 'amber' };
    return { text: `${days} days left`, tone: 'green' };
  }
  function fmtMomentum(m) {
    return {
      moving: { label: 'Moving', tone: 'green' },
      stalled: { label: 'Stalled', tone: 'amber' },
      idle: { label: 'At rest', tone: 'gray' },
    }[m] || { label: m, tone: 'gray' };
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch { return ''; }
  }
  function fmtDate(ymd) {
    if (!ymd) return '';
    try {
      return new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return ymd; }
  }
  function fmtMinutes(m) {
    if (!m) return '0m';
    const h = m / 60;
    if (h >= 1) return `${h.toFixed(1)}h`;
    return `${m}m`;
  }

  function openTask(t) {
    if (appCtx?.editTask) {
      // Hydrate by fetching the live task — the editor expects a fuller shape.
      api(`/api/tasks/${encodeURIComponent(t.id)}`).then(res => {
        if (res?.task) appCtx.editTask(res.task);
        else appCtx.editTask({ id: t.id, content: t.content, priority: t.priority || 1 });
      }).catch(() => appCtx.editTask({ id: t.id, content: t.content, priority: t.priority || 1 }));
    }
  }
  function openEvent(e) {
    if (e.start) setDate(new Date(e.start));
    setAppView('calendar');
    navigate('/');
  }
  function openNote(n) {
    if (appCtx?.editNote) appCtx.editNote(n);
  }

  // Reactive derivations
  const countdown = $derived(ctx ? fmtCountdown(ctx.meta.dueDate) : null);
  const momentum = $derived(ctx ? fmtMomentum(ctx.momentum.momentum) : null);
  const openTasks = $derived(ctx ? ctx.tasks.filter(t => !t.isCompleted) : []);
  const doneTasks = $derived(ctx ? ctx.tasks.filter(t =>  t.isCompleted) : []);
</script>

<div class="project-page">
  <button class="back-btn" onclick={() => { setAppView('tasks'); navigate('/'); }}>
    ← Back
  </button>

  {#if loading && !ctx}
    <div class="loading">Loading project…</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if ctx}
    <header class="hero">
      <div class="hero-top">
        <div class="title-row">
          {#if ctx.project.color}
            <span class="title-swatch" style="background: {ctx.project.color}"></span>
          {/if}
          <h1>{ctx.project.name}</h1>
          {#if momentum}
            <span class="dot dot-{momentum.tone}" title={momentum.label}></span>
            <span class="momentum-label">{momentum.label}</span>
          {/if}
        </div>
        <div class="actions">
          <button
            class="btn"
            class:active={!!ctx.meta.pinnedAt}
            onclick={togglePin}
            disabled={savingMeta}
            title={ctx.meta.pinnedAt ? 'Unpin from decision surface' : 'Pin to decision surface'}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
              <path d="M8 2v6M5 8h6M6 14l2-2 2 2"/>
            </svg>
            {ctx.meta.pinnedAt ? 'Pinned' : 'Pin'}
          </button>
        </div>
      </div>

      <!-- Intent line (one-line "what does done look like") -->
      <div class="intent-row">
        {#if editingIntent}
          <input
            class="intent-input"
            bind:value={intentDraft}
            placeholder='What does "done" look like?'
            maxlength="280"
            onblur={commitIntent}
            onkeydown={(e) => { if (e.key === 'Enter') commitIntent(); if (e.key === 'Escape') { editingIntent = false; intentDraft = ctx.meta.intentLine || ''; } }}
            autofocus
          />
        {:else if ctx.meta.intentLine}
          <button class="intent-text" onclick={() => editingIntent = true}>
            {ctx.meta.intentLine}
            <span class="edit-hint">edit</span>
          </button>
          <button class="intent-clear" onclick={clearIntent} title="Remove intent line">×</button>
        {:else}
          <button class="intent-empty" onclick={() => editingIntent = true}>
            + Add a one-line intent
          </button>
        {/if}
      </div>

      <!-- Stats bar -->
      <div class="stats">
        <div class="stat">
          <span class="stat-num">{openTasks.length}</span>
          <span class="stat-label">open</span>
        </div>
        <div class="stat">
          <span class="stat-num">{doneTasks.length}</span>
          <span class="stat-label">done</span>
        </div>
        <div class="stat">
          <span class="stat-num">{ctx.momentum.completed7d}</span>
          <span class="stat-label">done · 7d</span>
        </div>
        {#if ctx.timeSpent.taskMinutesTotal > 0}
          <div class="stat">
            <span class="stat-num">{fmtMinutes(ctx.timeSpent.taskMinutesTotal)}</span>
            <span class="stat-label">time spent</span>
          </div>
        {/if}
        <div class="stat stat-due">
          {#if editingDueDate}
            <input
              type="date"
              bind:value={dueDateDraft}
              onblur={commitDueDate}
              onkeydown={(e) => { if (e.key === 'Enter') commitDueDate(); if (e.key === 'Escape') { editingDueDate = false; dueDateDraft = ctx.meta.dueDate || ''; } }}
              autofocus
            />
          {:else if countdown}
            <button class="due-btn due-{countdown.tone}" onclick={() => editingDueDate = true}>
              {countdown.text}
              <span class="due-date">{fmtDate(ctx.meta.dueDate)}</span>
            </button>
            <button class="due-clear" onclick={clearDueDate} title="Clear due date">×</button>
          {:else}
            <button class="due-empty" onclick={() => editingDueDate = true}>+ Due date</button>
          {/if}
        </div>
      </div>
    </header>

    <!-- ===== Tasks ===== -->
    <section class="card">
      <header class="card-head">
        <h3>Tasks</h3>
        {#if openTasks.length > 0}<span class="muted">{openTasks.length} open</span>{/if}
      </header>
      {#if ctx.tasks.length === 0}
        <p class="empty">No tasks in this project yet.</p>
      {:else}
        <ul class="task-list">
          {#each openTasks as t (t.id)}
            <li class="task-row" class:overdue={t.dueDate && new Date(`${t.dueDate}T00:00:00`) < new Date()}>
              <button class="task-tap" onclick={() => openTask(t)}>
                <span class="task-content">{t.content}</span>
                <span class="task-meta">
                  {#if t.dueDate}<span>{fmtDate(t.dueDate)}</span>{/if}
                  {#if t.priority && t.priority >= 3}<span class="priority-chip">P{5 - t.priority}</span>{/if}
                  {#if t.estimatedMinutes}<span>{t.estimatedMinutes}m</span>{/if}
                </span>
              </button>
            </li>
          {/each}
          {#if doneTasks.length > 0}
            <li class="done-divider">
              <span>{doneTasks.length} done</span>
            </li>
            {#each doneTasks.slice(0, 5) as t (t.id)}
              <li class="task-row done">
                <button class="task-tap" onclick={() => openTask(t)}>
                  <span class="task-content">{t.content}</span>
                  {#if t.completedAt}
                    <span class="task-meta"><span>{fmtDate(t.completedAt.slice(0, 10))}</span></span>
                  {/if}
                </button>
              </li>
            {/each}
          {/if}
        </ul>
      {/if}
    </section>

    <!-- ===== Linked events ===== -->
    {#if ctx.events.length > 0}
      <section class="card">
        <header class="card-head">
          <h3>Linked events</h3>
        </header>
        <ul class="event-list">
          {#each ctx.events as e}
            <li class="event-row">
              <button class="task-tap" onclick={() => openEvent(e)}>
                <span class="task-content">{e.summary || '(untitled)'}</span>
                <span class="task-meta">
                  {fmtDateTime(e.start)}
                  {#if e.location}· {e.location}{/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- ===== Linked notes ===== -->
    {#if ctx.notes.length > 0}
      <section class="card">
        <header class="card-head">
          <h3>Linked notes</h3>
        </header>
        <ul class="note-list">
          {#each ctx.notes as n}
            <li class="note-row">
              <button class="task-tap" onclick={() => openNote(n)}>
                <span class="task-content">{n.title || '(untitled)'}</span>
                <span class="note-preview">{n.bodyPreview}</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- ===== Rhythm ===== -->
    <section class="card">
      <header class="card-head">
        <h3>Rhythm</h3>
        <button class="muted-btn" onclick={() => editingRhythm = !editingRhythm}>
          {editingRhythm ? 'Done' : (ctx.meta.rhythm ? 'Edit' : 'Set')}
        </button>
      </header>
      {#if editingRhythm}
        <div class="rhythm-edit">
          {#each [['mon','Mon'],['tue','Tue'],['wed','Wed'],['thu','Thu'],['fri','Fri'],['sat','Sat'],['sun','Sun']] as [k, label]}
            <div class="rhythm-day">
              <span class="rhythm-label">{label}</span>
              <div class="rhythm-windows">
                {#each (rhythmDraft[k] || []) as w, i}
                  <div class="rhythm-window">
                    <input type="time" bind:value={rhythmDraft[k][i].start} />
                    <span>–</span>
                    <input type="time" bind:value={rhythmDraft[k][i].end} />
                    <button onclick={() => removeRhythmWindow(k, i)} title="Remove">×</button>
                  </div>
                {/each}
                <button class="add-window" onclick={() => addRhythmWindow(k)}>+ Add window</button>
              </div>
            </div>
          {/each}
          <div class="rhythm-foot">
            <button class="btn-primary" onclick={commitRhythm} disabled={savingMeta}>Save rhythm</button>
          </div>
        </div>
      {:else if ctx.meta.rhythm}
        <ul class="rhythm-summary">
          {#each Object.entries(ctx.meta.rhythm) as [day, windows]}
            <li>
              <span class="rhythm-day-label">{day}</span>
              <span>
                {(windows || []).map(w => `${w.start}–${w.end}`).join(', ')}
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty muted">When do you typically work on this? Setting a rhythm boosts this project's tasks in the decision surface during those windows.</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .project-page {
    flex: 1;
    overflow-y: auto;
    padding: 32px 48px;
    max-width: 920px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }
  .back-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    font-size: 13px;
    padding: 4px 0;
    margin-bottom: 14px;
  }
  .back-btn:hover { color: var(--text-secondary); }
  .loading, .error { color: var(--text-tertiary); padding: 80px 0; text-align: center; }
  .error { color: var(--error, #c25e4d); }

  /* ---- Hero ---- */
  .hero {
    border-bottom: 1px solid var(--border);
    padding-bottom: 24px;
    margin-bottom: 24px;
  }
  .hero-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
  }
  .title-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .title-row h1 {
    margin: 0;
    font-family: var(--font-display, 'Fraunces', serif);
    font-weight: 380;
    font-size: 32px;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    line-height: 1.2;
  }
  .title-swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    align-self: center;
    box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.1);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    align-self: center;
  }
  .dot-green { background: #15803d; }
  .dot-amber { background: #b45309; }
  .dot-gray { background: var(--text-tertiary); }
  .momentum-label {
    font-size: 12px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .actions { display: flex; gap: 8px; align-items: center; }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-primary);
    padding: 6px 12px;
    border-radius: var(--radius-sm, 6px);
    cursor: pointer;
    font-size: 13px;
  }
  .btn:hover { background: var(--hover); }
  .btn.active {
    background: color-mix(in srgb, var(--accent, #3b82f6) 12%, transparent);
    border-color: color-mix(in srgb, var(--accent, #3b82f6) 35%, var(--border));
    color: var(--accent, #3b82f6);
  }

  /* Intent line */
  .intent-row {
    margin-top: 14px;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .intent-text, .intent-empty {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 14px;
    padding: 4px 0;
    text-align: left;
    cursor: pointer;
    line-height: 1.5;
  }
  .intent-text:hover, .intent-empty:hover { color: var(--text-primary); }
  .intent-empty { color: var(--text-tertiary); }
  .intent-input {
    flex: 1;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 6px);
    padding: 6px 10px;
    font-size: 14px;
    background: var(--surface);
    color: var(--text-primary);
  }
  .intent-clear {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    font-size: 16px;
  }
  .intent-clear:hover { background: var(--hover); }
  .edit-hint {
    margin-left: 6px;
    font-size: 11px;
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .intent-text:hover .edit-hint { opacity: 1; }

  /* Stats bar */
  .stats {
    margin-top: 20px;
    display: flex;
    gap: 28px;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stat-num {
    font-size: 22px;
    font-weight: 500;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }
  .stat-label {
    font-size: 11px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .stat-due { display: flex; flex-direction: row; align-items: center; gap: 4px; }

  .due-btn, .due-empty {
    background: var(--hover);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text-primary);
  }
  .due-empty { color: var(--text-tertiary); background: transparent; }
  .due-empty:hover { color: var(--text-primary); }
  .due-overdue { background: color-mix(in srgb, var(--error, #c25e4d) 14%, transparent); color: var(--error, #c25e4d); border-color: color-mix(in srgb, var(--error, #c25e4d) 30%, var(--border)); }
  .due-soon  { background: color-mix(in srgb, var(--error, #c25e4d) 8%, transparent); }
  .due-amber { background: color-mix(in srgb, #b45309 10%, transparent); color: #b45309; }
  .due-green { background: color-mix(in srgb, #15803d 8%, transparent); color: #15803d; }
  .due-date { color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
  .due-clear {
    background: none; border: none; cursor: pointer;
    color: var(--text-tertiary); width: 20px; height: 20px;
    border-radius: 3px;
  }
  .due-clear:hover { background: var(--hover); }

  /* ---- Cards ---- */
  .card {
    margin-bottom: 18px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
    background: var(--surface);
    overflow: hidden;
  }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .card-head h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .muted, .muted-btn {
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .muted-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--text-tertiary) 40%, transparent);
    text-underline-offset: 3px;
  }
  .muted-btn:hover { color: var(--text-secondary); }

  .empty { padding: 16px; color: var(--text-tertiary); margin: 0; font-size: 13px; }

  /* ---- Lists ---- */
  .task-list, .event-list, .note-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .task-row, .event-row, .note-row {
    border-bottom: 1px solid var(--border);
  }
  .task-row:last-child, .event-row:last-child, .note-row:last-child { border-bottom: none; }
  .task-tap {
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: 12px 16px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text-primary);
  }
  .task-tap:hover { background: var(--hover); }
  .task-content {
    font-size: 14px;
    color: var(--text-primary);
    line-height: 1.4;
  }
  .task-meta {
    display: flex;
    gap: 12px;
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .priority-chip {
    background: color-mix(in srgb, var(--error, #c25e4d) 14%, transparent);
    color: var(--error, #c25e4d);
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 500;
  }
  .task-row.overdue .task-content { color: var(--error, #c25e4d); }
  .task-row.done .task-content {
    color: var(--text-tertiary);
    text-decoration: line-through;
  }
  .done-divider {
    padding: 8px 16px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
    border-bottom: 1px solid var(--border);
    background: var(--hover);
  }
  .note-preview {
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  /* ---- Rhythm editor ---- */
  .rhythm-edit { padding: 14px 16px; }
  .rhythm-day { display: flex; gap: 16px; padding: 6px 0; }
  .rhythm-label {
    width: 36px;
    color: var(--text-secondary);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding-top: 6px;
  }
  .rhythm-windows { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .rhythm-window { display: flex; gap: 8px; align-items: center; }
  .rhythm-window input {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 6px);
    padding: 4px 8px;
    background: var(--surface);
    color: var(--text-primary);
    font-size: 13px;
  }
  .rhythm-window button {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    width: 22px;
    height: 22px;
    border-radius: 3px;
  }
  .rhythm-window button:hover { background: var(--hover); }
  .add-window {
    align-self: flex-start;
    background: none;
    border: 1px dashed var(--border);
    color: var(--text-tertiary);
    padding: 4px 10px;
    border-radius: var(--radius-sm, 6px);
    font-size: 12px;
    cursor: pointer;
  }
  .add-window:hover { color: var(--text-secondary); border-color: var(--text-tertiary); }
  .rhythm-foot {
    margin-top: 10px;
    display: flex;
    justify-content: flex-end;
  }
  .btn-primary {
    background: var(--accent, #3b82f6);
    color: white;
    border: 1px solid var(--accent, #3b82f6);
    padding: 6px 14px;
    border-radius: var(--radius-sm, 6px);
    font-size: 13px;
    cursor: pointer;
  }
  .btn-primary:hover { background: color-mix(in srgb, var(--accent, #3b82f6) 88%, black); }
  .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

  .rhythm-summary {
    list-style: none;
    margin: 0;
    padding: 14px 16px;
    display: grid;
    grid-template-columns: 60px 1fr;
    gap: 6px 16px;
    font-size: 13px;
  }
  .rhythm-day-label {
    color: var(--text-tertiary);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
</style>
