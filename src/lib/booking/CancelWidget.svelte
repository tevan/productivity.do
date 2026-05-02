<script>
  let { token = '', reschedule = false } = $props();

  let booking = $state(null);
  let loading = $state(true);
  let loadError = $state('');
  let reason = $state('');
  let submitting = $state(false);
  let done = $state(false);

  // Reschedule state
  let pickedDate = $state(new Date().toISOString().slice(0, 10));
  let slots = $state([]);
  let slotsLoading = $state(false);
  let pickedSlot = $state(null);
  let rescheduleError = $state('');

  $effect(() => {
    fetchBooking();
  });

  async function fetchBooking() {
    loading = true;
    try {
      const endpoint = reschedule
        ? `/api/public/booking/by-reschedule-token/${encodeURIComponent(token)}`
        : `/api/public/booking/by-cancel-token/${encodeURIComponent(token)}`;
      const res = await fetch(endpoint);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Booking not found');
      booking = data.booking;
      if (reschedule) {
        pickedDate = booking.startIso.slice(0, 10);
        loadSlots();
      }
    } catch (err) {
      loadError = err.message;
    } finally {
      loading = false;
    }
  }

  async function loadSlots() {
    if (!booking) return;
    slotsLoading = true;
    pickedSlot = null;
    try {
      const res = await fetch(
        `/api/public/booking/${encodeURIComponent(booking.page.slug)}/slots?date=${pickedDate}`
      );
      const data = await res.json();
      if (data.ok) slots = data.slots || [];
    } finally {
      slotsLoading = false;
    }
  }

  function changeDate(delta) {
    const d = new Date(pickedDate);
    d.setDate(d.getDate() + delta);
    pickedDate = d.toISOString().slice(0, 10);
    loadSlots();
  }

  async function submitReschedule() {
    if (!pickedSlot) return;
    submitting = true;
    rescheduleError = '';
    try {
      const res = await fetch(`/api/public/booking/reschedule/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startIso: pickedSlot.startIso, endIso: pickedSlot.endIso }),
      });
      const data = await res.json();
      if (data.ok) {
        booking.startIso = data.booking.startIso;
        booking.endIso = data.booking.endIso;
        done = true;
      } else {
        rescheduleError = data.error || 'Could not reschedule.';
        // Refresh slots so the user can pick a still-available one
        loadSlots();
      }
    } catch (err) {
      rescheduleError = err.message;
    } finally {
      submitting = false;
    }
  }

  async function cancel() {
    submitting = true;
    try {
      const res = await fetch(`/api/public/booking/cancel/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (data.ok) done = true;
    } finally {
      submitting = false;
    }
  }

  function fmt(iso) {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(iso));
  }
  function fmtTime(iso) {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(iso));
  }
  function fmtDateLabel(s) {
    return new Date(s + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    });
  }
</script>

