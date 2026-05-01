<script>
  import { getContext } from 'svelte';
  import { getCalendars } from '../stores/calendars.svelte.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { getTasks } from '../stores/tasks.svelte.js';
  import { getNotes } from '../stores/notes.svelte.js';
  import { getLinks, deleteLink, linksForEvent } from '../stores/links.svelte.js';
  import { getEventColor } from '../utils/colors.js';
  import { formatTime, formatDate, lowerAmPm } from '../utils/dates.js';
  import { detectConferenceUrl, shouldShowJoinButton } from '../utils/conference.js';
  import { api } from '../api.js';
  import { tooltip } from '../actions/tooltip.js';

  let { event = null, position = { x: 0, y: 0 }, onclose = () => {}, onedit = () => {}, onmore = () => {} } = $props();
  const appCtx = getContext('app');
  const tasksStore = getTasks();
  const notesStore = getNotes();
  const linksStore = getLinks();

  // Linked tasks/notes for this event. Reactive to the links store so adding
  // a link via drag re-renders without remounting.
  const eventLinks = $derived.by(() => {
    if (!event) return [];
    void linksStore.byKey; // dependency
    const refs = linksForEvent(event.calendarId, event.id);
    return refs.map(r => {
      if (r.type === 'task') {
        const t = tasksStore.items.find(x => String(x.id) === String(r.refId));
        return t ? { linkId: r.id, type: 'task', ref: t, label: t.content || '(untitled)' } : null;
      }
      if (r.type === 'note') {
        const n = notesStore.items.find(x => String(x.id) === String(r.refId));
        return n ? { linkId: r.id, type: 'note', ref: n, label: n.title || 'Untitled note' } : null;
      }
      return null;
    }).filter(Boolean);
  });

  function openLinked(item) {
    if (item.type === 'task') appCtx?.editTask?.(item.ref);
    else if (item.type === 'note') appCtx?.editNote?.(item.ref);
  }
  async function unlink(linkId, e) {
    e?.stopPropagation();
    await deleteLink(linkId);
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function linkify(text) {
    if (!text) return '';
    const urlPattern = /https?:\/\/[^\s<>"')\]]+/g;
    let result = '';
    let lastIndex = 0;
    let m;
    while ((m = urlPattern.exec(text)) !== null) {
      result += escapeHtml(text.slice(lastIndex, m.index));
      let url = m[0].replace(/[.,;:!?)]+$/, '');
      result += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="auto-link">${escapeHtml(url)}</a>`;
      lastIndex = m.index + url.length;
      urlPattern.lastIndex = lastIndex;
    }
    result += escapeHtml(text.slice(lastIndex));
    return result;
  }

  // Google Calendar descriptions arrive as a small HTML subset
  // (br/a/b/strong/i/em/u/ul/ol/li/p/div). Sanitize via DOMParser:
  // walk the parsed tree, drop unknown elements, strip every attribute
  // except href on <a>, and reject non-http(s)/mailto/tel URLs (blocks
  // javascript:/data:/vbscript:). Plain-text content is then linkified.
  const ALLOWED_TAGS = new Set(['BR','A','B','STRONG','I','EM','U','UL','OL','LI','P','DIV','SPAN']);
  function sanitizeUrl(url) {
    if (!url) return '';
    const trimmed = String(url).trim();
    if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
    return '';
  }
  function renderHtml(input) {
    if (!input) return '';
    if (!/<[a-z!\/]/i.test(input)) return linkify(input);
    let parsed;
    try {
      parsed = new DOMParser().parseFromString(`<div>${input}</div>`, 'text/html');
    } catch {
      return linkify(input);
    }
    const root = parsed.body.firstChild;
    if (!root) return linkify(input);
    const out = [];
    const walk = (node) => {
      if (node.nodeType === 3) {
        out.push(linkify(node.nodeValue || ''));
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (!ALLOWED_TAGS.has(tag)) {
        for (const c of node.childNodes) walk(c);
        return;
      }
      if (tag === 'BR') { out.push('<br>'); return; }
      let openTag = `<${tag.toLowerCase()}`;
      if (tag === 'A') {
        const href = sanitizeUrl(node.getAttribute('href'));
        if (!href) {
          for (const c of node.childNodes) walk(c);
          return;
        }
        openTag += ` href="${escapeHtml(href)}" target="_blank" rel="noopener" class="auto-link"`;
      }
      openTag += '>';
      out.push(openTag);
      for (const c of node.childNodes) walk(c);
      out.push(`</${tag.toLowerCase()}>`);
    };
    for (const c of root.childNodes) walk(c);
    return out.join('');
  }

  const cals = getCalendars();
  const prefs = getPrefs();

  const is12h = $derived(prefs.values.timeFormat === '12h');
  const calendar = $derived(cals.items.find(c => c.id === event?.calendarId));
  const color = $derived(event ? getEventColor(event, cals.items) : null);

  // Working-location and Out-of-office events are surfaced by Google as
  // events but they're not meeting-shaped — they have no agenda, no
  // attendees, no purpose for AI prep, and the usual edit/duplicate
  // actions don't make sense (they're managed through Google Calendar's
  // own dedicated UI). We render a lighter popover for these — title +
  // working-location label + a "Open in Google Calendar" button — and
  // suppress the prep / 3-dot / nudge bits.
  const isWorkingLocation = $derived(event?.eventType === 'workingLocation');
  const isOutOfOffice = $derived(event?.eventType === 'outOfOffice');
  const isStatusEvent = $derived(isWorkingLocation || isOutOfOffice);
  const conferenceUrl = $derived(event ? detectConferenceUrl(event) : null);
  const showJoin = $derived(event && conferenceUrl && shouldShowJoinButton(event));

  let prepLoading = $state(false);
  let prepText = $state('');
  let prepError = $state('');
  let prepGeneratedAt = $state(null);
  let attendeesExpanded = $state(false);
  let descExpanded = $state(false);
  let rsvpSaving = $state(false);
  // Optimistic local override so the chosen RSVP shows instantly without
  // waiting for the round-trip + store refresh.
  let liveRsvp = $state(null);
  $effect(() => {
    // Reset local override when the popover swaps to a different event.
    liveRsvp = null;
  });
  const myRsvp = $derived(
    liveRsvp || (event?.attendees || []).find(a => a.self)?.responseStatus || null
  );

  async function setRsvp(response) {
    if (!event?.id || rsvpSaving) return;
    rsvpSaving = true;
    liveRsvp = response;
    try {
      await api(`/api/events/${encodeURIComponent(event.calendarId)}/${encodeURIComponent(event.id)}/rsvp`, {
        method: 'POST',
        body: JSON.stringify({ response }),
      });
    } catch (e) {
      // On error, drop the optimistic state so the real one shows again.
      liveRsvp = null;
    } finally {
      rsvpSaving = false;
    }
  }

  async function loadPrep(force = false) {
    if (!event?.id || prepLoading) return;
    prepLoading = true;
    prepError = '';
    try {
      const res = await api(`/api/events/${encodeURIComponent(event.calendarId)}/${encodeURIComponent(event.id)}/prep`, {
        method: 'POST',
        body: JSON.stringify({ force }),
      });
      if (res?.ok) {
        prepText = res.summary;
        prepGeneratedAt = res.generatedAt;
      } else {
        prepError = res?.error || 'Could not generate prep.';
      }
    } catch (e) {
      prepError = e.message || 'Could not generate prep.';
    } finally {
      prepLoading = false;
    }
  }

  function renderPrep(md) {
    if (!md) return '';
    // Minimal Markdown: headings + bullets + bold. Anything else passes through escaped.
    let html = escapeHtml(md);
    html = html.replace(/^## (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\n{2,}/g, '</p><p>');
    return `<p>${html}</p>`;
  }

  function handleEdit() {
    if (event) onedit(event);
  }

  function handleMore(e) {
    if (!event) return;
    e.stopPropagation();
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    onmore(event, { x: r.right, y: r.bottom + 4 });
  }

  // Initials from a name or email — used as the avatar fallback.
  function initials(a) {
    const src = (a.displayName || a.email || '?').trim();
    if (!src) return '?';
    if (src.includes('@')) {
      // Take first letter of local-part.
      return src[0].toUpperCase();
    }
    const parts = src.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  // Deterministic hue from email so the same person always gets the same color.
  function hueFor(a) {
    const src = (a.email || a.displayName || '').toLowerCase();
    let h = 0;
    for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
  }

  // Position the popover
  const style = $derived.by(() => {
    let x = position.x;
    let y = position.y;
    // Keep it on-screen
    const maxX = window.innerWidth - 440;
    const maxY = window.innerHeight - 260;
    if (x > maxX) x = maxX;
    if (y > maxY) y = maxY;
    return `left: ${x}px; top: ${y}px;`;
  });
</script>

{#if event}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="popover-backdrop" onclick={onclose}></div>
  <div class="popover" style={style}>
    <div class="popover-header">
      {#if color}
        <div class="popover-color" style="background: {color.light}"></div>
      {/if}
      <h3 class="popover-title" class:status-title={isStatusEvent} onclick={isStatusEvent ? null : handleEdit} use:tooltip={isStatusEvent ? null : 'Click to edit'}>
        {#if isWorkingLocation}
          <span class="status-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7l5-4 5 4v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
            </svg>
          </span>
        {:else if isOutOfOffice}
          <span class="status-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/>
              <path d="M3.5 7h7M7 3.5v7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" transform="rotate(45 7 7)"/>
            </svg>
          </span>
        {/if}
        {event.summary || (isWorkingLocation ? 'Working location' : isOutOfOffice ? 'Out of office' : '(No title)')}
      </h3>
      <div class="popover-actions">
        {#if !isStatusEvent}
          <button class="icon-btn" onclick={handleMore} use:tooltip={'More actions'} aria-label="More actions">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="3" r="1.3" fill="currentColor"/>
              <circle cx="8" cy="8" r="1.3" fill="currentColor"/>
              <circle cx="8" cy="13" r="1.3" fill="currentColor"/>
            </svg>
          </button>
        {/if}
        <button class="icon-btn" onclick={onclose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="popover-body">
      <div class="popover-row">
        <span class="popover-icon">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="2" width="12" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
            <path d="M1 5h12" stroke="currentColor" stroke-width="1.2"/>
            <path d="M4 1v2M10 1v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="when">
          <span class="when-date">{formatDate(event.start)}</span>
          {#if !event.allDay}
            <span class="when-sep">·</span>
            <span class="when-time">{formatTime(event.start, is12h)} – {formatTime(event.end, is12h)}</span>
          {:else}
            <span class="when-sep">·</span>
            <span class="when-time">All day</span>
          {/if}
        </span>
      </div>

      {#if isStatusEvent}
        <div class="status-badge-row">
          <span class="status-badge" class:status-wl={isWorkingLocation} class:status-ooo={isOutOfOffice}>
            {isWorkingLocation ? 'Working location' : 'Out of office'}
          </span>
          <span class="status-hint">Managed in Google Calendar</span>
        </div>
        {#if event.htmlLink}
          <a href={event.htmlLink} target="_blank" rel="noopener" class="open-gcal-btn">
            Open in Google Calendar
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M4 2h6v6M10 2L4.5 7.5M3 4v6h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </a>
        {/if}
      {/if}

      {#if !event.allDay && !isStatusEvent}
        {@const altZones = (prefs.values.additionalTimezones || []).slice(0, 2)}
        {#if altZones.length}
          {@const startD = new Date(event.start)}
          <div class="popover-row tz-alts">
            <span class="popover-icon" use:tooltip={'Other timezones'}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
                <path d="M1.5 7h11M7 1.5c2 2 2 9 0 11M7 1.5c-2 2-2 9 0 11" stroke="currentColor" stroke-width="1"/>
              </svg>
            </span>
            <span class="tz-alt-list">
              {#each altZones as tz}
                <span class="tz-pair" use:tooltip={tz}>
                  {tz.split('/').pop().replace('_',' ')}: {lowerAmPm(startD.toLocaleString(undefined, { hour:'numeric', minute:'2-digit', timeZone: tz }))}
                </span>
              {/each}
            </span>
          </div>
        {/if}
      {/if}

      {#if event.mergedFromCalendarIds && event.mergedFromCalendarIds.length > 1}
        <div class="popover-row" style="font-size:11px;opacity:0.8;">
          On {event.mergedFromCalendarIds.length} calendars (merged duplicate)
        </div>
      {/if}

      {#if event.location}
        <div class="popover-row">
          <span class="popover-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1C4.79 1 3 2.79 3 5c0 3.5 4 8 4 8s4-4.5 4-8c0-2.21-1.79-4-4-4z" stroke="currentColor" stroke-width="1.2"/>
              <circle cx="7" cy="5" r="1.5" stroke="currentColor" stroke-width="1.2"/>
            </svg>
          </span>
          <span>{@html linkify(event.location)}</span>
        </div>
      {/if}

      {#if calendar}
        <div class="popover-row">
          <span class="popover-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
            </svg>
          </span>
          <span>{calendar.summary}</span>
        </div>
      {/if}

      {#if !isStatusEvent}
      {#if event.attendees && event.attendees.length}
        {@const counts = event.attendees.reduce((a, x) => {
          const k = x.responseStatus || 'needsAction';
          a[k] = (a[k] || 0) + 1; return a;
        }, {})}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="popover-row attendees clickable" onclick={() => attendeesExpanded = !attendeesExpanded}>
          <span class="popover-icon" use:tooltip={'Attendees'}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="5" cy="5" r="2" stroke="currentColor" stroke-width="1.2"/>
              <path d="M1.5 12c0-2 1.5-3.5 3.5-3.5s3.5 1.5 3.5 3.5" stroke="currentColor" stroke-width="1.2"/>
              <circle cx="10" cy="4" r="1.5" stroke="currentColor" stroke-width="1.2"/>
            </svg>
          </span>
          <span class="attendee-summary">
            {event.attendees.length} attendee{event.attendees.length === 1 ? '' : 's'}
            {#if counts.accepted}<span class="resp yes" use:tooltip={'Accepted'}>✓ {counts.accepted}</span>{/if}
            {#if counts.declined}<span class="resp no" use:tooltip={'Declined'}>✗ {counts.declined}</span>{/if}
            {#if counts.tentative}<span class="resp maybe" use:tooltip={'Maybe'}>? {counts.tentative}</span>{/if}
            {#if counts.needsAction}<span class="resp pending" use:tooltip={'No response'}>· {counts.needsAction}</span>{/if}
          </span>
          <svg class="caret" class:open={attendeesExpanded} width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        {#if attendeesExpanded}
          <ul class="attendee-list">
            {#each event.attendees as a}
              {@const status = a.responseStatus || 'needsAction'}
              <li class="attendee">
                <span class="avatar" style="background: hsl({hueFor(a)}, 55%, 65%)" use:tooltip={a.email || ''}>
                  {initials(a)}
                  <span class="avatar-badge badge-{status}" use:tooltip={status}>
                    {#if status === 'accepted'}✓{:else if status === 'declined'}✗{:else if status === 'tentative'}?{:else}·{/if}
                  </span>
                </span>
                <span class="attendee-meta">
                  <span class="attendee-name">
                    {a.displayName || a.email}
                  </span>
                  {#if a.organizer || a.self || (a.displayName && a.email)}
                    <span class="attendee-sub">
                      {#if a.organizer}Organizer{/if}
                      {#if a.organizer && (a.self || (a.displayName && a.email))} · {/if}
                      {#if a.self}You{/if}
                      {#if (a.organizer || a.self) && a.displayName && a.email} · {/if}
                      {#if a.displayName && a.email}{a.email}{/if}
                    </span>
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if event.attendees.some(a => a.self)}
          <div class="rsvp-row">
            <span class="rsvp-label">Going?</span>
            <button class="rsvp-btn" class:active={myRsvp === 'accepted'} disabled={rsvpSaving} onclick={() => setRsvp('accepted')}>Yes</button>
            <button class="rsvp-btn" class:active={myRsvp === 'declined'} disabled={rsvpSaving} onclick={() => setRsvp('declined')}>No</button>
            <button class="rsvp-btn" class:active={myRsvp === 'tentative'} disabled={rsvpSaving} onclick={() => setRsvp('tentative')}>Maybe</button>
          </div>
        {/if}
      {/if}

      {#if event.attachments && event.attachments.length}
        <div class="popover-attachments">
          {#each event.attachments as a}
            <a class="attachment-chip" href={a.fileUrl} target="_blank" rel="noopener" use:tooltip={a.title}>
              {#if a.iconLink}<img src={a.iconLink} alt="" />{/if}
              <span>{a.title}</span>
            </a>
          {/each}
        </div>
      {/if}

      {#if eventLinks.length > 0}
        <div class="popover-row linked-row">
          <span class="popover-icon" use:tooltip={'Linked items'}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 9l-1.5 1.5a2 2 0 1 1-2.8-2.8L3.5 5M9 5l1.5-1.5a2 2 0 1 1 2.8 2.8L10.5 9M5 7l4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </span>
          <div class="linked-list">
            {#each eventLinks as item}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="linked-chip" onclick={() => openLinked(item)}>
                {#if item.type === 'task'}
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.2"/>
                    <path d="M4.5 7l2 2 3.5-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                {:else}
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M3 1.5h6l3 3v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z M9 1.5v3h3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                {/if}
                <span class="linked-label">{item.label}</span>
                <button class="linked-x" onclick={(e) => unlink(item.linkId, e)} use:tooltip={'Unlink'} aria-label="Unlink">×</button>
              </span>
            {/each}
          </div>
        </div>
      {/if}

      {#if event.description}
        {@const isLong = event.description.length > 400}
        <div class="popover-desc">
          {@html renderHtml(descExpanded || !isLong ? event.description : event.description.slice(0, 400) + '…')}
          {#if isLong}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="desc-toggle" onclick={() => descExpanded = !descExpanded}>
              {descExpanded ? 'Show less' : 'Show more'}
            </span>
          {/if}
        </div>
      {/if}

      {#if showJoin}
        <a href={conferenceUrl} target="_blank" rel="noopener" class="join-btn-lg">
          Join Meeting
        </a>
      {/if}
      {/if}

      {#if !isStatusEvent}
      <div class="prep-block">
        {#if !prepText && !prepLoading && !prepError}
          <button
            class="prep-btn"
            onclick={() => loadPrep(false)}
            type="button"
            data-tooltip="Generates a short briefing — agenda, attendees, and prior context — pulled from this event's details."
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1l1.5 4.5H13L9.25 8.25 10.75 13 7 10.25 3.25 13 4.75 8.25 1 5.5h4.5L7 1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            </svg>
            Prep with AI
          </button>
        {/if}
        {#if prepLoading}
          <div class="prep-loading">Generating prep…</div>
        {/if}
        {#if prepError}
          <div class="prep-error">{prepError}</div>
        {/if}
        {#if prepText}
          <div class="prep-result">{@html renderPrep(prepText)}</div>
          <button class="prep-regen" onclick={() => loadPrep(true)} type="button" disabled={prepLoading}>
            Regenerate
          </button>
        {/if}
      </div>
      {/if}
    </div>

  </div>
{/if}

<style>
  .popover-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
  }

  .popover {
    position: fixed;
    z-index: 1000;
    width: 420px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 64px);
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .popover-header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 16px 18px 10px;
  }
  .popover-color {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 7px;
  }

  .popover-title {
    flex: 1;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
    word-break: break-word;
    overflow-wrap: anywhere;
    cursor: pointer;
    margin: 0;
  }
  .popover-title:hover { color: var(--accent); }
  .popover-title.status-title { cursor: default; }
  .popover-title.status-title:hover { color: var(--text-primary); }

  .popover-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .icon-btn {
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
    transition: background 0.1s, color 0.1s;
  }
  .icon-btn:hover { background: var(--surface-hover); color: var(--text-primary); }

  .popover-body {
    padding: 6px 18px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .popover-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .popover-icon {
    flex-shrink: 0;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 18px;
  }

  .tz-alt-list { display: inline-flex; gap: 8px; flex-wrap: wrap; font-size: 11px; opacity: 0.85; }
  .tz-pair { white-space: nowrap; }

  .attendee-summary { display: inline-flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .resp { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 10px; }
  .resp.yes { background: color-mix(in srgb, #22c55e 18%, transparent); color: #16a34a; }
  .resp.no { background: color-mix(in srgb, #ef4444 18%, transparent); color: #dc2626; }
  .resp.maybe { background: color-mix(in srgb, #f59e0b 18%, transparent); color: #b45309; }
  .resp.pending { background: var(--surface-hover); color: var(--text-tertiary); }
  :global(html.dark) .resp.yes { color: #4ade80; }
  :global(html.dark) .resp.no { color: #fca5a5; }
  :global(html.dark) .resp.maybe { color: #fbbf24; }

  .popover-attachments {
    display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0;
  }
  .attachment-chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 8px; border-radius: 12px;
    background: var(--surface-hover); color: var(--text-primary);
    font-size: 11px; max-width: 220px;
  }
  .attachment-chip img { width: 12px; height: 12px; }
  .attachment-chip span {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .linked-row { align-items: flex-start; }
  .linked-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  .linked-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px 2px 8px;
    background: var(--surface-hover);
    border: 1px solid var(--border-light);
    border-radius: 999px;
    font-size: 12px;
    color: var(--text-primary);
    cursor: pointer;
    max-width: 220px;
  }
  .linked-chip:hover { border-color: var(--accent); }
  .linked-chip svg { color: var(--text-tertiary); flex-shrink: 0; }
  .linked-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .linked-x {
    width: 16px; height: 16px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    border-radius: 50%;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    flex-shrink: 0;
  }
  .linked-x:hover { background: color-mix(in srgb, var(--error) 18%, transparent); color: var(--error); }

  .popover-desc {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin-top: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--border-light);
    max-height: 320px;
    overflow-y: auto;
    word-break: break-word;
  }
  .popover-desc :global(ul),
  .popover-desc :global(ol) {
    margin: 4px 0 4px 20px;
    padding: 0;
  }
  .popover-desc :global(li) { margin: 2px 0; }
  .popover-desc :global(p) { margin: 6px 0; }
  .popover-desc :global(p:first-child) { margin-top: 0; }
  .popover-desc :global(strong),
  .popover-desc :global(b) { color: var(--text-primary); }
  .desc-toggle {
    display: inline-block;
    margin-top: 4px;
    color: var(--accent);
    font-weight: 500;
    cursor: pointer;
  }
  .desc-toggle:hover { text-decoration: underline; }

  .popover-row.clickable { cursor: pointer; }
  .popover-row.clickable:hover { color: var(--text-primary); }
  .caret {
    margin-left: auto;
    transition: transform 0.15s;
    color: var(--text-tertiary);
  }
  .caret.open { transform: rotate(180deg); }

  .attendee-list {
    list-style: none;
    margin: 0 0 4px 28px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 240px;
    overflow-y: auto;
  }
  .attendee {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--text-primary);
  }
  .avatar {
    position: relative;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: white;
    font-size: 11px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    user-select: none;
  }
  .avatar-badge {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 2px solid var(--surface-elevated);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
  }
  .badge-accepted { background: #22c55e; color: white; }
  .badge-declined { background: var(--error); color: white; }
  .badge-tentative { background: #f59e0b; color: white; }
  .badge-needsAction { background: var(--text-tertiary); color: var(--surface); }

  .attendee-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.25;
  }
  .attendee-name {
    color: var(--text-primary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .attendee-sub {
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rsvp-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    padding-top: 6px;
    border-top: 1px solid var(--border-light);
  }
  .rsvp-label {
    font-size: 12px;
    color: var(--text-secondary);
    margin-right: 2px;
  }
  .rsvp-btn {
    padding: 4px 12px;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .rsvp-btn:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
    border-color: var(--accent);
  }
  .rsvp-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .rsvp-btn.active {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  .rsvp-btn.active:hover { background: var(--accent-hover); }

  .join-btn-lg {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 16px;
    background: var(--accent);
    color: white;
    border-radius: var(--radius-md);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    margin-top: 4px;
  }
  .join-btn-lg:hover { background: var(--accent-hover); }


  :global(.auto-link) {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-color: var(--accent-light);
    word-break: break-all;
    cursor: pointer;
  }
  :global(.auto-link:hover) {
    text-decoration-color: var(--accent);
  }
  .prep-block {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .prep-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent-light);
    color: var(--accent);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .prep-btn:hover { background: var(--accent); color: white; }
  .prep-btn[data-tooltip] { position: relative; }
  .prep-btn[data-tooltip]::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    background: #2a2e3a;
    color: #f3f4f6;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.4;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    width: max-content;
    max-width: 260px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.1s;
    z-index: 100;
    box-shadow: var(--shadow-md);
    white-space: normal;
    text-align: left;
  }
  .prep-btn[data-tooltip]:hover::after { opacity: 1; }

  .status-icon {
    display: inline-flex;
    align-items: center;
    color: var(--text-tertiary);
    margin-right: 4px;
  }
  .status-badge-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 12px;
  }
  .status-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .status-wl {
    background: color-mix(in srgb, #10b981 14%, transparent);
    color: #047857;
    border: 1px solid color-mix(in srgb, #10b981 28%, transparent);
  }
  :global(html.dark) .status-wl { color: #6ee7b7; }
  .status-ooo {
    background: color-mix(in srgb, var(--error) 14%, transparent);
    color: var(--error);
    border: 1px solid color-mix(in srgb, var(--error) 28%, transparent);
  }
  .status-hint {
    color: var(--text-tertiary);
    font-size: 11px;
  }
  .open-gcal-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 500;
    text-decoration: none;
    align-self: flex-start;
    margin-top: 2px;
  }
  .open-gcal-btn:hover { background: var(--surface-hover); border-color: var(--accent); color: var(--accent); }

  .when {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    color: var(--text-primary);
  }
  .when-date { font-weight: 500; }
  .when-sep { color: var(--text-tertiary); }
  .when-time { color: var(--text-secondary); }
  .prep-loading, .prep-error {
    font-size: 12px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
  }
  .prep-loading { color: var(--text-tertiary); background: var(--surface-hover); }
  .prep-error {
    color: var(--error);
    background: color-mix(in srgb, var(--error) 12%, transparent);
  }
  .prep-result {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-primary);
    line-height: 1.5;
  }
  .prep-result :global(h4) {
    font-size: 11px;
    font-weight: 600;
    margin: 8px 0 4px;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .prep-result :global(ul) {
    margin: 4px 0 4px 16px;
    padding: 0;
  }
  .prep-result :global(li) { margin-bottom: 2px; }
  .prep-result :global(p) { margin: 4px 0; }
  .prep-regen {
    margin-top: 8px;
    background: none;
    border: none;
    color: var(--text-tertiary);
    font-size: 11px;
    cursor: pointer;
    padding: 0;
  }
  .prep-regen:hover { color: var(--accent); }
  .prep-regen:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
