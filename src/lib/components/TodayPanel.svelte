<script>
  /*
   * Today panel — the synthesis surface.
   *
   * Not a modal. A right-anchored side panel that sits beside the calendar
   * rather than over it. The calendar remains visible because the synthesis
   * IS commentary on it; hiding the thing being commented on is wrong.
   *
   * Visual language is intentionally different from system modals:
   *  - No scrim. The canvas is not dimmed.
   *  - Serif display face (Fraunces) for the hero sentence — signals "slow
   *    surface", distinct from the Inter UI everywhere else.
   *  - Tabs are text links (Today · Week · Patterns), not pills.
   *  - Task action buttons are revealed on row hover, not always visible.
   *  - Capacity gauge uses one rail with overlapping fills so the math
   *    (does my work fit in my day?) is one visual question, not two bars.
   *
   * Reads from the prefetched synthesis store so opening Y is instant.
   * Falls back to a calm skeleton if the data isn't warm yet.
   */
  import { getContext, onMount, onDestroy } from 'svelte';
  import { api } from '../api.js';
  import { setDate } from '../stores/view.svelte.js';
  import { setAppView } from '../stores/appView.svelte.js';
  import { showToast } from '../utils/toast.svelte.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';
  import { getSynthesis, refreshToday, clearObservation, refreshLedger, refreshRecommendations } from '../stores/synthesis.svelte.js';
  import { getPrefs, updatePrefs } from '../stores/prefs.svelte.js';
  import VoiceCapture from './VoiceCapture.svelte';

  let { onclose = () => {} } = $props();

  const appCtx = getContext('app');
  const synth = getSynthesis();

  let mounted = $state(false);
  let closing = $state(false);
  let bodyEl;
  let activeSection = $state('today'); // visual highlight on the top jump-links

  function scrollTo(id) {
    const target = bodyEl?.querySelector(`#syn-${id}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- Reactive views over the synthesis store ----
  const today = $derived(synth.today);
  const weekly = $derived(synth.weekly);
  const observation = $derived(synth.observation);
  const ledger = $derived(synth.ledger);
  const recommendations = $derived(synth.recommendations);
  const timeline = $derived(synth.timeline);

  // Type filter for the Timeline section. Defaults to all kinds; user
  // toggles a chip to narrow. Persisted in localStorage so a power user's
  // preferred filter sticks across reloads.
  const ALL_TIMELINE_KINDS = ['note_change', 'task_change', 'event', 'file', 'booking'];
  const TIMELINE_KIND_LABELS = {
    note_change: 'Notes',
    task_change: 'Tasks',
    event:       'Events',
    file:        'Files',
    booking:     'Bookings',
  };
  let timelineFilter = $state(restoreTimelineFilter());
  function restoreTimelineFilter() {
    try {
      const raw = localStorage.getItem('productivity_timeline_filter');
      if (!raw) return new Set(ALL_TIMELINE_KINDS);
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0) return new Set(ALL_TIMELINE_KINDS);
      return new Set(arr.filter(k => ALL_TIMELINE_KINDS.includes(k)));
    } catch { return new Set(ALL_TIMELINE_KINDS); }
  }
  function toggleTimelineKind(k) {
    const next = new Set(timelineFilter);
    if (next.has(k)) next.delete(k); else next.add(k);
    if (next.size === 0) {
      // Empty filter is meaningless — re-enable all so the section never
      // shows zero items just because of UI confusion.
      ALL_TIMELINE_KINDS.forEach(x => next.add(x));
    }
    timelineFilter = next;
    try { localStorage.setItem('productivity_timeline_filter', JSON.stringify([...next])); } catch {}
  }
  const filteredTimelineGroups = $derived.by(() => {
    if (!timeline?.groups) return [];
    return timeline.groups
      .map(g => ({
        day: g.day,
        items: g.items.filter(it => timelineFilter.has(it.kind)),
      }))
      .filter(g => g.items.length > 0);
  });

  function formatTimelineDay(dayStr) {
    if (!dayStr) return '';
    const today = new Date();
    const ymd = today.toISOString().slice(0, 10);
    if (dayStr === ymd) return 'Today';
    const yest = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
    if (dayStr === yest) return 'Yesterday';
    const tom = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);
    if (dayStr === tom) return 'Tomorrow';
    try {
      const d = new Date(dayStr + 'T12:00:00');
      return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    } catch { return dayStr; }
  }

  function formatTimelineTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    } catch { return ''; }
  }

  function onTimelineClick(item) {
    if (item.kind === 'note_change' && item.url) {
      window.history.pushState({}, '', item.url);
      window.dispatchEvent(new PopStateEvent('popstate'));
      requestClose();
    } else if (item.kind === 'event' && item.meta?.googleEventId && item.timestamp) {
      // Navigate the calendar to the event's day; the user can scroll/click.
      const d = new Date(item.timestamp);
      if (!isNaN(d.getTime())) {
        setDate(d);
        setAppView('calendar');
        requestClose();
      }
    } else if (item.kind === 'file' && item.url) {
      window.open(item.url, '_blank', 'noopener');
    }
    // task_change + booking: no current click target; the row is read-only.
  }

  // Pin/unpin a task. Optimistic — the recommendation list refetches
  // immediately so the user sees the new ordering with the explanation.
  async function togglePin(taskId, isPinned) {
    if (isPinned) {
      await api(`/api/task-pins/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    } else {
      await api('/api/task-pins', {
        method: 'POST',
        body: JSON.stringify({ taskId }),
      });
    }
    refreshRecommendations();
  }

  // ---- Mount / unmount transitions ----
  let io;
  onMount(() => {
    requestAnimationFrame(() => { mounted = true; });
    document.addEventListener('keydown', onKey, true);
    // Track which section is on screen so the top jump-links can highlight
    // the current one. Threshold is generous so the active state changes
    // before the section is fully visible (better UX).
    requestAnimationFrame(() => {
      if (!bodyEl) return;
      io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const id = e.target.id?.replace(/^syn-/, '');
            if (id) activeSection = id;
          }
        }
      }, { root: bodyEl, threshold: 0.25, rootMargin: '-20% 0px -50% 0px' });
      bodyEl.querySelectorAll('[id^="syn-"]').forEach(el => io.observe(el));
    });
  });
  onDestroy(() => {
    document.removeEventListener('keydown', onKey, true);
    if (io) io.disconnect();
  });

  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      requestClose();
    }
  }
  function requestClose() {
    if (closing) return;
    closing = true;
    setTimeout(() => onclose(), 320);
  }

  // ---- Actions ----
  function jumpToTaskOnCalendar(task) {
    requestClose();
    if (task.dueDatetime) setDate(new Date(task.dueDatetime));
    else if (task.dueDate) setDate(new Date(task.dueDate + 'T12:00:00'));
    setAppView('calendar');
  }
  function openTask(task) {
    if (!appCtx?.editTask) return;
    // Build a TaskEditor-shaped object from the synthesis row. The editor
    // doesn't need the full Todoist record to render — title + due date +
    // priority + estimate is enough for it to function and for our
    // overdue-banner CTA to evaluate.
    const editable = {
      id: task.id,
      content: task.content,
      description: '',
      priority: task.priority || 1,
      dueDate: task.dueDate || null,
      dueDatetime: task.dueDatetime || null,
      estimatedMinutes: task.estimatedMinutes || null,
      labels: [],
      isCompleted: false,
    };
    requestClose();
    // Defer slightly so the panel's exit animation runs before the modal
    // opens on top — feels less like a "hand-off slap".
    setTimeout(() => appCtx.editTask(editable), 280);
  }
  async function dropTask(task) {
    const ok = await confirmAction({
      title: 'Drop this task?',
      body: `"${task.content}"\n\nDeleting it removes it from Todoist.`,
      confirmLabel: 'Drop',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      showToast({ kind: 'success', message: 'Task dropped.' });
      refreshToday();
    } catch (e) {
      showToast({ kind: 'error', message: 'Could not drop task.' });
    }
  }
  async function pushTomorrow(task) {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const ymd = tomorrow.toISOString().slice(0, 10);
      await api(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({ dueDate: ymd }),
      });
      showToast({ kind: 'success', message: 'Pushed to tomorrow.' });
      refreshToday();
    } catch (e) {
      showToast({ kind: 'error', message: 'Could not reschedule.' });
    }
  }
  async function moveToToday(task) {
    try {
      const ymd = new Date().toISOString().slice(0, 10);
      await api(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({ dueDate: ymd }),
      });
      showToast({ kind: 'success', message: 'Moved to today.' });
      refreshToday();
    } catch {
      showToast({ kind: 'error', message: 'Could not move.' });
    }
  }
  // Decision-surface mode toggle. When the user has pinned projects,
  // they can press "focus" to see ONLY tasks from those projects in the
  // ranked list. State lives in localStorage so the choice persists
  // across reloads. The /api/today refetch re-ranks server-side.
  async function togglePinnedMode() {
    const current = window.localStorage.getItem('productivity_ranker_mode') || 'default';
    const next = current === 'pinned' ? 'default' : 'pinned';
    window.localStorage.setItem('productivity_ranker_mode', next);
    refreshToday();
  }

  // Ledger filter toggle. Default is "active this week only" — keeping the
  // panel focused on calendars the user is currently using. The pref
  // persists so the choice carries across reloads.
  async function toggleLedgerShowAll(showAll) {
    try {
      await updatePrefs({ ledgerShowAllCalendars: !!showAll });
      refreshLedger();
    } catch {
      showToast?.('Could not update ledger preference', 'error');
    }
  }

  async function dismissObservation() {
    if (!observation) return;
    try {
      await api('/api/observations/dismiss', {
        method: 'POST',
        body: JSON.stringify({ id: observation.id, kind: observation.kind }),
      });
      clearObservation();
    } catch {}
  }
  function actObservation() {
    if (!observation?.action) return;
    const a = observation.action;
    if (a.kind === 'task') {
      requestClose();
      // TaskEditor doesn't have full task details for observations — but
      // the observation knows the task id; pass a minimal stub and let
      // the editor figure out the rest from the tasks store.
      setTimeout(() => {
        if (appCtx?.editTask) appCtx.editTask({ id: a.payload.taskId, content: '', priority: 1 });
      }, 280);
    } else if (a.kind === 'navigate') {
      requestClose();
      if (a.payload.route?.startsWith('settings:') && appCtx?.openSettings) {
        setTimeout(() => appCtx.openSettings(a.payload.route.slice('settings:'.length)), 280);
      }
    }
  }

  // ---- Formatting ----
  function fmtHours(min) {
    if (min == null) return '—';
    if (min < 60) return `${min}m`;
    const h = min / 60;
    if (Math.abs(h - Math.round(h)) < 0.05) return `${Math.round(h)}h`;
    return `${h.toFixed(1)}h`;
  }
  function dueLabel(t) {
    if (t.slipRisk === 'overdue') {
      return t.ageDays != null ? `${t.ageDays}d late` : 'Late';
    }
    if (t.dueDatetime) {
      try {
        return new Date(t.dueDatetime).toLocaleTimeString([], {
          hour: 'numeric', minute: '2-digit',
        }).replace(' ', '').toLowerCase();
      } catch { return 'today'; }
    }
    return 'today';
  }
  function weekRangeLabel(w) {
    if (!w) return '';
    try {
      const s = new Date(w.weekStart + 'T12:00:00Z');
      const e = new Date(w.weekEnd + 'T12:00:00Z');
      e.setUTCDate(e.getUTCDate() - 1);
      const fmt = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `${fmt(s)} – ${fmt(e)}`;
    } catch { return ''; }
  }
  function todayHeadline() {
    if (!today) return '';
    try {
      return new Date().toLocaleDateString([], {
        weekday: 'long', month: 'long', day: 'numeric',
      });
    } catch { return ''; }
  }

  // Capacity gauge math. Returns percentages of the longer of the two so
  // the visual ratio is honest (committed taller-than-free reads as overcommit).
  const gauge = $derived.by(() => {
    if (!today) return { committedPct: 0, freePct: 0, overflowPct: 0, total: 0 };
    const c = today.committedMinutes;
    const f = today.freeMinutes;
    const total = Math.max(c, f, 60); // at least an hour for visual scale
    const overflowsBy = Math.max(0, c - f);
    return {
      committedPct: Math.min(100, (c / total) * 100),
      freePct: Math.min(100, (f / total) * 100),
      overflowPct: f > 0 ? Math.min(60, (overflowsBy / f) * 100) : (c > 0 ? 60 : 0),
      total,
      overflowsBy,
    };
  });

  // The five hero kinds map to small color signals.
  const heroAccent = $derived(today?.hero?.kind === 'overcommitted' ? 'overcommit'
    : today?.hero?.kind === 'fits' ? 'fits'
    : today?.hero?.kind === 'free' ? 'rest'
    : 'neutral');