{#if loading}
  <div class="card">Loading…</div>
{:else if loadError}
  <div class="card error">{loadError}</div>
{:else if done}
  <div class="card center">
    <h1>Booking cancelled</h1>
    <p>The host has been notified.</p>
    <a class="powered-by" href="https://productivity.do/signup" target="_blank" rel="noopener">
      Make your own free booking page →
    </a>
  </div>
{:else if booking.status !== 'confirmed'}
  <div class="card center">
    <h1>This booking is no longer active</h1>
    <p>Status: {booking.status}</p>
  </div>
{:else if reschedule && done}
  <div class="card center">
    <h1>Rescheduled ✓</h1>
    <p class="when">New time: {fmt(booking.startIso)}</p>
    <p>The host has been notified. A confirmation email is on the way.</p>
    <a class="powered-by" href="https://productivity.do/signup" target="_blank" rel="noopener">
      Make your own free booking page →
    </a>
  </div>
{:else if reschedule}
  <div class="card">
    <h1>Reschedule booking</h1>
    <p class="muted">Currently scheduled for <strong>{fmt(booking.startIso)}</strong></p>
    <div class="date-row">
      <button class="nav-btn" onclick={() => changeDate(-1)} aria-label="Previous day">←</button>
      <div class="date-label">{fmtDateLabel(pickedDate)}</div>
      <button class="nav-btn" onclick={() => changeDate(1)} aria-label="Next day">→</button>
    </div>
    {#if slotsLoading}
      <div class="muted center">Loading times…</div>
    {:else if slots.length === 0}
      <div class="muted center">No times available on this day.</div>
    {:else}
      <div class="slots">
        {#each slots as s (s.startIso)}
          <button class="slot" class:selected={pickedSlot?.startIso === s.startIso}
                  onclick={() => pickedSlot = s}>
            {fmtTime(s.startIso)}
          </button>
        {/each}
      </div>
    {/if}
    {#if rescheduleError}<div class="err">{rescheduleError}</div>{/if}
    <div class="actions">
      <a class="btn-secondary" href={`/book/${booking.page.slug}`}>Back</a>
      <button class="btn-primary" onclick={submitReschedule} disabled={!pickedSlot || submitting}>
        {submitting ? 'Saving…' : 'Confirm new time'}
      </button>
    </div>
  </div>
{:else}
  <div class="card">
    <h1>Cancel booking</h1>
    <p class="when">{fmt(booking.startIso)}</p>
    <p>With <strong>{booking.page.hostName || booking.page.title}</strong></p>
    <label class="field">
      <span>Reason (optional)</span>
      <textarea bind:value={reason} rows="3" placeholder="Let the host know why…"></textarea>
    </label>
    <div class="actions">
      <a class="btn-secondary" href={`/book/${booking.page.slug}`}>Keep booking</a>
      <button class="btn-primary danger" onclick={cancel} disabled={submitting}>
        {submitting ? 'Cancelling…' : 'Cancel booking'}
      </button>
    </div>
  </div>
{/if}

<style>
  .card {
    background: white;
    padding: 32px;
    border-radius: 14px;
    box-shadow: 0 4px 30px rgba(0,0,0,0.06);
    max-width: 480px;
    width: 100%;
  }
  .card.center { text-align: center; }
  .card.error { color: #b91c1c; text-align: center; }
  h1 { font-size: 20px; margin: 0 0 8px; color: #111; }
  .when {
    font-size: 16px;
    color: #6366f1;
    font-weight: 500;
    margin: 0 0 8px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 16px 0;
    font-size: 12px;
    color: #6b7280;
  }
  textarea {
    padding: 8px 10px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    font-size: 14px;
    color: #111;
    outline: none;
    font-family: inherit;
    background: white;
    resize: vertical;
  }
  textarea:focus { border-color: #6366f1; }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 16px;
  }
  .btn-primary, .btn-secondary {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    border: none;
    cursor: pointer;
    text-decoration: none;
  }
  .btn-primary { background: #6366f1; color: white; }
  .btn-primary:hover { background: #4f46e5; }
  .btn-primary.danger { background: #b91c1c; }
  .btn-primary.danger:hover { background: #991b1b; }
  .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-secondary {
    background: white;
    color: #4b5563;
    border: 1px solid #e5e7eb;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .btn-secondary:hover { background: #f9fafb; }
  .muted { color: #6b7280; font-size: 13px; margin: 0 0 12px; }
  .center { text-align: center; }
  .date-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin: 16px 0 12px;
  }
  .nav-btn {
    background: white; border: 1px solid #e5e7eb;
    width: 32px; height: 32px; border-radius: 8px; cursor: pointer;
    color: #4b5563; font-size: 14px;
  }
  .nav-btn:hover { background: #f9fafb; }
  .date-label { font-weight: 500; min-width: 140px; text-align: center; color: #111; }
  .slots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 8px;
    margin: 12px 0;
    max-height: 280px;
    overflow-y: auto;
  }
  .slot {
    padding: 8px 12px; background: white; border: 1px solid #e5e7eb;
    border-radius: 8px; cursor: pointer; font-size: 14px; color: #1f2937;
    font-family: inherit;
  }
  .slot:hover { border-color: #6366f1; }
  .slot.selected { background: #6366f1; color: white; border-color: #6366f1; }
  .err {
    background: rgba(239,68,68,0.1); color: #b91c1c;
    padding: 10px 14px; border-radius: 8px; font-size: 13px; margin: 8px 0;
  }
  @media (max-width: 640px) {
    .card {
      padding: 20px;
      border-radius: 0;
      box-shadow: none;
      max-width: 100%;
    }
    .slots { grid-template-columns: repeat(2, 1fr); }
    .slot, .btn-primary, .btn-secondary { min-height: 44px; }
  }
  .powered-by {
    display: inline-block;
    margin-top: 20px;
    font-size: 12px;
    color: #6b7280;
    text-decoration: none;
    cursor: pointer;
  }
  .powered-by:hover { color: #111827; }
</style>
