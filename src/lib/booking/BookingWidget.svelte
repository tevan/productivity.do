<script>
  import Dropdown from '../components/Dropdown.svelte';

  let { slug = '', typeSlug = null, inviteToken = null } = $props();

  let page = $state(null);
  let loading = $state(true);
  let loadError = $state('');

  // Selected event type (when page has multiple)
  let selectedType = $state(null);

  // Local state
  let inviteeTz = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);
  let viewMonth = $state(new Date());
  let selectedDate = $state(null);  // 'YYYY-MM-DD' (host-local)
  let slots = $state([]);
  let slotsLoading = $state(false);
  let selectedSlot = $state(null);
  let availableDays = $state(new Set());
  let nextSlot = $state(null);

  // Form
  let name = $state('');
  let email = $state('');
  let phone = $state('');
  let message = $state('');
  let answers = $state({});  // { questionId: value }
  let submitting = $state(false);
  let submitError = $state('');
  let confirmation = $state(null);

  $effect(() => {
    fetchPage();
  });

  async function fetchPage() {
    loading = true;
    loadError = '';
    try {
      const res = await fetch(`/api/public/booking/${encodeURIComponent(slug)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Not found');
      page = data.page;
      // Auto-select event type from URL or single-type fallback
      if (typeSlug && page.eventTypes) {
        selectedType = page.eventTypes.find(t => t.slug === typeSlug) || null;
      } else if (page.hasEventTypes && page.eventTypes?.length === 1) {
        selectedType = page.eventTypes[0];
      }
    } catch (err) {
      loadError = err.message;
    } finally {
      loading = false;
    }
  }

  // Whenever the visible month changes, prefetch which days have any slots so
  // we can dim or strike-through closed days. Only fetch a small range.
  $effect(() => {
    if (!page) return;
    refreshMonthAvailability();
    fetchNextSlot();
  });

  async function fetchNextSlot() {
    if (!page) return;
    try {
      const url = new URL(`/api/public/booking/${encodeURIComponent(slug)}/next-slot`, window.location.origin);
      if (selectedType?.slug) url.searchParams.set('type', selectedType.slug);
      const res = await fetch(url);
      const data = await res.json();
      if (data.ok) nextSlot = data.slot;
    } catch {}
  }

  async function refreshMonthAvailability() {
    if (!page) return;
    const days = monthDays(viewMonth);
    const next = new Set();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxAdvance = new Date(today.getTime() + (page.maxAdvanceDays || 60) * 86400000);
    // Heuristic: only check days within max_advance and after today
    const candidates = days.filter(d => d >= today && d <= maxAdvance);
    // Cheap path: trust availabilityWeekdays first, then enrich on actual fetch in selectDate
    const weekdayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    for (const d of candidates) {
      const key = weekdayKeys[d.getDay()];
      if (page.availabilityWeekdays?.includes(key)) {
        next.add(toDateStr(d));
      }
    }
    availableDays = next;
  }

  function monthDays(monthDate) {
    const y = monthDate.getFullYear();
    const m = monthDate.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const days = [];
    for (let d = 1; d <= last.getDate(); d++) days.push(new Date(y, m, d));
    return days;
  }

  function toDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function gridDays(monthDate) {
    // Calendar grid: weeks of 7 days, starting Sunday for now (could honor weekStartDay later)
    const y = monthDate.getFullYear();
    const m = monthDate.getMonth();
    const first = new Date(y, m, 1);
    const startDow = first.getDay(); // 0 = Sun
    const last = new Date(y, m + 1, 0);
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(y, m, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  function prevMonth() {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
  }
  function nextMonth() {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
  }

  async function selectDate(d) {
    if (!d) return;
    const key = toDateStr(d);
    selectedDate = key;
    selectedSlot = null;
    slotsLoading = true;
    slots = [];
    try {
      const params = new URLSearchParams({ date: key, tz: inviteeTz });
      if (selectedType?.slug) params.set('type', selectedType.slug);
      const res = await fetch(`/api/public/booking/${encodeURIComponent(slug)}/slots?${params}`);
      const data = await res.json();
      if (data.ok) slots = data.slots;
      else slots = [];
    } catch {
      slots = [];
    } finally {
      slotsLoading = false;
    }
  }

  function fmtTime(iso) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: inviteeTz,
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(iso));
  }

  function fmtFullDateTime(iso) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: inviteeTz,
      weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(iso));
  }

  async function submitBooking() {
    if (!selectedSlot || submitting) return;
    submitError = '';
    if (!name.trim()) { submitError = 'Please enter your name.'; return; }
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) { submitError = 'Please enter a valid email.'; return; }
    if (page.requirePhone && !phone.trim()) { submitError = 'Please enter your phone number.'; return; }
    submitting = true;
    try {
      // Validate required custom questions client-side
      for (const q of (page.questions || [])) {
        if (q.typeId && q.typeId !== selectedType?.id) continue;
        if (q.required) {
          const v = answers[q.id];
          if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
            submitError = `Please answer "${q.label}".`;
            submitting = false;
            return;
          }
        }
      }
      const res = await fetch(`/api/public/booking/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email, phone, message,
          answers,
          startIso: selectedSlot.startIso,
          endIso: selectedSlot.endIso,
          timezone: inviteeTz,
          typeSlug: selectedType?.slug || undefined,
          inviteToken: inviteToken || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        submitError = data.error || 'Something went wrong.';
        return;
      }
      confirmation = data.booking;
      if (data.redirect) {
        setTimeout(() => { window.location.href = data.redirect; }, 1200);
      }
    } catch (err) {
      submitError = err.message;
    } finally {
      submitting = false;
    }
  }

  // Build a list of common timezones for the dropdown
  const TIMEZONES = (typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : []);