</script>

<!-- A thin click-out catcher; not a scrim. No darkening. -->
<div
  class="catcher"
  class:visible={mounted && !closing}
  onclick={requestClose}
  role="presentation"
></div>

<aside
  class="sidepanel"
  class:enter={mounted && !closing}
  class:leave={closing}
  role="complementary"
  aria-label="Today, honestly"
>
  <header class="head">
    <nav class="jumps" aria-label="Jump to section">
      <button class:active={activeSection === 'today'} onclick={() => scrollTo('today')}>Today</button>
      <button class:active={activeSection === 'week'} onclick={() => scrollTo('week')}>Week</button>
      <button class:active={activeSection === 'ledger'} onclick={() => scrollTo('ledger')}>Ledger</button>
      <button class:active={activeSection === 'timeline'} onclick={() => scrollTo('timeline')}>Timeline</button>
      <button class:active={activeSection === 'patterns'} onclick={() => scrollTo('patterns')}>Patterns</button>
    </nav>
    <div class="head-actions">
      <VoiceCapture mode="capture" label="Voice capture" />
      <button class="close" onclick={requestClose} aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </header>

  {#snippet taskRow(t)}
    {@const tr = today?.taskRatios?.[t.id]}
    {@const showBadge = tr && (tr.ratio >= 1.3 || tr.ratio <= 0.7)}
    <li class="task" class:overdue={t.slipRisk === 'overdue'}>
      <button class="task-tap" onclick={() => openTask(t)}>
        <div class="task-title">{t.content}</div>
        <div class="task-meta-line">
          <span class="due" class:due-late={t.slipRisk === 'overdue'}>{dueLabel(t)}</span>
          <span class="dot">·</span>
          <span class="est">{t.estimatedMinutes}m</span>
          {#if t.priority && t.priority >= 3}
            <span class="dot">·</span>
            <span class="prio">priority</span>
          {/if}
          {#if showBadge}
            <span class="dot">·</span>
            <span
              class="accuracy-badge"
              class:slow={tr.ratio >= 1.3}
              class:fast={tr.ratio <= 0.7}
              title={tr.source === 'task'
                ? `You usually take ${tr.ratio.toFixed(1)}× your estimate on this task (${tr.samples} runs).`
                : `You usually take ${tr.ratio.toFixed(1)}× your estimate on tasks in this project (${tr.samples} runs).`}
            >
              {tr.ratio.toFixed(1)}×
            </span>
          {/if}
        </div>
      </button>
      <div class="task-actions" role="group" aria-label="Task actions">
        {#if t.slipRisk === 'overdue'}
          <button onclick={() => moveToToday(t)} class="ta-primary">Move to today</button>
        {/if}
        <button onclick={() => pushTomorrow(t)}>Tomorrow</button>
        <button onclick={() => jumpToTaskOnCalendar(t)}>Calendar</button>
        <button onclick={() => dropTask(t)} class="ta-danger">Drop</button>
      </div>
    </li>
  {/snippet}

  <div class="body" bind:this={bodyEl}>
    <!-- ===== Today ===== -->
    <section id="syn-today" class="section section-today">
      {#if !today && synth.isLoadingToday}
        <div class="skeleton">
          <div class="sk-line w70"></div>
          <div class="sk-line w90"></div>
          <div class="sk-line w50"></div>
        </div>
      {:else if today}
        <p class="meta">
          {todayHeadline()}
          {#if today.pinnedProjectIds && today.pinnedProjectIds.length > 0}
            <span class="pin-badge">
              <span>·</span>
              {today.rankerMode === 'pinned' ? 'pinned only' : `${today.pinnedProjectIds.length} pinned`}
              <button
                class="pin-toggle"
                onclick={togglePinnedMode}
                title={today.rankerMode === 'pinned' ? 'Show all projects' : 'Show only pinned projects'}
              >
                {today.rankerMode === 'pinned' ? 'show all' : 'focus'}
              </button>
            </span>
          {/if}
        </p>
        <h2 class="hero hero-{heroAccent}">{today.hero.sentence}</h2>
        {#if today.hero.support}
          <p class="hero-support">{today.hero.support}</p>
        {/if}

        {#if today.hero.kind !== 'no_work_hours'}
          <div class="capacity">
            <div class="capacity-numbers">
              <div class="num">
                <span class="num-value">{fmtHours(today.committedMinutes)}</span>
                <span class="num-label">committed</span>
              </div>
              <div class="num">
                <span class="num-value">{fmtHours(today.freeMinutes)}</span>
                <span class="num-label">free</span>
              </div>
              {#if gauge.overflowsBy > 0}
                <div class="num num-over">
                  <span class="num-value">{fmtHours(gauge.overflowsBy)}</span>
                  <span class="num-label">over</span>
                </div>
              {/if}
            </div>

            <div class="rail" aria-hidden="true">
              <div class="rail-free" style="width: {gauge.freePct}%"></div>
              <div class="rail-committed" style="width: {gauge.committedPct}%"></div>
              {#if gauge.overflowsBy > 0}
                <div class="rail-overflow" style="left: {gauge.freePct}%; width: {Math.min(gauge.overflowPct, 30)}%"></div>
              {/if}
            </div>

            {#if today.load?.hasHistory && today.load.ratio > 1.15}
              <p class="load-note">
                History says you usually take <strong>{today.load.ratio.toFixed(1)}×</strong> your estimates.
                Today's realistic load: <strong>{fmtHours(today.load.realistic)}</strong>.
              </p>
            {:else if today.load?.hasHistory && today.load.ratio < 0.85}
              <p class="load-note load-note-good">
                History says you usually finish in <strong>{(today.load.ratio).toFixed(1)}×</strong> your estimates.
                Today's realistic load: <strong>{fmtHours(today.load.realistic)}</strong>.
              </p>
            {/if}
          </div>
        {/if}

        <!-- "Right now" — the ranker stake. Surfaces top-3 recommendations
             with the three-part explanation contract (whyThis / whyNow /
             whatWouldChange). Pin a task to force it to the top. -->
        {#if recommendations}
          {#if recommendations.recommendations.length > 0}
            <div class="recs">
              <div class="recs-head">
                <span class="recs-eyebrow">Right now</span>
                <span class="recs-context">
                  {#if recommendations.freeMinutes > 0}
                    {recommendations.freeMinutes} min free
                  {:else if !recommendations.withinHours}
                    outside work hours
                  {:else}
                    next free window
                  {/if}
                </span>
              </div>
              <ul class="recs-list">
                {#each recommendations.recommendations as r (r.task.id)}
                  <li class="rec" class:pinned={r.isPinned}>
                    <div class="rec-head">
                      <button class="rec-title" type="button" onclick={() => openTask(r.task)}>
                        {r.task.content}
                      </button>
                      <button
                        class="rec-pin"
                        class:active={r.isPinned}
                        type="button"
                        title={r.isPinned ? 'Unpin' : 'Pin to keep on top'}
                        onclick={() => togglePin(r.task.id, r.isPinned)}
                      >
                        {r.isPinned ? '★' : '☆'}
                      </button>
                    </div>
                    <p class="rec-why-this">{r.reasons.whyThis}</p>
                    <p class="rec-why-now">{r.reasons.whyNow}</p>
                    <p class="rec-change">{r.reasons.whatWouldChange}</p>
                  </li>
                {/each}
              </ul>
            </div>
          {:else if recommendations.recommendations.length === 0 && (today?.tasks?.length ?? 0) === 0}
            <p class="recs-empty">
              Pin a project or capture a task to teach the recommender what matters to you.
            </p>
          {/if}
        {/if}

        {#if today.tasks.length > 0}
          {@const overdueTasks = today.tasks.filter(t => t.slipRisk === 'overdue')}
          {@const todayTasks = today.tasks.filter(t => t.slipRisk !== 'overdue')}

          {#if overdueTasks.length > 0}
            <h3 class="sub sub-overdue">Already overdue</h3>
            <ul class="task-list">
              {#each overdueTasks as t (t.id)}
                {@render taskRow(t)}
              {/each}
            </ul>
          {/if}

          {#if todayTasks.length > 0}
            <h3 class="sub">Due today</h3>
            <ul class="task-list">
              {#each todayTasks as t (t.id)}
                {@render taskRow(t)}
              {/each}
            </ul>
          {/if}
        {/if}
      {:else}
        <p class="hero hero-neutral">A quiet today.</p>
      {/if}
    </section>

    <hr class="seam" />

    <!-- ===== Week ===== -->
    <section id="syn-week" class="section section-week">
      {#if !weekly && synth.isLoadingWeekly}
        <div class="skeleton">
          <div class="sk-line w50"></div>
          <div class="sk-line w90"></div>
          <div class="sk-line w80"></div>
        </div>
      {:else if weekly}
        <p class="meta">This week · {weekRangeLabel(weekly)}</p>
        {#if weekly.headlines.length === 0}
          <h2 class="hero hero-rest">A quiet week. Nothing flagged.</h2>
        {:else}
          <ul class="headlines">
            {#each weekly.headlines as h (h.id)}
              <li class="headline tone-{h.tone}">{h.text}</li>
            {/each}
          </ul>
        {/if}

        {#if weekly.stale.length > 0}
          <h3 class="sub">Drifting tasks</h3>
          <ul class="drift-list">
            {#each weekly.stale as s (s.id)}
              <li>
                <button onclick={() => openTask(s)}>
                  <span class="drift-title">{s.content}</span>
                  <span class="drift-meta">{s.ageDays}d{s.projectName ? ` · ${s.projectName}` : ''}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        {#if weekly.pushedRepeatedly.length > 0}
          <h3 class="sub">Pushed repeatedly</h3>
          <ul class="drift-list">
            {#each weekly.pushedRepeatedly as p (p.id)}
              <li>
                <button onclick={() => openTask(p)}>
                  <span class="drift-title">{p.content}</span>
                  <span class="drift-meta">moved {p.moveCount}× this month</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>

    <hr class="seam" />

    <!-- ===== Time Ledger ===== -->
    <section id="syn-ledger" class="section section-ledger">
      {#if !ledger && synth.isLoadingLedger}
        <div class="skeleton">
          <div class="sk-line w40"></div>
          <div class="sk-line w80"></div>
          <div class="sk-line w70"></div>
        </div>
      {:else if ledger}
        <p class="meta">Time ledger · last {ledger.weeks} weeks</p>
        <h2 class="hero hero-{ledger.headline.tone === 'concern' ? 'concern' : (ledger.headline.tone === 'good' ? 'good' : 'neutral')}">{ledger.headline.text}</h2>
        <p class="hero-support">
          {ledger.totals.lastWeekHours.toFixed(1)}h scheduled this week ·
          baseline {ledger.totals.priorWeekAvgHours.toFixed(1)}h
          {#if Math.abs(ledger.totals.deltaHours) >= 0.5}
            · {ledger.totals.deltaHours > 0 ? '+' : ''}{ledger.totals.deltaHours.toFixed(1)}h
          {/if}
        </p>

        {#if ledger.categories.length > 0}
          <ul class="ledger-list">
            {#each ledger.categories.slice(0, 8) as cat (cat.id)}
              {@const max = Math.max(1, ...cat.sparkline)}
              <li class="ledger-row">
                <div class="lr-head">
                  <span class="lr-swatch" style="background: {cat.color || 'var(--text-tertiary)'}"></span>
                  <span class="lr-name">{cat.name}</span>
                  <span class="lr-hours">{cat.lastWeekHours.toFixed(1)}h</span>
                  {#if cat.priorWeekAvgHours >= 0.5}
                    <span class="lr-delta lr-delta-{cat.deltaHours > 0.5 ? 'up' : (cat.deltaHours < -0.5 ? 'down' : 'flat')}">
                      {cat.deltaHours > 0 ? '+' : ''}{cat.deltaHours.toFixed(1)}h
                    </span>
                  {/if}
                </div>
                <div class="sparkline" aria-hidden="true">
                  {#each cat.sparkline as h, i}
                    <span
                      class="spark-bar"
                      class:current={i === cat.sparkline.length - 1}
                      style="height: {Math.max(3, (h / max) * 100)}%"
                      title="{h.toFixed(1)}h"
                    ></span>
                  {/each}
                </div>
              </li>
            {/each}
          </ul>
          {#if ledger.hiddenCount > 0 && !ledger.showAll}
            <button class="ledger-toggle" onclick={() => toggleLedgerShowAll(true)}>
              Show {ledger.hiddenCount} {ledger.hiddenCount === 1 ? 'calendar' : 'calendars'} inactive this week
            </button>
          {:else if ledger.showAll && ledger.categories.length > 1}
            <button class="ledger-toggle" onclick={() => toggleLedgerShowAll(false)}>
              Hide calendars inactive this week
            </button>
          {/if}
        {:else if ledger.hiddenCount > 0}
          <p class="caption">
            No active calendars this week.
            <button class="ledger-toggle inline" onclick={() => toggleLedgerShowAll(true)}>
              Show all {ledger.hiddenCount} {ledger.hiddenCount === 1 ? 'calendar' : 'calendars'}
            </button>
          </p>
        {:else}
          <p class="caption">
            No time on visible calendars yet. Connect Google Calendar or schedule a few events to see this populate.
          </p>
        {/if}
      {/if}
    </section>

    <hr class="seam" />

    <!-- ===== Timeline (cross-pillar chronological feed, ±24h) ===== -->
    <section id="syn-timeline" class="section section-timeline">
      <div class="tl-head">
        <p class="meta">Timeline</p>
        <div class="tl-filters" role="group" aria-label="Filter timeline by type">
          {#each ALL_TIMELINE_KINDS as k}
            <button
              type="button"
              class="tl-chip"
              class:active={timelineFilter.has(k)}
              onclick={() => toggleTimelineKind(k)}
            >
              {TIMELINE_KIND_LABELS[k]}
              {#if timeline?.counts?.[k] > 0}
                <span class="tl-count">{timeline.counts[k]}</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>

      {#if !timeline && synth.isLoadingTimeline}
        <div class="skeleton">
          <div class="sk-line w50"></div>
          <div class="sk-line w90"></div>
          <div class="sk-line w70"></div>
        </div>
      {:else if filteredTimelineGroups.length === 0}
        <p class="caption">
          No activity in the last day. Edit a note, drag an event, or upload a file to start your timeline.
        </p>
      {:else}
        <div class="tl-groups">
          {#each filteredTimelineGroups as g (g.day)}
            <div class="tl-group">
              <div class="tl-day">{formatTimelineDay(g.day)}</div>
              <ul class="tl-list">
                {#each g.items as item (item.id)}
                  <li class="tl-row" class:future={item.future} class:clickable={item.kind === 'note_change' || item.kind === 'event' || item.kind === 'file'}>
                    <span class="tl-icon" aria-hidden="true">{item.icon}</span>
                    <button
                      type="button"
                      class="tl-body"
                      onclick={() => onTimelineClick(item)}
                    >
                      <span class="tl-label">{item.label}</span>
                      <span class="tl-meta">
                        <span class="tl-op">{item.sublabel || item.op}</span>
                        <span class="tl-time">· {formatTimelineTime(item.timestamp)}</span>
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <hr class="seam" />

    <!-- ===== Patterns ===== -->
    <section id="syn-patterns" class="section section-patterns">
      {#if synth.isLoadingObservation && observation === null}
        <div class="skeleton">
          <div class="sk-line w40"></div>
          <div class="sk-line w90"></div>
        </div>
      {:else if observation}
        <p class="meta">A pattern</p>
        <h2 class="hero hero-neutral">{observation.message}</h2>
        <div class="obs-actions">
          {#if observation.action}
            <button class="primary" onclick={actObservation}>{observation.action.label}</button>
          {/if}
          <button class="ghost" onclick={dismissObservation}>Not useful</button>
        </div>
        <p class="caption">
          Patterns are quiet. We surface one at a time. Dismiss three of a kind and we stop showing them.
        </p>
      {:else}
        <p class="meta">Patterns</p>
        <p class="caption no-pattern">
          As you use productivity.do, this surface will quietly point out things worth noticing — a task that keeps getting pushed, a meeting day drifting heavy, a window of the day where you actually finish work. Nothing surfaces yet.
        </p>
      {/if}
    </section>
  </div>
</aside>

<style>
  /* The catcher is invisible but consumes click-outs. Not a scrim. */
  .catcher {
    position: fixed;
    inset: 0;
    z-index: 90;
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--motion-soft, 220ms) var(--motion-ease, ease);
  }
  .catcher.visible {
    pointer-events: auto;
    /* a barely-there veil; preserves the calendar's content visibility */
    background: transparent;
  }

  .sidepanel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(480px, 100vw);
    background: var(--surface);
    border-left: 1px solid var(--border-light, var(--border));
    box-shadow: -22px 0 40px -20px rgba(15, 17, 21, 0.18),
                -2px 0 0 0 rgba(15, 17, 21, 0.02);
    z-index: 100;
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    opacity: 0;
    transition:
      transform var(--motion-slow, 360ms) var(--motion-ease, ease),
      opacity var(--motion-soft, 220ms) var(--motion-ease, ease);
    will-change: transform, opacity;
  }
  .sidepanel.enter { transform: translateX(0); opacity: 1; }
  .sidepanel.leave { transform: translateX(100%); opacity: 0; }

  /* Header — calmer than a modal head. No big title; the jump-links ARE
     the title, and they highlight as you scroll. */
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 22px 28px 8px;
    /* Pin the head when the body scrolls — synthesis is a single page,
       so the jump-links should always be reachable. */
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--surface);
  }
  .jumps {
    display: flex;
    gap: 22px;
  }
  .head-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .jumps button {
    background: none;
    border: none;
    padding: 4px 0;
    cursor: pointer;
    color: var(--text-tertiary);
    font: inherit;
    font-size: 13px;
    letter-spacing: 0.01em;
    position: relative;
    transition: color var(--motion-quick, 140ms) var(--motion-ease, ease);
  }
  .jumps button:hover { color: var(--text-secondary); }
  .jumps button.active { color: var(--text-primary); font-weight: 500; }
  .jumps button.active::after {
    content: '';
    position: absolute;
    left: 0; right: 0; bottom: -8px;
    height: 1px;
    background: var(--text-primary);
  }
  .close {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: color var(--motion-quick) var(--motion-ease),
                background var(--motion-quick) var(--motion-ease);
  }
  .close:hover { color: var(--text-primary); background: var(--surface-hover); }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 14px 36px 64px;
    /* sticky head needs scroll-padding so anchored sections aren't hidden */
    scroll-padding-top: 8px;
    scroll-padding-bottom: 40px;
  }

  .section {
    /* Each section is a self-contained chapter. Padding gives enough air
       that the section reads as one thought, but not so much that you
       have to scroll past empty space to find the next one. */
    padding: 4px 0 28px;
  }
  .section:first-of-type { padding-top: 0; }
  .section:last-of-type { padding-bottom: 0; }
  .section .meta:first-child { margin-top: 16px; }

  /* Hairline divider between sections — softer than a heavy border;
     reads as a paragraph break in a Sunday paper. */
  .seam {
    border: 0;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      var(--border-light, var(--border)) 12%,
      var(--border-light, var(--border)) 88%,
      transparent
    );
    margin: 12px 0 0;
  }

  /* The slow surface — Fraunces — only inside .body. Inter for everything else. */
  .meta {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-tertiary);
    margin-top: 28px;
    margin-bottom: 14px;
    font-weight: 500;
  }
  .pin-badge {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    margin-left: 6px;
    color: var(--text-tertiary);
  }
  .pin-toggle {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--accent, #3b82f6);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--accent, #3b82f6) 40%, transparent);
    text-underline-offset: 3px;
    font-size: 11px;
    text-transform: lowercase;
    letter-spacing: normal;
    padding: 0;
    font-weight: 500;
  }
  .pin-toggle:hover {
    text-decoration-color: var(--accent, #3b82f6);
  }
  .hero {
    font-family: var(--font-display, 'Fraunces', serif);
    font-weight: 380;
    font-style: normal;
    font-size: 26px;
    line-height: 1.35;
    color: var(--text-primary);
    letter-spacing: -0.005em;
    margin: 0 0 22px;
    /* opt-in the Fraunces optical-size axis to match the size */
    font-optical-sizing: auto;
    font-variation-settings: 'opsz' 36, 'SOFT' 50;
  }
  .hero-overcommit { color: var(--text-primary); }
  .hero-fits { color: var(--text-primary); }
  .hero-rest { color: var(--text-primary); }
  .hero-neutral { color: var(--text-primary); }
  .hero-good { color: var(--text-primary); }
  .hero-concern { color: var(--text-primary); }

  /* Support line — second voice underneath the hero. Stays Inter (the
     hero is Fraunces); reads as the "what to do" prompt. */
  .hero-support {
    margin: -10px 0 22px;
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-secondary);
    font-weight: 400;
  }

  /* ---- Capacity gauge ---- */
  .capacity { margin: 8px 0 32px; }
  .capacity-numbers {
    display: flex;
    gap: 22px;
    align-items: baseline;
    margin-bottom: 14px;
  }
  .num {
    display: inline-flex;
    flex-direction: column;
    gap: 1px;
  }
  .num-value {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 18;
    font-size: 19px;
    font-weight: 450;
    color: var(--text-primary);
    line-height: 1;
  }
  .num-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-tertiary);
    margin-top: 4px;
  }
  .num-over .num-value {
    color: #c25e4d;
  }

  .rail {
    position: relative;
    height: 6px;
    background: var(--surface-hover);
    border-radius: 999px;
    overflow: visible;
  }
  .rail-free {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent-light, #dbeafe);
    border-radius: 999px;
    transition: width var(--motion-slow) var(--motion-ease);
  }
  .rail-committed {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent, #3b82f6);
    border-radius: 999px;
    transition: width var(--motion-slow) var(--motion-ease);
    /* a slight inset shadow to give the dark fill a little depth on top of the light */
    box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.06);
  }
  .rail-overflow {
    position: absolute;
    top: -2px;
    bottom: -2px;
    background: linear-gradient(90deg, #c25e4d, #9b3f30);
    border-radius: 999px;
    box-shadow: 0 0 0 2px var(--surface);
    transition: left var(--motion-slow) var(--motion-ease),
                width var(--motion-slow) var(--motion-ease);
  }

  /* History-adjusted load note — surfaces only when the user has ≥3 prior
     completions and the ratio is meaningfully off 1.0. */
  .load-note {
    margin: 12px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .load-note strong {
    color: var(--text-primary);
    font-weight: 500;
  }
  .load-note-good { color: var(--text-secondary); }

  /* Per-task accuracy badge — shown only when task or project history says
     the user systematically over- or under-runs this kind of task. */
  .accuracy-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 5px;
    border-radius: 3px;
    font-variant-numeric: tabular-nums;
    font-size: 10.5px;
    font-weight: 500;
    line-height: 1.4;
    letter-spacing: 0.01em;
    background: color-mix(in srgb, var(--text-secondary) 12%, transparent);
    color: var(--text-secondary);
  }
  .accuracy-badge.slow {
    background: color-mix(in srgb, var(--error, #c25e4d) 14%, transparent);
    color: var(--error, #c25e4d);
  }
  .accuracy-badge.fast {
    background: color-mix(in srgb, var(--accent, #3b82f6) 12%, transparent);
    color: var(--accent, #3b82f6);
  }

  /* ---- Plate (today's tasks) ---- */
  .sub {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-tertiary);
    font-weight: 500;
    margin: 26px 0 10px;
  }
  .sub-overdue { color: #c25e4d; }
  .task-list { list-style: none; padding: 0; margin: 0; }

  /* "Right now" recommendations — visually distinct from the task lists
     below. Has its own eyebrow line, slightly heavier card treatment, and
     a per-item pin star. The three-part explanation reads as soft body
     text, not as UI chrome — these sentences ARE the product. */
  .recs {
    margin: 22px 0 8px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 12px);
    background: color-mix(in srgb, var(--accent) 4%, var(--surface));
  }
  .recs-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .recs-eyebrow {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
  }
  .recs-context {
    font-size: 11px;
    color: var(--text-tertiary, var(--text-secondary));
  }
  .recs-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .rec {
    padding: 8px 0;
    border-top: 1px solid var(--border-light, var(--border));
  }
  .rec:first-child {
    padding-top: 0;
    border-top: none;
  }
  .rec.pinned .rec-title { color: var(--accent); }
  .rec-head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 4px;
  }
  .rec-title {
    flex: 1;
    text-align: left;
    border: none;
    background: transparent;
    padding: 0;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.3;
    cursor: pointer;
  }
  .rec-title:hover {
    color: var(--accent);
    text-decoration: underline;
  }
  .rec-pin {
    border: none;
    background: transparent;
    padding: 0 4px;
    color: var(--text-tertiary, var(--text-secondary));
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .rec-pin:hover { color: var(--accent); }
  .rec-pin.active { color: var(--accent); }
  .rec-why-this {
    font-size: 13px;
    color: var(--text-primary);
    margin: 0 0 2px;
    line-height: 1.4;
  }
  .rec-why-now {
    font-size: 12px;
    color: var(--text-secondary);
    margin: 0 0 2px;
    font-style: italic;
  }
  .rec-change {
    font-size: 12px;
    color: var(--text-tertiary, var(--text-secondary));
    margin: 0;
    line-height: 1.4;
  }
  .recs-empty {
    margin: 18px 0 0;
    padding: 12px 14px;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
    text-align: center;
  }

  /* Each task row reserves space for its action strip below the title so
     the row's height doesn't change on hover. The strip sits in normal
     flow but invisible/non-interactive when not hovered. Rows do not
     push siblings around when actions reveal. */
  .task {
    border-top: 1px solid var(--border-light, var(--border));
    padding: 12px 0;
    display: flex;
    flex-direction: column;
  }
  .task:last-child { border-bottom: 1px solid var(--border-light, var(--border)); }
  .task-tap {
    background: none;
    border: none;
    text-align: left;
    padding: 0;
    cursor: pointer;
    color: inherit;
    font: inherit;
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
  }
  .task-title {
    font-size: 15px;
    font-weight: 450;
    color: var(--text-primary);
    line-height: 1.45;
    word-break: break-word;
  }
  .task.overdue .task-title { color: var(--text-primary); }

  /* Meta line — secondary information. Drop the uppercase/letterspaced
     treatment that made everything read as a navigation breadcrumb;
     keep "Xd late" as the only signal that gets weight + color. */
  .task-meta-line {
    font-size: 12px;
    color: var(--text-tertiary);
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 2px;
  }
  .due { color: var(--text-tertiary); }
  .due-late {
    color: #c25e4d;
    font-weight: 500;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.08em;
    padding: 1px 6px;
    background: rgba(194, 94, 77, 0.10);
    border-radius: 3px;
  }
  .dot { opacity: 0.5; }
  .prio { color: #c25e4d; }

  /* Actions float in from the right of the row on hover. Absolute-
     positioned so they don't affect row height — siblings don't move.
     On a narrow viewport (< 520px), fall back to inline layout. */
  .task { position: relative; }
  .task-actions {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%) translateX(8px);
    display: flex;
    flex-wrap: nowrap;
    gap: 4px;
    background: linear-gradient(
      90deg,
      transparent 0,
      var(--surface) 18px,
      var(--surface) 100%
    );
    padding-left: 24px;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity var(--motion-soft) var(--motion-ease),
      transform var(--motion-soft) var(--motion-ease),
      visibility 0s linear var(--motion-soft, 220ms);
  }
  .task:hover .task-actions,
  .task:focus-within .task-actions {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translateY(-50%) translateX(0);
    transition:
      opacity var(--motion-soft) var(--motion-ease),
      transform var(--motion-soft) var(--motion-ease),
      visibility 0s linear 0s;
  }
  /* ---- Time Ledger (calendar pillar's stake) ---- */
  .ledger-list {
    list-style: none;
    margin: 18px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .ledger-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lr-head {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .lr-swatch {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex: 0 0 auto;
    box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.1);
  }
  .lr-name {
    color: var(--text-primary);
    font-weight: 500;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lr-hours {
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    font-weight: 500;
  }
  .lr-delta {
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    padding: 1px 6px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--text-secondary) 10%, transparent);
    color: var(--text-secondary);
  }
  .lr-delta-up {
    background: color-mix(in srgb, var(--error, #c25e4d) 14%, transparent);
    color: var(--error, #c25e4d);
  }
  .lr-delta-down {
    background: color-mix(in srgb, var(--accent, #3b82f6) 12%, transparent);
    color: var(--accent, #3b82f6);
  }
  .sparkline {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 28px;
    padding-left: 18px; /* align with lr-name */
  }
  .spark-bar {
    flex: 1;
    background: color-mix(in srgb, var(--text-tertiary) 60%, transparent);
    border-radius: 1.5px;
    min-height: 3px;
    transition: background var(--motion-quick) var(--motion-ease);
  }
  .spark-bar.current {
    background: var(--text-secondary);
  }
  .ledger-toggle {
    margin: 14px 0 0;
    background: none;
    border: none;
    padding: 4px 0;
    font-size: 12px;
    color: var(--text-tertiary);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--text-tertiary) 40%, transparent);
    text-underline-offset: 3px;
  }
  /* ===== Timeline section ===== */
  .tl-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }
  .tl-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .tl-chip {
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .tl-chip:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .tl-chip.active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: var(--accent);
    color: var(--accent);
  }
  .tl-count {
    font-variant-numeric: tabular-nums;
    color: var(--text-tertiary, var(--text-secondary));
    font-size: 10px;
  }
  .tl-chip.active .tl-count { color: var(--accent); }
  .tl-groups {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .tl-day {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary, var(--text-secondary));
    margin: 0 0 6px;
    font-weight: 500;
  }
  .tl-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-left: 1px solid var(--border-light, var(--border));
  }
  .tl-row {
    display: grid;
    grid-template-columns: 28px 1fr;
    gap: 6px;
    align-items: start;
    padding: 4px 0 4px 12px;
    margin-left: -8px;
    position: relative;
  }
  .tl-row.future { opacity: 0.85; }
  .tl-row.future::before {
    /* Subtle indicator that this hasn't happened yet — a hollow dot */
    content: '';
    position: absolute;
    left: -4px; top: 8px;
    width: 8px; height: 8px;
    border: 1.5px solid var(--accent);
    border-radius: 50%;
    background: var(--surface);
  }
  .tl-row:not(.future)::before {
    content: '';
    position: absolute;
    left: -4px; top: 8px;
    width: 8px; height: 8px;
    background: var(--accent);
    border-radius: 50%;
  }
  .tl-icon {
    font-size: 14px;
    line-height: 1.2;
    text-align: center;
    align-self: start;
    margin-top: 1px;
  }
  .tl-body {
    border: none;
    background: transparent;
    padding: 0;
    text-align: left;
    cursor: default;
    font: inherit;
    color: inherit;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .tl-row.clickable .tl-body { cursor: pointer; }
  .tl-row.clickable .tl-body:hover .tl-label { text-decoration: underline; color: var(--accent); }
  .tl-label {
    font-size: 13px;
    color: var(--text-primary);
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tl-meta {
    font-size: 11px;
    color: var(--text-tertiary, var(--text-secondary));
    line-height: 1.3;
  }
  .tl-op { text-transform: lowercase; }
  .tl-time { font-variant-numeric: tabular-nums; }

  .ledger-toggle:hover {
    color: var(--text-secondary);
    text-decoration-color: var(--text-secondary);
  }
  .ledger-toggle.inline {
    margin: 0 0 0 4px;
    padding: 0;
  }

  /* Narrow viewport: no room to float; show actions below the row,
     pushing layout (acceptable trade-off on mobile/sheet view). */
  @media (max-width: 520px) {
    .task-actions {
      position: static;
      transform: none;
      background: none;
      padding-left: 0;
      margin-top: 8px;
      flex-wrap: wrap;
      pointer-events: auto;
      visibility: visible;
      opacity: 1;
    }
  }
  .task-actions button {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 10px;
    cursor: pointer;
    color: var(--text-secondary);
    font: inherit;
    font-size: 12px;
    letter-spacing: 0.01em;
    transition: color var(--motion-quick) var(--motion-ease),
                background var(--motion-quick) var(--motion-ease),
                border-color var(--motion-quick) var(--motion-ease);
  }
  .task-actions button:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
    border-color: var(--text-tertiary);
  }
  .task-actions .ta-primary {
    background: var(--text-primary);
    color: var(--surface);
    border-color: var(--text-primary);
  }
  .task-actions .ta-primary:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .task-actions .ta-danger:hover {
    background: rgba(194, 94, 77, 0.08);
    color: #9b3f30;
    border-color: rgba(194, 94, 77, 0.4);
  }

  /* ---- Week tab ---- */
  .headlines { list-style: none; padding: 0; margin: 0 0 14px; }
  .headline {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 24;
    font-size: 17px;
    font-weight: 380;
    line-height: 1.5;
    color: var(--text-primary);
    padding: 14px 0 14px 16px;
    border-left: 2px solid var(--text-tertiary);
    margin-bottom: 4px;
  }
  .headline.tone-good { border-left-color: #4a8c70; }
  .headline.tone-neutral { border-left-color: var(--accent); }
  .headline.tone-concern { border-left-color: #c25e4d; }

  .drift { margin-top: 22px; }
  .drift-list { list-style: none; padding: 0; margin: 0; }
  .drift-list li { border-top: 1px solid var(--border-light, var(--border)); }
  .drift-list li:last-child { border-bottom: 1px solid var(--border-light, var(--border)); }
  .drift-list button {
    width: 100%;
    background: none;
    border: none;
    text-align: left;
    padding: 12px 0;
    cursor: pointer;
    font: inherit;
    color: inherit;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: baseline;
  }
  .drift-list button:hover { color: var(--text-primary); }
  .drift-title {
    font-size: 14px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drift-meta {
    font-size: 11px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    flex-shrink: 0;
  }

  /* ---- Patterns / Observations ---- */
  .obs-actions {
    display: flex;
    gap: 8px;
    margin: 16px 0 22px;
  }
  .obs-actions .primary {
    background: var(--text-primary);
    color: var(--surface);
    border: 1px solid var(--text-primary);
    padding: 8px 16px;
    border-radius: 8px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    transition: background var(--motion-quick) var(--motion-ease);
  }
  .obs-actions .primary:hover { background: var(--accent); border-color: var(--accent); }
  .obs-actions .ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    padding: 8px 16px;
    border-radius: 8px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    transition: color var(--motion-quick) var(--motion-ease),
                background var(--motion-quick) var(--motion-ease);
  }
  .obs-actions .ghost:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .caption {
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-tertiary);
    max-width: 360px;
  }
  .caption.no-pattern {
    margin-top: 12px;
    font-size: 13px;
    line-height: 1.65;
    max-width: none;
  }

  /* ---- Skeleton ---- */
  .skeleton { padding-top: 32px; }
  .sk-line {
    height: 18px;
    background: linear-gradient(90deg, var(--surface-hover) 0%, var(--bg-secondary) 50%, var(--surface-hover) 100%);
    background-size: 200% 100%;
    border-radius: 4px;
    margin-bottom: 12px;
    animation: shimmer 1.4s linear infinite;
  }
  .w40 { width: 40%; }
  .w50 { width: 50%; }
  .w70 { width: 70%; }
  .w80 { width: 80%; }
  .w90 { width: 90%; }
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* ---- Mobile: bottom sheet ---- */
  @media (max-width: 640px) {
    .sidepanel {
      top: auto;
      width: 100vw;
      max-height: 88vh;
      border-left: none;
      border-top: 1px solid var(--border-light, var(--border));
      border-radius: 16px 16px 0 0;
      transform: translateY(100%);
      box-shadow: 0 -16px 40px -10px rgba(15, 17, 21, 0.22);
    }
    .sidepanel.enter { transform: translateY(0); }
    .sidepanel.leave { transform: translateY(100%); }
    .head { padding: 14px 22px 6px; }
    .body { padding: 8px 22px 32px; }
    .hero { font-size: 22px; }
  }

  /* ---- Reduced motion ---- */
  @media (prefers-reduced-motion: reduce) {
    .sidepanel,
    .rail-free,
    .rail-committed,
    .rail-overflow,
    .task-actions {
      transition: none;
    }
    .sk-line { animation: none; }
  }
</style>
