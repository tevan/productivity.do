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
  import { getSynthesis, refreshToday, clearObservation } from '../stores/synthesis.svelte.js';

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
      <button class:active={activeSection === 'patterns'} onclick={() => scrollTo('patterns')}>Patterns</button>
    </nav>
    <button class="close" onclick={requestClose} aria-label="Close">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
    </button>
  </header>

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
        <p class="meta">{todayHeadline()}</p>
        <h2 class="hero hero-{heroAccent}">{today.hero.sentence}</h2>

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
          </div>
        {/if}

        {#if today.tasks.length > 0}
          <h3 class="sub">On your plate</h3>
          <ul class="task-list">
            {#each today.tasks as t (t.id)}
              <li class="task" class:overdue={t.slipRisk === 'overdue'}>
                <button class="task-tap" onclick={() => openTask(t)}>
                  <div class="task-meta-line">
                    <span class="due" class:due-late={t.slipRisk === 'overdue'}>{dueLabel(t)}</span>
                    <span class="dot">·</span>
                    <span class="est">{t.estimatedMinutes} min</span>
                    {#if t.priority && t.priority >= 3}
                      <span class="dot">·</span>
                      <span class="prio">priority</span>
                    {/if}
                  </div>
                  <div class="task-title">{t.content}</div>
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
            {/each}
          </ul>
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

  /* ---- Plate (today's tasks) ---- */
  .sub {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-tertiary);
    font-weight: 500;
    margin: 26px 0 10px;
  }
  .task-list { list-style: none; padding: 0; margin: 0; }
  .task {
    border-top: 1px solid var(--border-light, var(--border));
    padding: 14px 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
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
    gap: 4px;
    width: 100%;
  }
  .task-meta-line {
    font-size: 11px;
    color: var(--text-tertiary);
    display: flex;
    gap: 6px;
    align-items: center;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .due { color: var(--text-secondary); }
  .due-late { color: #c25e4d; font-weight: 500; }
  .dot { opacity: 0.5; }
  .prio { color: #c25e4d; }
  .task-title {
    font-size: 15px;
    font-weight: 450;
    color: var(--text-primary);
    line-height: 1.4;
    word-break: break-word;
  }
  .task.overdue .task-title { color: var(--text-primary); }

  /* Action row — quiet by default; reveals on hover/focus */
  .task-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    opacity: 0;
    max-height: 0;
    overflow: hidden;
    transition:
      opacity var(--motion-soft) var(--motion-ease),
      max-height var(--motion-soft) var(--motion-ease);
  }
  .task:hover .task-actions,
  .task:focus-within .task-actions {
    opacity: 1;
    max-height: 60px;
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