</script>

{#if loading}
  <div class="card loading">Loading…</div>
{:else if loadError}
  <div class="card error">
    <h1>Booking page unavailable</h1>
    <p>{loadError}</p>
  </div>
{:else if confirmation}
  <div class="card confirm">
    <div class="confirm-icon">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="22" stroke="#10b981" stroke-width="2"/>
        <path d="M14 24l8 8 14-16" stroke="#10b981" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h1>You're booked!</h1>
    <p class="confirm-detail">{fmtFullDateTime(confirmation.startIso)}</p>
    <p class="confirm-sub">A confirmation will arrive shortly. We'll see you then.</p>
    <div class="confirm-actions">
      <a class="btn-secondary" href={confirmation.cancelUrl}>Cancel booking</a>
      <a class="btn-secondary" href={confirmation.rescheduleUrl}>Reschedule</a>
    </div>
  </div>
{:else}
  <div class="layout">
    <!-- Left: page summary -->
    <aside class="summary" style="--brand: {page.brandColor || page.color || '#6366f1'}">
      {#if page.coverImageUrl}
        <img class="cover" src={page.coverImageUrl} alt="" />
      {:else if page.brandColor || page.color}
        <div class="color-stripe" style="background: {page.brandColor || page.color}"></div>
      {/if}
      {#if page.logoUrl}
        <img class="logo" src={page.logoUrl} alt="" />
      {/if}
      {#if page.hostName}
        <div class="host">{page.hostName}</div>
      {/if}
      <h1 class="title">{page.title}</h1>
      {#if nextSlot}
        <button class="next-slot-badge" type="button" onclick={() => {
          const d = new Date(nextSlot.startIso);
          selectedDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          viewMonth = d;
        }}>
          <span class="ns-dot"></span>
          Next available: {new Intl.DateTimeFormat(undefined, {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
            timeZone: inviteeTz,
          }).format(new Date(nextSlot.startIso))}
        </button>
      {/if}
      <div class="meta">
        <span class="meta-row">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
            <path d="M7 4v3l2 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
          {page.durationMin} min
        </span>
        <span class="meta-row">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            {#if page.locationType === 'video'}
              <rect x="1.5" y="3.5" width="8" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/>
              <path d="M9.5 6l3-1.5v5L9.5 8" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/>
            {:else if page.locationType === 'phone'}
              <path d="M3 2c0 6 3 9 9 9l1.5-1.5L11 8 9 9C7 8 6 7 5 5l1-2L3.5 1.5z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/>
            {:else if page.locationType === 'inperson'}
              <path d="M7 1C4.79 1 3 2.79 3 5c0 3.5 4 8 4 8s4-4.5 4-8c0-2.21-1.79-4-4-4z" stroke="currentColor" stroke-width="1.2"/>
            {:else}
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
            {/if}
          </svg>
          {locationLabel(page)}
        </span>
      </div>
      {#if page.description}
        <p class="description">{page.description}</p>
      {/if}
    </aside>

    <!-- Middle: calendar -->
    <section class="calendar" style="--brand: {page.brandColor || page.color || '#6366f1'}">
      <div class="cal-header">
        <button class="cal-nav" onclick={prevMonth} aria-label="Previous month">‹</button>
        <span class="cal-title">{viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
        <button class="cal-nav" onclick={nextMonth} aria-label="Next month">›</button>
      </div>
      <div class="cal-grid-head">
        {#each ['S','M','T','W','T','F','S'] as d}
          <div class="cal-dow">{d}</div>
        {/each}
      </div>
      <div class="cal-grid">
        {#each gridDays(viewMonth) as cell}
          {#if cell}
            {@const key = toDateStr(cell)}
            {@const dayOpen = availableDays.has(key)}
            {@const isToday = toDateStr(new Date()) === key}
            {@const isSelected = selectedDate === key}
            {@const inPast = cell < new Date(new Date().setHours(0,0,0,0))}
            <button
              class="cal-cell"
              class:open={dayOpen && !inPast}
              class:disabled={!dayOpen || inPast}
              class:today={isToday}
              class:selected={isSelected}
              disabled={!dayOpen || inPast}
              onclick={() => selectDate(cell)}
            >{cell.getDate()}</button>
          {:else}
            <div class="cal-cell empty"></div>
          {/if}
        {/each}
      </div>

      <!-- Timezone selector -->
      <div class="tz-row">
        <label for="tz-sel">Timezone</label>
        <div class="tz-dd">
          <Dropdown
            bind:value={inviteeTz}
            ariaLabel="Timezone"
            options={TIMEZONES.map(tz => ({ value: tz, label: tz.replace(/_/g, ' ') }))}
          />
        </div>
      </div>
    </section>

    <!-- Right: slots / form -->
    <section class="right" style="--brand: {page.brandColor || page.color || '#6366f1'}">
      {#if page.hasEventTypes && !selectedType}
        <h2 class="slots-heading">What kind of meeting?</h2>
        <div class="slots">
          {#each page.eventTypes || [] as t (t.id)}
            <button class="slot type-slot" onclick={() => selectedType = t}>
              <span class="type-dot" style="background: {t.color || page.brandColor || '#6366f1'}"></span>
              <span class="type-text">
                <span class="type-title">{t.title}</span>
                <span class="type-meta">{t.durationMin} min{t.capacity > 1 ? ` · up to ${t.capacity}` : ''}</span>
              </span>
            </button>
          {/each}
        </div>
      {:else if !selectedDate}
        <div class="hint">Pick a day to see available times.</div>
      {:else if slotsLoading}
        <div class="hint">Loading times…</div>
      {:else if slots.length === 0}
        <div class="hint">No times available on this day. Pick another day.</div>
      {:else if !selectedSlot}
        <h2 class="slots-heading">{new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
        <div class="slots">
          {#each slots as slot (slot.startIso)}
            <button class="slot" onclick={() => selectedSlot = slot}>{fmtTime(slot.startIso)}</button>
          {/each}
        </div>
      {:else}
        <h2 class="form-heading">Confirm details</h2>
        <p class="form-when">{fmtFullDateTime(selectedSlot.startIso)}</p>
        <div class="form">
          <label class="field">
            <span>Name</span>
            <input type="text" bind:value={name} placeholder="Your name" required />
          </label>
          <label class="field">
            <span>Email</span>
            <input type="email" bind:value={email} placeholder="you@example.com" required />
          </label>
          {#if page.requirePhone}
            <label class="field">
              <span>Phone</span>
              <input type="tel" bind:value={phone} placeholder="(555) 123-4567" required />
            </label>
          {/if}
          {#each (page.questions || []).filter(q => !q.typeId || q.typeId === selectedType?.id) as q (q.id)}
            <label class="field">
              <span>{q.label}{q.required ? ' *' : ''}</span>
              {#if q.fieldType === 'textarea'}
                <textarea bind:value={answers[q.id]} rows="3"></textarea>
              {:else if q.fieldType === 'select' && Array.isArray(q.options)}
                <Dropdown
                  bind:value={answers[q.id]}
                  ariaLabel={q.label}
                  placeholder="— Select —"
                  options={q.options.map(opt => ({ value: opt, label: opt }))}
                />
              {:else if q.fieldType === 'checkbox' && Array.isArray(q.options)}
                <div class="checkbox-list">
                  {#each q.options as opt}
                    <label class="checkbox-row">
                      <input
                        type="checkbox"
                        checked={(answers[q.id] || []).includes(opt)}
                        onchange={(e) => {
                          const cur = answers[q.id] || [];
                          answers = { ...answers, [q.id]: e.target.checked ? [...cur, opt] : cur.filter(x => x !== opt) };
                        }}
                      />
                      <span>{opt}</span>
                    </label>
                  {/each}
                </div>
              {:else}
                <input type="text" bind:value={answers[q.id]} />
              {/if}
            </label>
          {/each}
          <label class="field">
            <span>Anything else? <span class="optional">(optional)</span></span>
            <textarea bind:value={message} rows="3" placeholder="Add a note for the host"></textarea>
          </label>
          {#if submitError}
            <div class="form-error">{submitError}</div>
          {/if}
          <div class="form-actions">
            <button class="btn-secondary" onclick={() => selectedSlot = null}>Back</button>
            <button class="btn-primary" onclick={submitBooking} disabled={submitting}>
              {submitting ? 'Booking…' : 'Confirm booking'}
            </button>
          </div>
        </div>
      {/if}
    </section>
  </div>
{/if}

<script module>
  function locationLabel(page) {
    switch (page.locationType) {
      case 'video': return page.locationValue || 'Google Meet';
      case 'phone': return page.locationValue ? `Phone: ${page.locationValue}` : 'Phone call';
      case 'inperson': return page.locationValue || 'In person';
      case 'custom': return page.locationValue || 'Custom';
      default: return 'Online';
    }
  }
</script>

<style>
  .card {
    background: white;
    border-radius: 14px;
    padding: 32px;
    box-shadow: 0 4px 30px rgba(0,0,0,0.06);
    max-width: 480px;
    width: 100%;
  }
  .loading, .error { text-align: center; }
  .error h1 { font-size: 18px; margin: 0 0 8px; color: #b91c1c; }

  .layout {
    display: grid;
    grid-template-columns: 280px 1fr 280px;
    background: white;
    border-radius: 14px;
    box-shadow: 0 4px 30px rgba(0,0,0,0.06);
    overflow: hidden;
    max-width: 920px;
    width: 100%;
    min-height: 480px;
  }

  @media (max-width: 820px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 640px) {
    .layout { border-radius: 0; box-shadow: none; }
    .summary {
      padding: 18px;
      border-right: none;
      border-bottom: 1px solid #ececec;
    }
    .picker { padding: 18px; }
    .title { font-size: 18px; }
    .slots {
      grid-template-columns: 1fr;
    }
    .slot, .form-input, .picker button {
      min-height: 44px;
    }
    .next-slot-badge { font-size: 13px; padding: 6px 12px; }
  }

  /* SUMMARY (left) */
  .summary {
    padding: 28px;
    border-right: 1px solid #ececec;
    position: relative;
    background: #fafafa;
  }
  .cover {
    display: block;
    width: calc(100% + 56px);
    margin: -28px -28px 16px -28px;
    height: 100px;
    object-fit: cover;
  }
  .logo {
    display: block;
    width: 48px;
    height: 48px;
    object-fit: contain;
    margin-bottom: 12px;
    border-radius: 8px;
  }
  .color-stripe {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 4px;
  }
  .host {
    font-size: 12px;
    font-weight: 500;
    color: #6b7280;
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .title {
    font-size: 20px;
    font-weight: 600;
    margin: 0 0 12px;
    color: #111;
    line-height: 1.25;
  }
  .next-slot-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: #ecfdf5;
    color: #047857;
    border: 1px solid #a7f3d0;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    margin-bottom: 4px;
  }
  .next-slot-badge:hover { background: #d1fae5; }
  .ns-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #10b981;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 12px 0;
  }
  .meta-row {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #4b5563;
  }
  .meta-row svg { color: #6b7280; }
  .description {
    font-size: 13px;
    color: #4b5563;
    line-height: 1.5;
    margin: 12px 0 0;
    white-space: pre-wrap;
  }

  /* CALENDAR (middle) */
  .calendar {
    padding: 24px;
    border-right: 1px solid #ececec;
  }
  .cal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .cal-title {
    font-size: 14px;
    font-weight: 600;
    color: #111;
  }
  .cal-nav {
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    border-radius: 6px;
    color: #6b7280;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
  }
  .cal-nav:hover { background: #f3f4f6; color: #111; }

  .cal-grid-head {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
    margin-bottom: 4px;
  }
  .cal-dow {
    text-align: center;
    font-size: 10px;
    font-weight: 600;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 4px 0;
  }
  .cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .cal-cell {
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    color: #d1d5db;
    transition: background 0.1s;
  }
  .cal-cell.empty { visibility: hidden; }
  .cal-cell.open {
    color: #111;
    background: #eef2ff;
  }
  .cal-cell.open:hover {
    background: #c7d2fe;
  }
  .cal-cell.today { box-shadow: inset 0 0 0 1px var(--brand, #6366f1); }
  .cal-cell.selected {
    background: var(--brand, #6366f1);
    color: white;
  }
  .cal-cell.disabled {
    cursor: not-allowed;
    color: #d1d5db;
  }
  .cal-cell.disabled:hover { background: none; }

  .tz-row {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: #6b7280;
  }
  .tz-row select {
    padding: 6px 8px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    background: white;
    font-size: 13px;
    color: #111;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' fill='none' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    padding-right: 26px;
    cursor: pointer;
  }

  /* RIGHT (slots / form) */
  .right {
    padding: 24px;
    overflow-y: auto;
    max-height: 580px;
  }
  .hint {
    color: #9ca3af;
    font-size: 14px;
    text-align: center;
    margin-top: 80px;
  }
  .slots-heading, .form-heading {
    font-size: 14px;
    font-weight: 600;
    color: #111;
    margin: 0 0 12px;
  }
  .form-when {
    color: var(--brand, #6366f1);
    font-weight: 500;
    margin: 0 0 16px;
    font-size: 13px;
  }
  .slots {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .slot {
    padding: 10px 14px;
    border: 1px solid #e5e7eb;
    background: white;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    color: #111;
    cursor: pointer;
    text-align: center;
    transition: border-color 0.1s, background 0.1s;
  }
  .slot:hover {
    border-color: var(--brand, #6366f1);
    background: color-mix(in srgb, var(--brand, #6366f1) 10%, transparent);
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: #6b7280;
  }
  .field input, .field textarea {
    padding: 8px 10px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    font-size: 14px;
    color: #111;
    outline: none;
    font-family: inherit;
    background: white;
  }
  .field input:focus, .field textarea:focus {
    border-color: #6366f1;
  }
  .field textarea { resize: vertical; min-height: 60px; }
  .optional { color: #9ca3af; }

  .form-error {
    background: #fee2e2;
    color: #b91c1c;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 13px;
  }
  .form-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 8px;
  }
  .btn-primary, .btn-secondary {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    border: none;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .btn-primary {
    background: var(--brand, #6366f1);
    color: white;
  }
  .btn-primary:hover { filter: brightness(0.92); }
  .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-secondary {
    background: white;
    color: #4b5563;
    border: 1px solid #e5e7eb;
  }
  .btn-secondary:hover { background: #f9fafb; }

  /* Confirmation */
  .confirm { text-align: center; padding: 48px 32px; }
  .confirm-icon { margin-bottom: 16px; }
  .confirm h1 {
    font-size: 24px;
    font-weight: 600;
    margin: 0 0 8px;
    color: #111;
  }
  .confirm-detail {
    font-size: 16px;
    color: #4b5563;
    margin: 0 0 4px;
  }
  .confirm-sub {
    font-size: 13px;
    color: #6b7280;
    margin: 0 0 24px;
  }
  .confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
</style>
