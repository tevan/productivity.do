<script>
  import { getCalendars } from '../stores/calendars.svelte.js';
  import { updateEvent, deleteEvent, createEvent, hideEvent } from '../stores/events.svelte.js';
  import { PASTEL_COLORS } from '../utils/colors.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { api } from '../api.js';
  import { tooltip } from '../actions/tooltip.js';

  let { event = null, position = { x: 0, y: 0 }, onclose = () => {}, onedit = () => {} } = $props();

  const cals = getCalendars();

  // Submenu state: which row is currently expanded ('calendars' | 'colors' | null)
  // and which side it flies out to (right by default, flip to left if there
  // isn't room on screen).
  let openSub = $state(null);
  let menuEl = $state(null);
  // Per-row anchor data for the submenu so it lines up with the parent row.
  let subAnchorTop = $state(0);
  let subSide = $state('right'); // 'right' | 'left'
  const SUB_WIDTH = 220;

  // Position the menu, keeping it on screen.
  const style = $derived.by(() => {
    let x = position.x;
    let y = position.y;
    const maxX = window.innerWidth - 240;
    const maxY = window.innerHeight - 320;
    if (x > maxX) x = maxX;
    if (y > maxY) y = maxY;
    return `left: ${x}px; top: ${y}px;`;
  });

  function openSubmenu(name, e) {
    openSub = name;
    if (!menuEl || !e?.currentTarget) return;
    const menuRect = menuEl.getBoundingClientRect();
    const rowRect = e.currentTarget.getBoundingClientRect();
    subAnchorTop = rowRect.top - menuRect.top;
    // Decide side: prefer right, flip left if it would clip the viewport.
    subSide = (menuRect.right + SUB_WIDTH + 8 > window.innerWidth) ? 'left' : 'right';
  }

  async function duplicate() {
    if (!event) return;
    await createEvent({
      summary: event.summary,
      start: event.start,
      end: event.end,
      allDay: !!event.allDay,
      location: event.location,
      description: event.description,
      calendarId: event.calendarId,
    });
    onclose();
  }

  async function deleteEv() {
    if (!event) return;
    const prefs = getPrefs();
    if (prefs.values.confirmDeleteEvent !== false) {
      if (!await confirmAction({ title: 'Delete event?', body: `"${event.summary || '(No title)'}" will be removed.`, confirmLabel: 'Delete', danger: true })) return;
    }
    await deleteEvent(event.calendarId, event.id);
    onclose();
  }

  async function moveToCalendar(targetId) {
    if (!event || targetId === event.calendarId) {
      onclose();
      return;
    }
    // Google Calendar's "move" requires a separate move API call. For our
    // simple update flow we duplicate into the new calendar and remove the
    // original. (Calendar IDs differ, so updateEvent on the same calendar
    // can't change calendarId.)
    await createEvent({
      summary: event.summary,
      start: event.start,
      end: event.end,
      allDay: !!event.allDay,
      location: event.location,
      description: event.description,
      calendarId: targetId,
    });
    await deleteEvent(event.calendarId, event.id);
    onclose();
  }

  async function handleHide() {
    if (!event) return;
    await hideEvent(event.calendarId, event.id);
    onclose();
  }

  async function saveAsTemplate() {
    if (!event) return;
    const start = new Date(event.start);
    const end = new Date(event.end);
    const durationMinutes = Math.max(15, Math.round((end - start) / 60000));
    await api('/api/event-templates', {
      method: 'POST',
      body: JSON.stringify({
        name: event.summary || 'Untitled template',
        summary: event.summary,
        description: event.description,
        location: event.location,
        durationMinutes,
        calendarId: event.calendarId,
      }),
    });
    onclose();
  }

  async function setColor(colorId) {
    if (!event) return;
    await updateEvent(event.calendarId, event.id, {
      summary: event.summary,
      start: event.start,
      end: event.end,
      allDay: !!event.allDay,
      location: event.location,
      description: event.description,
      calendarId: event.calendarId,
      colorId,
    });
    onclose();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="ctx-backdrop" onclick={onclose} oncontextmenu={(e) => { e.preventDefault(); onclose(); }}></div>
<div class="ctx-menu" style={style} role="menu" bind:this={menuEl} onmouseleave={() => openSub = null}>
  <button class="ctx-item" onclick={() => { onedit(event); onclose(); }} onmouseenter={() => openSub = null}>
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 12V10l7-7 2 2-7 7H2zM9 3l2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    Edit
  </button>
  <button class="ctx-item" onclick={duplicate} onmouseenter={() => openSub = null}>
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="2" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.2"/>
      <rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.2"/>
    </svg>
    Duplicate
  </button>
  <div class="ctx-separator"></div>
  <button
    class="ctx-item ctx-submenu"
    class:open={openSub === 'calendars'}
    onmouseenter={(e) => openSubmenu('calendars', e)}
    onclick={(e) => openSubmenu('calendars', e)}
  >
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
    </svg>
    Move to calendar
    <span class="chev">›</span>
  </button>
  <button
    class="ctx-item ctx-submenu"
    class:open={openSub === 'colors'}
    onmouseenter={(e) => openSubmenu('colors', e)}
    onclick={(e) => openSubmenu('colors', e)}
  >
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
      <circle cx="7" cy="7" r="2.5" fill="currentColor"/>
    </svg>
    Change color
    <span class="chev">›</span>
  </button>
  <div class="ctx-separator"></div>
  <button class="ctx-item" onclick={saveAsTemplate} onmouseenter={() => openSub = null}>
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 1.5h6l2 2v9h-8v-11z" stroke="currentColor" stroke-width="1.2"/>
      <path d="M5 5h4M5 7.5h4M5 10h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    </svg>
    Save as template
  </button>
  <button class="ctx-item" onclick={handleHide} onmouseenter={() => openSub = null}>
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" stroke-width="1.2"/>
      <path d="M2 12L12 2" stroke="currentColor" stroke-width="1.2"/>
    </svg>
    Hide event
  </button>
  <div class="ctx-separator"></div>
  <button class="ctx-item ctx-danger" onclick={deleteEv} onmouseenter={() => openSub = null}>
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2.5 4h9M5 4V2.5h4V4M3.5 4l.5 8h6l.5-8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    Delete
  </button>

  {#if openSub === 'calendars'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="ctx-flyout"
      class:flyout-left={subSide === 'left'}
      style="top: {subAnchorTop}px"
      onmouseenter={() => openSub = 'calendars'}
    >
      {#each cals.items.filter(c => c.id !== event?.calendarId) as cal}
        {@const cc = PASTEL_COLORS[(cal.colorIndex ?? 0) % PASTEL_COLORS.length]}
        <button class="ctx-item" onclick={() => moveToCalendar(cal.id)}>
          <span class="cal-dot" style="background: var({cc.varName}, {cc.light})"></span>
          <span class="cal-name">{cal.summary}</span>
        </button>
      {/each}
    </div>
  {:else if openSub === 'colors'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="ctx-flyout ctx-flyout-colors"
      class:flyout-left={subSide === 'left'}
      style="top: {subAnchorTop}px"
      onmouseenter={() => openSub = 'colors'}
    >
      <div class="swatch-grid">
        {#each PASTEL_COLORS as c, i}
          <button
            class="color-swatch"
            style="background: var({c.varName}, {c.light})"
            onclick={() => setColor(String(i + 1))}
            use:tooltip={c.name}
            aria-label={c.name}
          ></button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
  }
  .ctx-menu {
    position: fixed;
    z-index: 1001;
    min-width: 220px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    font-size: 13px;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    width: 100%;
  }
  .ctx-item:hover { background: var(--surface-hover); }
  .ctx-item svg { flex-shrink: 0; color: var(--text-tertiary); }
  .ctx-item.ctx-submenu { padding-right: 8px; }
  .ctx-item.ctx-submenu .chev {
    margin-left: auto;
    color: var(--text-tertiary);
    font-size: 14px;
    line-height: 1;
  }
  .ctx-item.ctx-submenu.open {
    background: var(--surface-hover);
  }
  .ctx-item.ctx-submenu.open .chev { color: var(--accent); }
  .ctx-danger { color: var(--error); }
  .ctx-danger svg { color: var(--error); }

  .ctx-separator {
    height: 1px;
    background: var(--border-light);
    margin: 4px 0;
  }

  /* Fly-out submenu — anchored to the parent menu, slides out to right or
     left depending on viewport room. Stays visually attached: top is set
     inline to align with the parent row. */
  .ctx-flyout {
    position: absolute;
    top: 0;
    left: 100%;
    margin-left: 4px;
    min-width: 220px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    z-index: 1002;
  }
  .ctx-flyout.flyout-left {
    left: auto;
    right: 100%;
    margin-left: 0;
    margin-right: 4px;
  }

  .cal-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .cal-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ctx-flyout-colors { padding: 8px; }
  .swatch-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 6px;
  }
  .color-swatch {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid var(--border);
    cursor: pointer;
    transition: transform 0.1s;
  }
  .color-swatch:hover { transform: scale(1.12); border-color: var(--accent); }
</style>
