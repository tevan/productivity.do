<script>
  import { getCalendars } from '../stores/calendars.svelte.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { getEventColor, darkenColor, readableText, readableSubtext, resolveCssVar } from '../utils/colors.js';
  import { formatTime } from '../utils/dates.js';
  import { detectConferenceUrl, shouldShowJoinButton } from '../utils/conference.js';
  import { tooltip } from '../actions/tooltip.js';

  let { event, compact = false, onclick = () => {} } = $props();

  const cals = getCalendars();
  const prefs = getPrefs();

  const color = $derived(getEventColor(event, cals.items));
  let systemDark = $state(window.matchMedia('(prefers-color-scheme: dark)').matches);
  $effect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => { systemDark = e.matches; };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });
  const isDark = $derived(prefs.values.theme === 'dark' || (prefs.values.theme !== 'light' && systemDark));
  const bgFallback = $derived(isDark ? color.dark : color.light);
  // RSVP — Google returns each attendee's responseStatus. The user's own
  // entry is flagged with `self:true`. Tentative ("Maybe") = dashed outline +
  // muted; declined = strikethrough on the title (only shown when the
  // showDeclinedEvents pref is on; otherwise filtered upstream).
  const myRsvp = $derived((event.attendees || []).find(a => a.self)?.responseStatus || null);
  const isTentative = $derived(myRsvp === 'tentative');
  const isDeclined = $derived(myRsvp === 'declined');
  // Re-resolve when scheme changes so text contrast tracks the active palette.
  const resolvedBg = $derived((prefs.values.colorScheme, color.varName ? resolveCssVar(color.varName, bgFallback) : bgFallback));
  const bg = $derived(color.varName ? `var(${color.varName}, ${bgFallback})` : bgFallback);
  const textColor = $derived(readableText(resolvedBg));
  const subtextColor = $derived(readableSubtext(resolvedBg));
  const is12h = $derived(prefs.values.timeFormat === '12h');
  const conferenceUrl = $derived(detectConferenceUrl(event));
  const showJoin = $derived(conferenceUrl && shouldShowJoinButton(event));
  const calName = $derived(cals.items.find(c => c.id === event.calendarId)?.summary || '');
  const tipText = $derived(calName ? `${event.summary || '(No title)'}\n${calName}` : (event.summary || ''));
</script>

<!--
  Chip is button-like: click → open. Made keyboard-accessible via role +
  tabindex + Enter/Space handler. The Join button inside is a real <a>,
  so SR reads "link, Join" after the chip's own label.
-->
<div
  class="event-chip"
  class:compact
  class:tentative={isTentative}
  class:declined={isDeclined}
  role="button"
  tabindex="0"
  aria-label={`${event.summary || 'Untitled event'}${calName ? ', ' + calName : ''}${isDeclined ? ', declined' : isTentative ? ', tentative' : ''}. Press Enter to view.`}
  style="background: {bg}; border-left-color: {darkenColor(bgFallback, 0.3)};"
  use:tooltip={tipText}
  onclick={(e) => { e.stopPropagation(); onclick(event, e); }}
  onkeydown={(e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onclick(event, e);
    }
  }}
>
  <div class="event-chip-content">
    {#if !compact}
      <span class="event-time" style="color: {subtextColor}">{formatTime(event.start, is12h)}</span>
    {/if}
    <span class="event-title" style="color: {textColor}">{event.summary || '(No title)'}</span>
    {#if event.location && !compact}
      <span class="event-location" style="color: {subtextColor}">{event.location}</span>
    {/if}
  </div>
  {#if showJoin}
    <a
      href={conferenceUrl}
      target="_blank"
      rel="noopener"
      class="join-btn"
      onclick={(e) => e.stopPropagation()}
    >
      Join
    </a>
  {/if}
</div>

<style>
  .event-chip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px;
    border-left: 3px solid;
    border-radius: var(--radius-sm);
    cursor: pointer;
    overflow: hidden;
    font-size: 12px;
    line-height: 1.3;
    gap: 4px;
    height: 22px;
    box-sizing: border-box;
  }
  .event-chip:hover {
    filter: brightness(0.96);
  }
  .event-chip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* RSVP "maybe": diagonal stripe overlay + dashed left border so it reads
     differently from a confirmed event without losing the chip color. */
  .event-chip.tentative {
    background-image: repeating-linear-gradient(
      135deg,
      transparent 0 6px,
      rgba(255,255,255,0.18) 6px 10px
    );
    border-left-style: dashed;
    opacity: 0.85;
  }
  /* RSVP "no": strikethrough title + heavily muted. Only visible when
     showDeclinedEvents pref is on (otherwise filtered upstream). */
  .event-chip.declined {
    opacity: 0.5;
  }
  .event-chip.declined .event-title {
    text-decoration: line-through;
  }

  .event-chip.compact {
    padding: 0 6px;
    border-left-width: 2px;
    font-size: 11px;
    height: 22px;
  }

  .event-chip-content {
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
    min-width: 0;
  }

  .event-time {
    font-size: 11px;
    font-weight: 500;
  }

  .event-title {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .event-location {
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .join-btn {
    flex-shrink: 0;
    padding: 2px 8px;
    background: var(--accent);
    color: white;
    border-radius: var(--radius-sm);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
  }
  .join-btn:hover { background: var(--accent-hover); }
</style>
