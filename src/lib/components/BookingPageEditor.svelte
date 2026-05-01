<script>
  import { api } from '../api.js';
  import { getCalendars } from '../stores/calendars.svelte.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';
  import Dropdown from './Dropdown.svelte';
  import { tooltip } from '../actions/tooltip.js';

  let { page = null, onclose = () => {} } = $props();

  const cals = getCalendars();

  const DEFAULT_AVAIL = {
    sun: [],
    mon: [{ start: '09:00', end: '17:00' }],
    tue: [{ start: '09:00', end: '17:00' }],
    wed: [{ start: '09:00', end: '17:00' }],
    thu: [{ start: '09:00', end: '17:00' }],
    fri: [{ start: '09:00', end: '17:00' }],
    sat: [],
    overrides: {},
  };

  // Editable state
  let title = $state(page?.title || '');
  let slug = $state(page?.slug || '');
  let description = $state(page?.description || '');
  let durationMin = $state(page?.durationMin || 30);
  let bufferBeforeMin = $state(page?.bufferBeforeMin || 0);
  let bufferAfterMin = $state(page?.bufferAfterMin || 0);
  let slotStepMin = $state(page?.slotStepMin || 30);
  let minNoticeMin = $state(page?.minNoticeMin ?? 60);
  let maxAdvanceDays = $state(page?.maxAdvanceDays ?? 60);
  let dailyMax = $state(page?.dailyMax || '');
  let locationType = $state(page?.locationType || 'video');
  let locationValue = $state(page?.locationValue || '');
  let color = $state(page?.color || '#6366f1');
  let isActive = $state(page?.isActive !== false);
  let calendarId = $state(page?.calendarId || '');
  let checkCalendarIds = $state(page?.checkCalendarIds?.slice() || []);
  let timezone = $state(page?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  let requirePhone = $state(!!page?.requirePhone);
  let customQuestion = $state(page?.customQuestion || '');
  let redirectUrl = $state(page?.redirectUrl || '');
  let hostName = $state(page?.hostName || '');
  let hostEmail = $state(page?.hostEmail || '');
  let logoUrl = $state(page?.logoUrl || '');
  let coverImageUrl = $state(page?.coverImageUrl || '');
  let brandColor = $state(page?.brandColor || '');
  let minGapMin = $state(page?.minGapMin || 0);
  let weeklyMax = $state(page?.weeklyMax || '');
  let enableIcs = $state(page?.enableIcs !== false);
  let sendEmails = $state(page?.sendEmails !== false);
  let reminder24h = $state(page?.reminder24h !== false);
  let assignmentStrategy = $state(page?.assignmentStrategy || 'single');
  let hostUserIdsText = $state((page?.hostUserIds || []).join(', '));

  let analytics = $state(null);
  let analyticsDays = $state(30);
  let analyticsLoading = $state(false);
  async function loadAnalytics() {
    if (!page?.id) return;
    analyticsLoading = true;
    try {
      const res = await api(`/api/booking-pages/${page.id}/analytics?days=${analyticsDays}`);
      if (res?.ok) analytics = res;
    } finally {
      analyticsLoading = false;
    }
  }
  $effect(() => {
    if (activeSection === 'insights' && page?.id) loadAnalytics();
  });
  function fmtPct(v) {
    if (v == null) return '—';
    return `${(v * 100).toFixed(1)}%`;
  }
  function fmtMoney(cents, currency) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format((cents || 0) / 100);
  }
  function normalizeAvailability(input) {
    const v = JSON.parse(JSON.stringify(input && Object.keys(input).length ? input : DEFAULT_AVAIL));
    for (const k of ['sun','mon','tue','wed','thu','fri','sat']) {
      if (!Array.isArray(v[k])) v[k] = [];
    }
    if (!v.overrides) v.overrides = {};
    return v;
  }
  let availability = $state(normalizeAvailability(page?.availability));

  let saving = $state(false);
  let saveError = $state('');

  // Snapshot used to detect unsaved changes. Updated after a successful save
  // so subsequent closes don't re-prompt.
  function currentSnapshot() {
    return JSON.stringify({
      title, slug, description,
      durationMin, bufferBeforeMin, bufferAfterMin, slotStepMin,
      minNoticeMin, maxAdvanceDays, dailyMax,
      locationType, locationValue, color, isActive,
      calendarId, checkCalendarIds,
      availability, timezone,
      requirePhone, customQuestion, redirectUrl,
      hostName, hostEmail,
      logoUrl, coverImageUrl, brandColor,
      minGapMin, weeklyMax,
      enableIcs, sendEmails, reminder24h,
      assignmentStrategy, hostUserIdsText,
    });
  }
  let savedSnapshot = $state('');
  $effect(() => {
    // Initialize after the page prop has settled. Runs once on mount.
    if (!savedSnapshot) savedSnapshot = currentSnapshot();
  });
  const isDirty = $derived(savedSnapshot && currentSnapshot() !== savedSnapshot);

  /**
   * Single funnel for all close attempts (X, Cancel, Esc, backdrop). Prompts
   * to discard if there are unsaved changes; otherwise closes immediately.
   */
  async function requestClose() {
    if (!isDirty) {
      onclose(null);
      return;
    }
    const ok = await confirmAction({
      title: 'Discard changes?',
      body: "You've made changes that haven't been saved.",
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      danger: true,
    });
    if (ok) onclose(null);
  }
  let activeSection = $state('setup');

  // Sub-resources (event types, questions, workflows, invites)
  let eventTypes = $state(page?.eventTypes ? page.eventTypes.map(t => ({ ...t })) : []);
  let questions = $state(page?.questions ? page.questions.map(q => ({ ...q })) : []);
  let workflows = $state(page?.workflows ? page.workflows.map(w => ({ ...w })) : []);
  let invites = $state([]);
  let polls = $state([]);
  let subError = $state('');
  let subBusy = $state(false);

  async function refreshSubResources() {
    if (!page?.id) return;
    try {
      const res = await api(`/api/booking-pages/${page.id}`);
      if (res.ok) {
        eventTypes = (res.page.eventTypes || []).map(t => ({ ...t }));
        questions = (res.page.questions || []).map(q => ({ ...q }));
        workflows = (res.page.workflows || []).map(w => ({ ...w }));
      }
    } catch {}
  }
  async function refreshInvites() {
    if (!page?.id) return;
    try {
      const res = await api(`/api/booking-pages/${page.id}/invites`);
      if (res.ok) invites = res.invites || [];
    } catch {}
  }

  // ---- Event types ----
  async function addEventType() {
    if (!page?.id) { subError = 'Save the page first.'; return; }
    subBusy = true; subError = '';
    try {
      const res = await api(`/api/booking-pages/${page.id}/event-types`, {
        method: 'POST',
        body: JSON.stringify({ title: 'New meeting type', durationMin: 30 }),
      });
      if (res.ok) eventTypes = [...eventTypes, res.eventType];
      else subError = res.error || 'Failed.';
    } finally { subBusy = false; }
  }
  async function saveEventType(t) {
    if (!page?.id || !t.id) return;
    subBusy = true; subError = '';
    try {
      const res = await api(`/api/booking-pages/${page.id}/event-types/${t.id}`, {
        method: 'PUT',
        body: JSON.stringify(t),
      });
      if (!res.ok) subError = res.error || 'Save failed.';
    } finally { subBusy = false; }
  }
  async function deleteEventType(t) {
    if (!await confirmAction({ title: 'Delete meeting type?', body: `"${t.title}" will be removed.`, confirmLabel: 'Delete', danger: true })) return;
    subBusy = true; subError = '';
    try {
      await api(`/api/booking-pages/${page.id}/event-types/${t.id}`, { method: 'DELETE' });
      eventTypes = eventTypes.filter(x => x.id !== t.id);
    } finally { subBusy = false; }
  }

  // ---- Custom questions ----
  function addQuestion() {
    questions = [...questions, { id: `tmp-${Date.now()}`, label: 'New question', fieldType: 'text', required: false, options: [], sortOrder: questions.length }];
  }
  function removeQuestion(idx) {
    questions = questions.filter((_, i) => i !== idx);
  }
  function moveQuestion(idx, dir) {
    const next = [...questions];
    const t = idx + dir;
    if (t < 0 || t >= next.length) return;
    [next[idx], next[t]] = [next[t], next[idx]];
    questions = next.map((q, i) => ({ ...q, sortOrder: i }));
  }
  async function saveQuestions() {
    if (!page?.id) { subError = 'Save the page first.'; return; }
    subBusy = true; subError = '';
    try {
      const payload = questions.map((q, i) => ({
        id: q.id?.startsWith('tmp-') ? undefined : q.id,
        label: q.label, fieldType: q.fieldType, required: !!q.required,
        options: Array.isArray(q.options) ? q.options : (q.options ? String(q.options).split('\n').map(s => s.trim()).filter(Boolean) : []),
        sortOrder: i,
      }));
      const res = await api(`/api/booking-pages/${page.id}/questions`, {
        method: 'PUT',
        body: JSON.stringify({ questions: payload }),
      });
      if (res.ok) questions = (res.questions || []).map(q => ({ ...q }));
      else subError = res.error || 'Save failed.';
    } finally { subBusy = false; }
  }

  // ---- Workflows ----
  function addWorkflow() {
    workflows = [...workflows, { id: `tmp-${Date.now()}`, trigger: 'on_booked', webhookUrl: '', bodyTemplate: '', isActive: true }];
  }
  function removeWorkflow(idx) {
    workflows = workflows.filter((_, i) => i !== idx);
  }
  async function saveWorkflows() {
    if (!page?.id) { subError = 'Save the page first.'; return; }
    subBusy = true; subError = '';
    try {
      const payload = workflows.map(w => ({
        id: w.id?.startsWith('tmp-') ? undefined : w.id,
        trigger: w.trigger, webhookUrl: w.webhookUrl, bodyTemplate: w.bodyTemplate,
        isActive: !!w.isActive,
      }));
      const res = await api(`/api/booking-pages/${page.id}/workflows`, {
        method: 'PUT',
        body: JSON.stringify({ workflows: payload }),
      });
      if (res.ok) workflows = (res.workflows || []).map(w => ({ ...w }));
      else subError = res.error || 'Save failed.';
    } finally { subBusy = false; }
  }

  // ---- Single-use invites ----
  async function createInvite() {
    if (!page?.id) { subError = 'Save the page first.'; return; }
    subBusy = true; subError = '';
    try {
      const res = await api(`/api/booking-pages/${page.id}/invites`, { method: 'POST', body: JSON.stringify({}) });
      if (res.ok) {
        await refreshInvites();
        try { await navigator.clipboard.writeText(`${window.location.origin}${res.url}`); } catch {}
      } else subError = res.error || 'Failed.';
    } finally { subBusy = false; }
  }
  async function deleteInvite(token) {
    subBusy = true; subError = '';
    try {
      await api(`/api/booking-pages/${page.id}/invites/${token}`, { method: 'DELETE' });
      invites = invites.filter(i => i.token !== token);
    } finally { subBusy = false; }
  }
  function inviteUrl(token) { return `${window.location.origin}/book/i/${token}`; }

  // ---- Time polls ----
  async function refreshPolls() {
    if (!page?.id) return;
    try {
      const res = await api(`/api/booking-pages/${page.id}/polls`);
      if (res.ok) polls = res.polls || [];
    } catch {}
  }
  async function confirmPoll(p, iso) {
    subBusy = true; subError = '';
    try {
      const res = await api(`/api/booking-pages/${page.id}/polls/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify({ selectedIso: iso, status: 'confirmed' }),
      });
      if (res.ok) polls = polls.map(x => x.id === p.id ? res.poll : x);
      else subError = res.error || 'Failed.';
    } finally { subBusy = false; }
  }
  async function declinePoll(p) {
    if (!await confirmAction({ title: 'Decline this poll?', body: 'The invitee will be marked as declined.', confirmLabel: 'Decline', danger: true })) return;
    subBusy = true;
    try {
      const res = await api(`/api/booking-pages/${page.id}/polls/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'declined' }),
      });
      if (res.ok) polls = polls.map(x => x.id === p.id ? res.poll : x);
    } finally { subBusy = false; }
  }
  async function deletePoll(p) {
    if (!await confirmAction({ title: 'Delete this poll?', confirmLabel: 'Delete', danger: true })) return;
    subBusy = true;
    try {
      await api(`/api/booking-pages/${page.id}/polls/${p.id}`, { method: 'DELETE' });
      polls = polls.filter(x => x.id !== p.id);
    } finally { subBusy = false; }
  }
  function fmtPollIso(iso) {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  $effect(() => {
    if (activeSection === 'share') { refreshInvites(); refreshPolls(); }
  });

  const TIMEZONES = (typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : []);
  const WEEKDAYS = [
    ['sun', 'Sunday'],
    ['mon', 'Monday'],
    ['tue', 'Tuesday'],
    ['wed', 'Wednesday'],
    ['thu', 'Thursday'],
    ['fri', 'Friday'],
    ['sat', 'Saturday'],
  ];

  function addRange(key) {
    availability = { ...availability, [key]: [...(availability[key] || []), { start: '09:00', end: '17:00' }] };
  }
  function removeRange(key, idx) {
    const next = (availability[key] || []).filter((_, i) => i !== idx);
    availability = { ...availability, [key]: next };
  }
  function updateRange(key, idx, field, value) {
    const next = (availability[key] || []).map((r, i) => i === idx ? { ...r, [field]: value } : r);
    availability = { ...availability, [key]: next };
  }

  function toggleConflictCal(id) {
    if (checkCalendarIds.includes(id)) {
      checkCalendarIds = checkCalendarIds.filter(x => x !== id);
    } else {
      checkCalendarIds = [...checkCalendarIds, id];
    }
  }

  async function save() {
    if (saving) return;
    saveError = '';
    if (!title.trim()) { saveError = 'Title is required.'; return; }
    saving = true;
    try {
      const payload = {
        title, slug: slug || undefined, description,
        durationMin: Number(durationMin),
        bufferBeforeMin: Number(bufferBeforeMin),
        bufferAfterMin: Number(bufferAfterMin),
        slotStepMin: Number(slotStepMin),
        minNoticeMin: Number(minNoticeMin),
        maxAdvanceDays: Number(maxAdvanceDays),
        dailyMax: dailyMax === '' || dailyMax === null ? null : Number(dailyMax),
        locationType, locationValue,
        color, isActive,
        calendarId: calendarId || null,
        checkCalendarIds,
        availability,
        timezone,
        requirePhone, customQuestion, redirectUrl,
        hostName, hostEmail,
        logoUrl, coverImageUrl, brandColor,
        minGapMin: Number(minGapMin) || 0,
        weeklyMax: weeklyMax === '' || weeklyMax === null ? null : Number(weeklyMax),
        enableIcs, sendEmails, reminder24h,
        assignmentStrategy,
        hostUserIds: hostUserIdsText
          .split(/[,\s]+/)
          .map(s => s.trim())
          .filter(Boolean)
          .map(Number)
          .filter(n => Number.isFinite(n)),
      };
      const res = await api(`/api/booking-pages/${page.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        saveError = res.error || 'Save failed.';
        return;
      }
      // Lock in the snapshot so close-after-save doesn't prompt.
      savedSnapshot = currentSnapshot();
      onclose(res.page);
    } catch (err) {
      saveError = err.message;
    } finally {
      saving = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') requestClose();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  }

  // 6 grouped buckets. Each bucket contains 2-3 sub-sections rendered as
  // stacked sub-headers in a single scrollable pane (mirrors the Settings
  // modal layout). Click the nav item to jump to the bucket; sub-sections
  // anchor inside.
  const SECTIONS = [
    ['setup',    'Setup',     ['basics', 'branding', 'embed']],
    ['when',     'When',      ['availability', 'conflicts', 'team']],
    ['what',     'What',      ['form', 'types', 'questions']],
    ['automate', 'Automate',  ['workflows', 'notifications']],
    ['share',    'Share',     ['invites', 'polls']],
    ['insights', 'Insights',  ['analytics', 'advanced']],
  ];
  // Map sub-section id → display heading shown above its block.
  const SUBSECTION_LABEL = {
    basics: 'Basics',
    branding: 'Branding',
    embed: 'Embed & share',
    availability: 'Availability',
    conflicts: 'Conflict checks',
    team: 'Team booking',
    types: 'Meeting types',
    questions: 'Custom questions',
    form: 'Invitee form',
    workflows: 'Workflows',
    notifications: 'Notifications',
    invites: 'Single-use invites',
    polls: 'Time polls',
    analytics: 'Analytics',
    advanced: 'Advanced',
  };
  // Reverse map: sub-section id → bucket id (for resolving activeSection).
  const SUBSECTION_TO_BUCKET = {};
  for (const [bid, , subs] of SECTIONS) {
    for (const sid of subs) SUBSECTION_TO_BUCKET[sid] = bid;
  }
  function isInActiveBucket(subId) {
    const target = SUBSECTION_TO_BUCKET[subId];
    return activeSection === target;
  }

  function publicUrl() {
    return `${window.location.origin}/book/${slug || page?.slug || ''}`;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="modal-backdrop" onclick={() => requestClose()}></div>
<div class="modal" role="dialog" aria-label="Edit booking page">
  <div class="modal-header">
    <h2>{page?.id ? 'Edit booking page' : 'New booking page'}</h2>
    <a class="link" href={publicUrl()} target="_blank" rel="noopener" use:tooltip={'Open public page'}>View page ↗</a>
    <button class="close-btn" onclick={() => requestClose()} aria-label="Close">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M13.5 4.5L4.5 13.5M4.5 4.5L13.5 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>

  <div class="modal-layout">
    <nav class="modal-nav">
      {#each SECTIONS as [id, label]}
        <button class="nav-item" class:active={activeSection === id} onclick={() => activeSection = id}>{label}</button>
      {/each}

      <!-- Quick-jump to sub-sections within the active bucket -->
      {#if SECTIONS.find(s => s[0] === activeSection)?.[2]?.length > 1}
        <div class="nav-sub-list">
          {#each SECTIONS.find(s => s[0] === activeSection)[2] as subId}
            <a class="nav-sub-item" href={`#bpe-sub-${subId}`} onclick={(e) => {
              e.preventDefault();
              document.getElementById(`bpe-sub-${subId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}>{SUBSECTION_LABEL[subId]}</a>
          {/each}
        </div>
      {/if}
    </nav>

    <div class="modal-body">
      {#if isInActiveBucket('basics')}
        <h2 class="sub-h" id="bpe-sub-basics">Basics</h2>
        <div class="status-card" class:on={isActive}>
          <div class="status-text">
            <span class="status-label">{isActive ? 'Active' : 'Off'}</span>
            <span class="status-help">
              {isActive
                ? 'This page is live. Anyone with the link can book a time.'
                : 'This page is hidden. The public link will show "not available".'}
            </span>
          </div>
          <button
            class="toggle-switch"
            type="button"
            class:on={isActive}
            role="switch"
            aria-checked={isActive}
            onclick={() => isActive = !isActive}
          >
            <span class="toggle-knob"></span>
          </button>
        </div>

        <div class="grid">
          <label class="field">
            <span>Title</span>
            <input type="text" bind:value={title} placeholder="30-minute meeting" />
          </label>
          <label class="field">
            <span>URL slug</span>
            <input type="text" bind:value={slug} placeholder="meet" />
            <span class="help">Public URL: <code>/book/{slug || '…'}</code></span>
          </label>
          <label class="field full">
            <span>Description (shown on the public page)</span>
            <textarea bind:value={description} rows="3" placeholder="What is this meeting for?"></textarea>
          </label>
          <label class="field">
            <span>Duration</span>
            <Dropdown
              bind:value={durationMin}
              ariaLabel="Duration"
              options={[15, 20, 30, 45, 60, 90, 120].map(d => ({ value: d, label: `${d} min` }))}
            />
          </label>
          <label class="field">
            <span>Color</span>
            <input type="color" bind:value={color} />
          </label>
          <label class="field">
            <span>Location</span>
            <Dropdown
              bind:value={locationType}
              ariaLabel="Location"
              options={[
                { value: 'video', label: 'Google Meet (auto)' },
                { value: 'phone', label: 'Phone' },
                { value: 'inperson', label: 'In person' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          </label>
          {#if locationType !== 'video' || locationValue}
            <label class="field">
              <span>{locationType === 'phone' ? 'Phone number' : locationType === 'inperson' ? 'Address' : 'Details'}</span>
              <input type="text" bind:value={locationValue} placeholder={locationType === 'phone' ? '(555) 123-4567' : 'Where to meet'} />
            </label>
          {/if}
          <label class="field">
            <span>Timezone</span>
            <Dropdown
              bind:value={timezone}
              ariaLabel="Timezone"
              options={TIMEZONES.map(tz => ({ value: tz, label: tz.replace(/_/g, ' ') }))}
            />
          </label>
          <label class="field">
            <span>Host name (shown to invitees)</span>
            <input type="text" bind:value={hostName} placeholder="Your name" />
          </label>
        </div>

      {/if}{#if isInActiveBucket('availability')}
        <h2 class="sub-h" id="bpe-sub-availability">Availability</h2>
        <p class="section-help">Set the windows in your timezone when invitees can book. Add multiple ranges per day for splits like 9–12 and 14–17.</p>
        <div class="weekly">
          {#each WEEKDAYS as [key, label]}
            <div class="weekly-row">
              <span class="weekday">{label}</span>
              <div class="ranges">
                {#if (availability[key] || []).length === 0}
                  <span class="closed">Closed</span>
                {/if}
                {#each (availability[key] || []) as range, idx (idx)}
                  <div class="range">
                    <input type="time" value={range.start} onchange={(e) => updateRange(key, idx, 'start', e.target.value)} />
                    <span>–</span>
                    <input type="time" value={range.end} onchange={(e) => updateRange(key, idx, 'end', e.target.value)} />
                    <button class="ghost-btn icon-only" onclick={() => removeRange(key, idx)} use:tooltip={'Remove range'} aria-label="Remove range">×</button>
                  </div>
                {/each}
                <button class="ghost-btn add" onclick={() => addRange(key)}>+ Add</button>
              </div>
            </div>
          {/each}
        </div>

      {/if}{#if isInActiveBucket('conflicts')}
        <h2 class="sub-h" id="bpe-sub-conflicts">Conflict checks</h2>
        <p class="section-help">Pick the calendars whose existing events should block availability. Leave the target calendar selected at minimum.</p>
        <div class="grid">
          <label class="field full">
            <span>Save new bookings to</span>
            <Dropdown
              bind:value={calendarId}
              ariaLabel="Save new bookings to"
              placeholder="— select —"
              options={cals.items.map(c => ({ value: c.id, label: c.summary }))}
            />
          </label>
        </div>
        <div class="cal-list">
          <div class="cal-list-title">Block these calendars' busy times:</div>
          {#each cals.items as c}
            <label class="cal-row">
              <input type="checkbox" checked={checkCalendarIds.includes(c.id)} onchange={() => toggleConflictCal(c.id)} />
              <span>{c.summary}</span>
            </label>
          {/each}
        </div>

      {/if}{#if isInActiveBucket('form')}
        <h2 class="sub-h" id="bpe-sub-form">Invitee form</h2>
        <div class="grid">
          <label class="field full toggle">
            <input type="checkbox" bind:checked={requirePhone} />
            <span>Require phone number</span>
          </label>
          <label class="field full">
            <span>Custom question (optional)</span>
            <input type="text" bind:value={customQuestion} placeholder="What would you like to discuss?" />
          </label>
          <label class="field full">
            <span>After-booking redirect URL (optional)</span>
            <input type="url" bind:value={redirectUrl} placeholder="https://yoursite.com/thanks" />
          </label>
        </div>

      {/if}{#if isInActiveBucket('types')}
        <h2 class="sub-h" id="bpe-sub-types">Meeting types</h2>
        <p class="section-help">Offer multiple meeting types under the same page (e.g. Intro 15 min · Deep dive 60 min). Invitees pick a type before choosing a slot.</p>
        {#if !page?.id}
          <p class="section-help" style="color: var(--text-tertiary);">Save the page first, then add meeting types here.</p>
        {:else}
          <div class="sub-list">
            {#each eventTypes as t (t.id)}
              <div class="sub-card">
                <div class="grid">
                  <label class="field"><span>Title</span><input type="text" bind:value={t.title} /></label>
                  <label class="field"><span>Slug</span><input type="text" bind:value={t.slug} /></label>
                  <label class="field"><span>Duration (min)</span><input type="number" min="5" max="600" bind:value={t.durationMin} /></label>
                  <label class="field"><span>Capacity</span><input type="number" min="1" max="50" bind:value={t.capacity} /></label>
                  <label class="field"><span>Buffer before (min)</span><input type="number" min="0" max="120" bind:value={t.bufferBeforeMin} /></label>
                  <label class="field"><span>Buffer after (min)</span><input type="number" min="0" max="120" bind:value={t.bufferAfterMin} /></label>
                  <label class="field"><span>Color</span><input type="color" bind:value={t.color} /></label>
                  <label class="field toggle"><input type="checkbox" bind:checked={t.isActive} /><span>Active</span></label>
                  <label class="field full"><span>Description</span><textarea rows="2" bind:value={t.description}></textarea></label>
                  <label class="field"><span>Price (cents)</span><input type="number" min="0" bind:value={t.priceCents} placeholder="Free" /></label>
                  <label class="field"><span>Currency</span><input type="text" maxlength="3" bind:value={t.priceCurrency} placeholder="USD" /></label>
                </div>
                <div class="sub-actions">
                  <button class="ghost-btn danger" onclick={() => deleteEventType(t)} disabled={subBusy}>Delete</button>
                  <button class="ghost-btn" onclick={() => saveEventType(t)} disabled={subBusy}>Save type</button>
                </div>
              </div>
            {/each}
          </div>
          <button class="ghost-btn add" onclick={addEventType} disabled={subBusy}>+ Add meeting type</button>
        {/if}

      {/if}{#if isInActiveBucket('questions')}
        <h2 class="sub-h" id="bpe-sub-questions">Custom questions</h2>
        <p class="section-help">Custom questions appear on the booking form. Use Save changes at the bottom to save the page; questions save with their own button.</p>
        {#if !page?.id}
          <p class="section-help" style="color: var(--text-tertiary);">Save the page first, then add questions here.</p>
        {:else}
          <div class="sub-list">
            {#each questions as q, idx (q.id || idx)}
              <div class="sub-card">
                <div class="grid">
                  <label class="field full"><span>Question label</span><input type="text" bind:value={q.label} /></label>
                  <label class="field"><span>Field type</span>
                    <Dropdown
                      bind:value={q.fieldType}
                      ariaLabel="Field type"
                      options={[
                        { value: 'text', label: 'Short text' },
                        { value: 'textarea', label: 'Long text' },
                        { value: 'select', label: 'Dropdown' },
                        { value: 'checkbox', label: 'Checkbox' },
                      ]}
                    />
                  </label>
                  <label class="field toggle"><input type="checkbox" bind:checked={q.required} /><span>Required</span></label>
                  {#if q.fieldType === 'select'}
                    <label class="field full"><span>Options (one per line)</span>
                      <textarea rows="3" value={Array.isArray(q.options) ? q.options.join('\n') : (q.options || '')} oninput={(e) => q.options = e.target.value.split('\n').map(s => s.trim()).filter(Boolean)}></textarea>
                    </label>
                  {/if}
                </div>
                <div class="sub-actions">
                  <button class="ghost-btn" onclick={() => moveQuestion(idx, -1)} disabled={idx === 0} aria-label="Move up">↑</button>
                  <button class="ghost-btn" onclick={() => moveQuestion(idx, 1)} disabled={idx === questions.length - 1} aria-label="Move down">↓</button>
                  <button class="ghost-btn danger" onclick={() => removeQuestion(idx)}>Remove</button>
                </div>
              </div>
            {/each}
          </div>
          <div class="row-actions">
            <button class="ghost-btn add" onclick={addQuestion}>+ Add question</button>
            <button class="primary-btn" onclick={saveQuestions} disabled={subBusy}>{subBusy ? 'Saving…' : 'Save questions'}</button>
          </div>
        {/if}

      {/if}{#if isInActiveBucket('workflows')}
        <h2 class="sub-h" id="bpe-sub-workflows">Workflows</h2>
        <p class="section-help">Send a webhook to Slack, n8n, Zapier, or your own backend on booking events. Body template supports <code>{'{{name}}'}</code>, <code>{'{{email}}'}</code>, <code>{'{{start}}'}</code>, <code>{'{{end}}'}</code>, <code>{'{{title}}'}</code>.</p>
        {#if !page?.id}
          <p class="section-help" style="color: var(--text-tertiary);">Save the page first, then add workflows here.</p>
        {:else}
          <div class="sub-list">
            {#each workflows as w, idx (w.id || idx)}
              <div class="sub-card">
                <div class="grid">
                  <label class="field"><span>Trigger</span>
                    <Dropdown
                      bind:value={w.trigger}
                      ariaLabel="Trigger"
                      options={[
                        { value: 'on_booked', label: 'On booked' },
                        { value: 'on_canceled', label: 'On cancelled' },
                        { value: 'on_rescheduled', label: 'On rescheduled' },
                        { value: 'reminder_24h', label: 'Reminder (24h)' },
                      ]}
                    />
                  </label>
                  <label class="field toggle"><input type="checkbox" bind:checked={w.isActive} /><span>Active</span></label>
                  <label class="field full"><span>Webhook URL</span><input type="url" bind:value={w.webhookUrl} placeholder="https://hooks.slack.com/..." /></label>
                  <label class="field full"><span>Body template (JSON, optional)</span><textarea rows="3" bind:value={w.bodyTemplate} placeholder={'{"text": "New booking: {{name}} at {{start}}"}'}></textarea></label>
                </div>
                <div class="sub-actions">
                  <button class="ghost-btn danger" onclick={() => removeWorkflow(idx)}>Remove</button>
                </div>
              </div>
            {/each}
          </div>
          <div class="row-actions">
            <button class="ghost-btn add" onclick={addWorkflow}>+ Add workflow</button>
            <button class="primary-btn" onclick={saveWorkflows} disabled={subBusy}>{subBusy ? 'Saving…' : 'Save workflows'}</button>
          </div>
        {/if}

      {/if}{#if isInActiveBucket('invites')}
        <h2 class="sub-h" id="bpe-sub-invites">Single-use invites</h2>
        <p class="section-help">Generate one-time-use invite links. Each link expires after a single booking.</p>
        {#if !page?.id}
          <p class="section-help" style="color: var(--text-tertiary);">Save the page first, then create invites.</p>
        {:else}
          <div class="row-actions">
            <button class="primary-btn" onclick={createInvite} disabled={subBusy}>{subBusy ? 'Creating…' : '+ New invite link (copy to clipboard)'}</button>
          </div>
          <div class="sub-list">
            {#if invites.length === 0}
              <p class="section-help" style="color: var(--text-tertiary);">No invites yet.</p>
            {:else}
              {#each invites as inv (inv.token)}
                <div class="sub-card invite-card">
                  <div class="invite-row">
                    <code class="invite-url">{inviteUrl(inv.token)}</code>
                    <span class="invite-status" class:used={!!inv.used_by_booking_id}>
                      {inv.used_by_booking_id ? `Used · ${inv.invitee_email || ''}` : 'Unused'}
                    </span>
                  </div>
                  <div class="sub-actions">
                    <button class="ghost-btn" onclick={() => navigator.clipboard.writeText(inviteUrl(inv.token))}>Copy</button>
                    <button class="ghost-btn danger" onclick={() => deleteInvite(inv.token)} disabled={subBusy}>Delete</button>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        {/if}

      {/if}{#if isInActiveBucket('polls')}
        <h2 class="sub-h" id="bpe-sub-polls">Time polls</h2>
        <p class="section-help">Time polls let invitees propose multiple times that work for them. Pick one to confirm — that creates a booking on the chosen slot.</p>
        {#if !page?.id}
          <p class="section-help" style="color: var(--text-tertiary);">Save the page first.</p>
        {:else if polls.length === 0}
          <p class="section-help" style="color: var(--text-tertiary);">No polls yet. Invitees can submit a poll from <code>/book/{slug}</code>.</p>
        {:else}
          <div class="sub-list">
            {#each polls as p (p.id)}
              <div class="sub-card poll-card">
                <div class="poll-header">
                  <div>
                    <strong>{p.inviteeEmail}</strong>
                    <span class="poll-status" class:pending={p.status === 'pending'} class:confirmed={p.status === 'confirmed'} class:declined={p.status === 'declined'}>{p.status}</span>
                  </div>
                  <div class="sub-actions">
                    {#if p.status === 'pending'}
                      <button class="ghost-btn danger" onclick={() => declinePoll(p)} disabled={subBusy}>Decline</button>
                    {/if}
                    <button class="ghost-btn danger" onclick={() => deletePoll(p)} disabled={subBusy}>Delete</button>
                  </div>
                </div>
                {#if p.selectedIso}
                  <p class="section-help">Confirmed for <strong>{fmtPollIso(p.selectedIso)}</strong></p>
                {:else if p.status === 'pending'}
                  <p class="section-help">Pick one to confirm:</p>
                  <div class="poll-times">
                    {#each p.proposedIso as iso}
                      <button class="ghost-btn" onclick={() => confirmPoll(p, iso)} disabled={subBusy}>{fmtPollIso(iso)}</button>
                    {/each}
                  </div>
                {:else}
                  <p class="section-help" style="color: var(--text-tertiary);">Proposed: {p.proposedIso.map(fmtPollIso).join(' · ')}</p>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

      {/if}{#if isInActiveBucket('branding')}
        <h2 class="sub-h" id="bpe-sub-branding">Branding</h2>
        <p class="section-help">Customize the look of your public booking page.</p>
        <div class="grid">
          <div class="field full">
            <span>Brand color</span>
            <div class="brand-color-row">
              <div class="brand-presets">
                {#each ['#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#0ea5e9'] as preset}
                  <button
                    type="button"
                    class="brand-preset"
                    class:active={brandColor?.toLowerCase() === preset}
                    style="background: {preset}"
                    onclick={() => brandColor = preset}
                    aria-label={`Set brand color to ${preset}`}
                    use:tooltip={preset}
                  ></button>
                {/each}
              </div>
              <input type="color" bind:value={brandColor} class="brand-picker" use:tooltip={'Custom color'} />
            </div>
          </div>
          <label class="field full">
            <span>Logo URL</span>
            <input type="url" bind:value={logoUrl} placeholder="https://example.com/logo.png" />
          </label>
          <label class="field full">
            <span>Cover image URL</span>
            <input type="url" bind:value={coverImageUrl} placeholder="https://example.com/header.jpg" />
            <span class="help">Wide image (≈1200×300) shown above the page title.</span>
          </label>
        </div>

      {/if}{#if isInActiveBucket('notifications')}
        <h2 class="sub-h" id="bpe-sub-notifications">Notifications</h2>
        <p class="section-help">Confirmation and reminder emails sent to invitees. Requires <code>RESEND_API_KEY</code> in <code>.env</code> on the server.</p>
        <div class="grid">
          <label class="field full toggle">
            <input type="checkbox" bind:checked={sendEmails} />
            <span>Send confirmation email on booking</span>
          </label>
          <label class="field full toggle">
            <input type="checkbox" bind:checked={reminder24h} />
            <span>Send reminder 24 hours before</span>
          </label>
          <label class="field full toggle">
            <input type="checkbox" bind:checked={enableIcs} />
            <span>Attach .ics calendar file to confirmation</span>
          </label>
        </div>

      {/if}{#if isInActiveBucket('embed')}
        <h2 class="sub-h" id="bpe-sub-embed">Embed &amp; share</h2>
        <p class="section-help">Drop these snippets into your own site to embed the booking flow.</p>
        <h4 style="font-size: 12px; margin-top: 8px; color: var(--text-secondary);">Direct link</h4>
        <div class="snippet">
          <code>{publicUrl()}</code>
          <button class="ghost-btn" onclick={() => navigator.clipboard.writeText(publicUrl())}>Copy</button>
        </div>
        <h4 style="font-size: 12px; margin-top: 16px; color: var(--text-secondary);">Inline iframe</h4>
        <div class="snippet">
          <pre><code>{`<iframe src="${publicUrl()}"
        width="920" height="640" frameborder="0"></iframe>`}</code></pre>
          <button class="ghost-btn" onclick={() => navigator.clipboard.writeText(`<iframe src="${publicUrl()}" width="920" height="640" frameborder="0"></iframe>`)}>Copy</button>
        </div>
        <h4 style="font-size: 12px; margin-top: 16px; color: var(--text-secondary);">Popup button</h4>
        <div class="snippet">
          <pre><code>{`<script src="${window.location.origin}/embed.js"></${'script'}>
<button data-productivity-book="${slug || page?.slug || ''}">Book a meeting</button>`}</code></pre>
          <button class="ghost-btn" onclick={() => navigator.clipboard.writeText(`<script src="${window.location.origin}/embed.js"><\/script>\n<button data-productivity-book="${slug || page?.slug || ''}">Book a meeting</button>`)}>Copy</button>
        </div>

      {/if}{#if isInActiveBucket('analytics')}
        <h2 class="sub-h" id="bpe-sub-analytics">Analytics</h2>
        <div class="analytics-block">
          <div class="analytics-header">
            <h4>Last {analyticsDays} days</h4>
            <Dropdown
              bind:value={analyticsDays}
              ariaLabel="Analytics range"
              onchange={() => loadAnalytics()}
              options={[
                { value: 7, label: '7 days' },
                { value: 30, label: '30 days' },
                { value: 90, label: '90 days' },
                { value: 365, label: '1 year' },
              ]}
            />
          </div>
          {#if analyticsLoading}
            <p class="hint">Loading…</p>
          {:else if !analytics}
            <p class="hint">No data yet.</p>
          {:else}
            <div class="metric-grid">
              <div class="metric">
                <div class="metric-value">{analytics.summary.views}</div>
                <div class="metric-label">Page views</div>
              </div>
              <div class="metric">
                <div class="metric-value">{analytics.summary.confirmed}</div>
                <div class="metric-label">Confirmed bookings</div>
              </div>
              <div class="metric">
                <div class="metric-value">{fmtPct(analytics.summary.conversionRate)}</div>
                <div class="metric-label">Conversion</div>
              </div>
              <div class="metric">
                <div class="metric-value">{analytics.summary.canceled}</div>
                <div class="metric-label">Canceled</div>
              </div>
              <div class="metric">
                <div class="metric-value">{fmtPct(analytics.summary.noShowRate)}</div>
                <div class="metric-label">No-show rate</div>
              </div>
              <div class="metric">
                <div class="metric-value">
                  {#if analytics.summary.revenue.length === 0}
                    {fmtMoney(0, 'USD')}
                  {:else}
                    {analytics.summary.revenue.map(r => fmtMoney(r.cents, r.currency)).join(' + ')}
                  {/if}
                </div>
                <div class="metric-label">Revenue (paid bookings)</div>
              </div>
            </div>
            <p class="hint">Mark past bookings as no-show from the Bookings list to refine this rate.</p>
          {/if}
        </div>

      {/if}{#if isInActiveBucket('team')}
        <h2 class="sub-h" id="bpe-sub-team">Team booking</h2>
        <div class="grid">
          <label class="field full">
            <span>Assignment strategy</span>
            <Dropdown
              bind:value={assignmentStrategy}
              ariaLabel="Assignment strategy"
              options={[
                { value: 'single', label: 'Single host (you)' },
                { value: 'round_robin', label: 'Round-robin (rotate among hosts)' },
                { value: 'collective', label: 'Collective (all hosts must be free)' },
              ]}
            />
          </label>
          {#if assignmentStrategy !== 'single'}
            <label class="field full">
              <span>Co-host user IDs</span>
              <input type="text" bind:value={hostUserIdsText} placeholder="2, 3, 4" />
              <small class="hint">Numeric user IDs of co-hosts (comma-separated). You're always included as a host. Team plan only.</small>
            </label>
          {/if}
        </div>

      {/if}{#if isInActiveBucket('advanced')}
        <h2 class="sub-h" id="bpe-sub-advanced">Advanced</h2>
        <div class="grid">
          <label class="field">
            <span>Buffer before (min)</span>
            <input type="number" min="0" max="120" bind:value={bufferBeforeMin} />
          </label>
          <label class="field">
            <span>Buffer after (min)</span>
            <input type="number" min="0" max="120" bind:value={bufferAfterMin} />
          </label>
          <label class="field">
            <span>Slot step (min)</span>
            <Dropdown
              bind:value={slotStepMin}
              ariaLabel="Slot step"
              options={[5, 10, 15, 20, 30, 45, 60].map(s => ({ value: s, label: `${s} min` }))}
            />
          </label>
          <label class="field">
            <span>Min notice</span>
            <Dropdown
              bind:value={minNoticeMin}
              ariaLabel="Min notice"
              options={[
                { value: 0, label: 'None' },
                { value: 30, label: '30 min' },
                { value: 60, label: '1 hour' },
                { value: 240, label: '4 hours' },
                { value: 720, label: '12 hours' },
                { value: 1440, label: '1 day' },
                { value: 2880, label: '2 days' },
              ]}
            />
          </label>
          <label class="field">
            <span>Max advance (days)</span>
            <input type="number" min="1" max="365" bind:value={maxAdvanceDays} />
          </label>
          <label class="field">
            <span>Daily limit</span>
            <input type="number" min="0" max="50" bind:value={dailyMax} placeholder="No limit" />
          </label>
          <label class="field">
            <span>Min gap between bookings (min)</span>
            <input type="number" min="0" max="240" bind:value={minGapMin} />
            <span class="help">Enforce at least N minutes between any two confirmed bookings on this page.</span>
          </label>
          <label class="field">
            <span>Weekly cap</span>
            <input type="number" min="0" max="100" bind:value={weeklyMax} placeholder="No limit" />
          </label>
        </div>
      {/if}
    </div>
  </div>

  <div class="modal-footer">
    {#if saveError}
      <span class="error">{saveError}</span>
    {:else if subError}
      <span class="error">{subError}</span>
    {/if}
    <div class="footer-spacer"></div>
    <button class="ghost-btn" onclick={() => requestClose()}>Cancel</button>
    <button class="primary-btn" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
  </div>
</div>

<style>
  .analytics-block { padding: 8px 0; }
  .analytics-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .analytics-header h4 { margin: 0; font-size: 14px; color: var(--text-primary); }
  .analytics-header select {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 12px;
  }
  .metric-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .metric {
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
  }
  .metric-value {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.2;
  }
  .metric-label {
    margin-top: 4px;
    font-size: 11px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .hint { font-size: 12px; color: var(--text-tertiary); margin: 8px 0; }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1100;
  }
  .modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1101;
    width: 760px;
    max-height: 88vh;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
  }
  .modal-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border-light);
  }
  .modal-header h2 { font-size: 16px; font-weight: 600; flex: 1; }
  .link {
    font-size: 12px;
    color: var(--accent);
    text-decoration: none;
  }
  .link:hover { text-decoration: underline; }
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

  .modal-layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
  .modal-nav {
    width: 180px;
    border-right: 1px solid var(--border-light);
    background: var(--bg-secondary);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .nav-item {
    padding: 8px 12px;
    border: none;
    background: none;
    text-align: left;
    font-size: 13px;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .nav-item:hover { background: var(--surface-hover); }
  .nav-item.active { background: var(--surface); color: var(--accent); font-weight: 500; box-shadow: var(--shadow-sm); }

  .nav-sub-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin: 4px 0 8px 12px;
    padding-left: 8px;
    border-left: 1px solid var(--border-light);
  }
  .nav-sub-item {
    padding: 4px 8px;
    font-size: 12px;
    color: var(--text-tertiary);
    text-decoration: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .nav-sub-item:hover { color: var(--text-primary); background: var(--surface-hover); }

  .sub-h {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
    margin: 24px 0 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border-light);
    scroll-margin-top: 8px;
  }
  .sub-h:first-child {
    margin-top: 0;
  }

  /* Active/off card at the top of the Basics section. */
  .status-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    margin-bottom: 18px;
  }
  .status-card.on {
    border-color: color-mix(in srgb, #22c55e 50%, transparent);
    background: color-mix(in srgb, #22c55e 8%, var(--surface));
  }
  .status-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .status-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .status-card.on .status-label { color: #16a34a; }
  :global(html.dark) .status-card.on .status-label { color: #4ade80; }
  .status-help {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.4;
  }
  .toggle-switch {
    width: 40px;
    height: 22px;
    border-radius: 999px;
    background: var(--surface-active, var(--border));
    border: 1px solid var(--border);
    position: relative;
    cursor: pointer;
    transition: background 0.18s, border-color 0.18s;
    flex-shrink: 0;
    padding: 0;
  }
  .toggle-switch.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .toggle-knob {
    position: absolute;
    top: 1px;
    left: 1px;
    width: 18px;
    height: 18px;
    background: white;
    border-radius: 50%;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    transition: transform 0.18s;
  }
  .toggle-switch.on .toggle-knob { transform: translateX(18px); }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
  }
  .section-help {
    color: var(--text-secondary);
    font-size: 13px;
    margin: 0 0 12px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 16px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .field.full { grid-column: 1 / -1; }
  .field input, .field select, .field textarea {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    font-size: 13px;
    color: var(--text-primary);
    outline: none;
    width: 100%;
    font-family: inherit;
  }
  .field input:focus, .field select:focus, .field textarea:focus { border-color: var(--accent); }
  .field textarea { resize: vertical; min-height: 60px; }
  .field input[type="color"] { padding: 2px; height: 32px; }

  .brand-color-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .brand-presets {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .brand-preset {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid var(--border);
    padding: 0;
    cursor: pointer;
    transition: transform 0.1s, border-color 0.1s;
  }
  .brand-preset:hover { transform: scale(1.1); }
  .brand-preset.active {
    border-color: var(--text-primary);
    box-shadow: 0 0 0 2px var(--surface-elevated), 0 0 0 4px var(--text-primary);
  }
  .brand-picker {
    width: 40px !important;
    height: 28px !important;
    padding: 2px !important;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    cursor: pointer;
  }
  .field select {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' fill='none' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    padding-right: 28px;
    cursor: pointer;
  }
  .help {
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .help code {
    background: var(--bg-tertiary);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 10px;
  }
  .field.toggle {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    color: var(--text-primary);
    font-size: 13px;
  }
  .field.toggle input { width: 14px; height: 14px; accent-color: var(--accent); }

  .weekly {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .weekly-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 8px;
    border-radius: var(--radius-sm);
  }
  .weekly-row:hover { background: var(--surface-hover); }
  .weekday {
    width: 90px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    padding-top: 6px;
  }
  .ranges {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .closed {
    font-size: 12px;
    color: var(--text-tertiary);
    padding: 4px 0;
  }
  .range {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .range input[type="time"] {
    border: none;
    padding: 2px 4px;
    background: none;
    color: var(--text-primary);
    font-size: 12px;
    width: 70px;
  }
  .range input[type="time"]:focus { outline: none; }
  .ghost-btn {
    padding: 4px 10px;
    border: 1px solid transparent;
    background: none;
    color: var(--text-secondary);
    font-size: 12px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .ghost-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
  .ghost-btn.add { color: var(--accent); }
  .ghost-btn.icon-only { padding: 2px 6px; font-size: 14px; line-height: 1; }

  .cal-list {
    margin-top: 16px;
    border-top: 1px solid var(--border-light);
    padding-top: 16px;
  }
  .cal-list-title {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }
  .cal-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 13px;
    color: var(--text-primary);
  }
  .cal-row:hover { background: var(--surface-hover); }
  .cal-row input { accent-color: var(--accent); }

  .modal-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--border-light);
    background: var(--bg-secondary);
  }
  .footer-spacer { flex: 1; }
  .error {
    font-size: 12px;
    color: var(--error);
  }
  .primary-btn {
    padding: 6px 16px;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: white;
    border: none;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .primary-btn:hover { background: var(--accent-hover); }
  .primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  .snippet {
    display: flex;
    align-items: stretch;
    gap: 8px;
    margin: 6px 0 0;
  }
  .snippet code, .snippet pre {
    flex: 1;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    color: var(--text-primary);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }
  .snippet pre code {
    background: none;
    border: none;
    padding: 0;
    font-size: inherit;
  }
  .sub-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 12px;
  }
  .sub-card {
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    padding: 12px;
    background: var(--surface);
  }
  .sub-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 8px;
  }
  .row-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }
  .ghost-btn.danger {
    color: var(--danger, #ef4444);
  }
  .invite-row {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: space-between;
  }
  .invite-url {
    font-size: 12px;
    color: var(--text-secondary);
    font-family: var(--font-mono, monospace);
    word-break: break-all;
  }
  .invite-status {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface-active);
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .invite-status.used {
    background: var(--accent-soft, rgba(99, 102, 241, 0.1));
    color: var(--accent);
  }
  .poll-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .poll-status {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface-active);
    color: var(--text-secondary);
    margin-left: 8px;
    text-transform: capitalize;
  }
  .poll-status.confirmed { background: rgba(34, 197, 94, 0.15); color: rgb(34, 197, 94); }
  .poll-status.declined { background: rgba(239, 68, 68, 0.15); color: var(--danger, #ef4444); }
  .poll-status.pending { background: rgba(245, 158, 11, 0.15); color: rgb(245, 158, 11); }
  .poll-times {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }
</style>
