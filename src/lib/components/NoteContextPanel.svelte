<script>
  // Live Context Panel — Notes pillar's stake. A right-side panel that shows
  // a note's surrounding world: linked event(s), live task rail, project
  // health row, and (when there's history) an estimation callout.
  //
  // Reads /api/notes/:id/context. Refetches on a 60s interval while open so
  // task completion / event progress stays live.

  import { onMount, onDestroy } from 'svelte';
  import { api } from '../api.js';
  import { tooltip } from '../actions/tooltip.js';

  let { noteId, onclose = () => {} } = $props();

  let ctx = $state(null);
  let loading = $state(true);
  let error = $state(null);
  let interval;

  async function load() {
    if (!noteId) return;
    try {
      const res = await api(`/api/notes/${encodeURIComponent(noteId)}/context`);
      if (res?.ok) ctx = res;
      else error = res?.error || 'Could not load context.';
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

  function fmtDuration(ms) {
    if (ms == null || ms < 0) return '—';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
  }

  function eventLabel(ev) {
    if (!ev) return '';
    if (ev.state === 'inProgress') return `In progress · ${fmtDuration(ev.countdownMs)} left`;
    if (ev.state === 'upcoming') return `In ${fmtDuration(ev.countdownMs)}`;
    return `${fmtDuration(ev.elapsedMs)} ago`;
  }

  function taskDueLabel(t) {
    if (t.isCompleted) return 'Done';
    if (t.isOverdue) return 'Overdue';
    if (t.dueDatetime) {
      const dt = new Date(t.dueDatetime);
      return dt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    if (t.dueDate) {
      const dt = new Date(`${t.dueDate}T12:00:00`);
      return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return 'No date';
  }
</script>

<aside class="ctx-panel" aria-label="Note context">
  <header class="ctx-head">
    <h3>Context</h3>
    <button class="ctx-close" onclick={onclose} aria-label="Hide context panel" use:tooltip={'Hide'}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M9.5 3.5l-5 7M4.5 3.5l5 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
    </button>
  </header>

  {#if loading && !ctx}
    <div class="ctx-loading">
      <div class="sk-line w50"></div>
      <div class="sk-line w90"></div>
      <div class="sk-line w70"></div>
    </div>
  {:else if error}
    <p class="ctx-error">{error}</p>
  {:else if ctx}
    <!-- ===== Event card ===== -->
    {#if ctx.event}
      <section class="card card-event card-{ctx.event.state}">
        <p class="card-meta">
          {#if ctx.event.state === 'inProgress'}Happening now{:else if ctx.event.state === 'upcoming'}Upcoming event{:else}Past event{/if}
        </p>
        <h4 class="card-title">{ctx.event.summary || '(untitled)'}</h4>
        <p class="card-line">{eventLabel(ctx.event)}</p>
        <p class="card-sub">
          {ctx.event.durationMin}m
          {#if ctx.event.location}· {ctx.event.location}{/if}
        </p>
      </section>
    {:else}
      <section class="card card-empty">
        <p class="card-meta">No linked event</p>
        <p class="card-sub">Drop an event onto this note from the calendar to thread it here.</p>
      </section>
    {/if}

    <!-- ===== Task rail ===== -->
    <section class="rail">
      <header class="rail-head">
        <h4>Tasks</h4>
        {#if ctx.tasks.length > 0}
          <span class="rail-count">{ctx.tasks.filter(t => !t.isCompleted).length} open</span>
        {/if}
      </header>
      {#if ctx.tasks.length === 0}
        <p class="rail-empty">No tasks linked yet.</p>
      {:else}
        <ul class="rail-list">
          {#each ctx.tasks as t (t.id)}
            <li class="rail-item" class:done={t.isCompleted} class:overdue={t.isOverdue}>
              <span class="rail-dot" aria-hidden="true"></span>
              <span class="rail-text">{t.content}</span>
              <span class="rail-due">{taskDueLabel(t)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- ===== Project health row ===== -->
    {#if ctx.project}
      <section class="card card-project">
        <p class="card-meta">Project</p>
        <h4 class="card-title">{ctx.project.name}</h4>
        <ul class="health-row">
          <li>
            <span class="h-num">{ctx.project.openTaskCount}</span>
            <span class="h-label">open</span>
          </li>
          <li class:concern={ctx.project.overdueCount > 0}>
            <span class="h-num">{ctx.project.overdueCount}</span>
            <span class="h-label">overdue</span>
          </li>
          <li>
            <span class="h-num">{ctx.project.completed7d}</span>
            <span class="h-label">done · 7d</span>
          </li>
        </ul>
        {#if ctx.project.estimation}
          <p class="estimation-note" class:slow={ctx.project.estimation.ratio >= 1.0}>
            {ctx.project.estimation.sentence}
          </p>
        {/if}
      </section>
    {/if}
  {/if}
</aside>

<style>
  .ctx-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 280px;
    background: var(--surface);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 5;
    animation: ctxIn 220ms cubic-bezier(.2,.7,.2,1) both;
  }
  @keyframes ctxIn {
    from { transform: translateX(20px); opacity: 0; }
    to   { transform: translateX(0); opacity: 1; }
  }

  .ctx-head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border);
  }
  .ctx-head h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .ctx-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    width: 24px;
    height: 24px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .ctx-close:hover { background: var(--hover); color: var(--text-primary); }

  .ctx-loading {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sk-line {
    height: 10px;
    background: var(--hover);
    border-radius: 4px;
    animation: pulse 1.4s ease-in-out infinite;
  }
  .sk-line.w50 { width: 50%; }
  .sk-line.w70 { width: 70%; }
  .sk-line.w90 { width: 90%; }
  @keyframes pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
  .ctx-error {
    padding: 16px;
    color: var(--text-tertiary);
    font-size: 13px;
  }

  .card {
    margin: 12px;
    padding: 12px 14px;
    border-radius: var(--radius-md, 8px);
    background: var(--hover);
    border: 1px solid var(--border);
  }
  .card.card-empty {
    background: transparent;
    border-style: dashed;
  }
  .card.card-inProgress {
    background: color-mix(in srgb, var(--accent, #3b82f6) 8%, var(--hover));
    border-color: color-mix(in srgb, var(--accent, #3b82f6) 25%, var(--border));
  }
  .card-meta {
    margin: 0 0 4px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-tertiary);
    font-weight: 500;
  }
  .card-title {
    margin: 0 0 6px;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.35;
  }
  .card-line {
    margin: 0;
    font-size: 13px;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }
  .card-sub {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.4;
  }

  .rail {
    margin: 4px 12px 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
  }
  .rail-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .rail-head h4 {
    margin: 0;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .rail-count {
    font-size: 11px;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .rail-empty {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .rail-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rail-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .rail-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: 0 0 auto;
    background: var(--text-tertiary);
  }
  .rail-item.overdue .rail-dot { background: var(--error, #c25e4d); }
  .rail-item.done .rail-dot {
    background: var(--accent, #3b82f6);
    opacity: 0.4;
  }
  .rail-text {
    flex: 1;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.4;
  }
  .rail-item.done .rail-text {
    text-decoration: line-through;
    color: var(--text-tertiary);
  }
  .rail-due {
    font-size: 11px;
    color: var(--text-tertiary);
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }
  .rail-item.overdue .rail-due { color: var(--error, #c25e4d); }

  .health-row {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: flex;
    gap: 18px;
  }
  .health-row li {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .health-row li.concern { color: var(--error, #c25e4d); }
  .h-num {
    font-size: 18px;
    font-weight: 500;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }
  .health-row li.concern .h-num { color: var(--error, #c25e4d); }
  .h-label {
    font-size: 10px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .estimation-note {
    margin: 10px 0 0;
    padding: 8px 10px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--text-secondary) 8%, transparent);
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.4;
  }
  .estimation-note.slow {
    background: color-mix(in srgb, var(--error, #c25e4d) 10%, transparent);
    color: var(--error, #c25e4d);
  }

  @media (max-width: 880px) {
    .ctx-panel { display: none; }
  }
</style>
