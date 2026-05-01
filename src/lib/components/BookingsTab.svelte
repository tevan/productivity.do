<script>
  import { api } from '../api.js';
  import BookingPageEditor from './BookingPageEditor.svelte';
  import {
    getBookingPages,
    fetchBookingPages,
    createBookingPage,
    deleteBookingPage,
  } from '../stores/bookingPages.svelte.js';
  import { tooltip } from '../actions/tooltip.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';

  const pageStore = getBookingPages();
  const pages = $derived(pageStore.items);
  const loading = $derived(pageStore.loading && !pageStore.loaded);

  let editorPage = $state(null);
  let copiedId = $state(null);
  let viewingBookingsFor = $state(null);
  let bookingsList = $state([]);
  let bookingsLoading = $state(false);

  $effect(() => { fetchBookingPages(); });

  async function createPage() {
    const page = await createBookingPage();
    if (page) editorPage = page;
  }

  async function deletePage(p) {
    if (!await confirmAction({ title: 'Delete booking page?', body: `"${p.title}" and all its existing bookings will be removed.`, confirmLabel: 'Delete', danger: true })) return;
    await deleteBookingPage(p.id);
  }

  function copyLink(p) {
    const url = `${window.location.origin}/book/${p.slug}`;
    navigator.clipboard.writeText(url).then(() => {
      copiedId = p.id;
      setTimeout(() => { if (copiedId === p.id) copiedId = null; }, 1200);
    });
  }

  async function viewBookings(p) {
    viewingBookingsFor = p;
    bookingsLoading = true;
    bookingsList = [];
    try {
      const res = await api(`/api/booking-pages/${p.id}/bookings`);
      if (res.ok) bookingsList = res.bookings;
    } finally {
      bookingsLoading = false;
    }
  }

  function fmtBooking(b) {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(b.start_iso));
  }

  function onEditorClose() {
    editorPage = null;
    // Editor commits via store; store already updated.
  }
</script>

<div class="bookings-section">
  <div class="bookings-header">
    <div>
      <h3>Booking pages</h3>
      <p class="help-text">Share a public link so others can pick a time on your calendar.</p>
    </div>
    <button class="primary-btn" onclick={createPage}>+ New page</button>
  </div>

  {#if loading}
    <div class="empty">Loading…</div>
  {:else if pages.length === 0}
    <div class="empty">
      <p>No booking pages yet.</p>
      <button class="primary-btn" onclick={createPage}>Create your first one</button>
    </div>
  {:else}
    <div class="page-list">
      {#each pages as p (p.id)}
        <div class="page-item" class:inactive={!p.isActive}>
          <div class="page-color" style="background: {p.color || '#6366f1'}"></div>
          <div class="page-info">
            <div class="page-title-row">
              <span class="page-title">{p.title}</span>
              {#if !p.isActive}<span class="badge">Off</span>{/if}
            </div>
            <div class="page-meta">
              <span>{p.durationMin} min</span>
              <span>·</span>
              <span class="slug">/book/{p.slug}</span>
            </div>
          </div>
          <div class="page-actions">
            <button class="ghost-btn" onclick={() => copyLink(p)} use:tooltip={'Copy link'}>
              {copiedId === p.id ? 'Copied!' : 'Copy link'}
            </button>
            <button class="ghost-btn" onclick={() => viewBookings(p)} use:tooltip={'View bookings'}>Bookings</button>
            <button class="ghost-btn" onclick={() => editorPage = p}>Edit</button>
            <button class="ghost-btn danger" onclick={() => deletePage(p)}>Delete</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if editorPage}
  <BookingPageEditor page={editorPage} onclose={onEditorClose} />
{/if}

{#if viewingBookingsFor}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay-backdrop" onclick={() => viewingBookingsFor = null}></div>
  <div class="overlay">
    <div class="overlay-header">
      <h2>Bookings — {viewingBookingsFor.title}</h2>
      <div style="display:flex; gap:6px;">
        <a class="ghost-btn" href={`/api/booking-pages/${viewingBookingsFor.id}/bookings.csv`} download>Download CSV</a>
        <button class="ghost-btn" onclick={() => viewingBookingsFor = null}>Close</button>
      </div>
    </div>
    <div class="overlay-body">
      {#if bookingsLoading}
        <p>Loading…</p>
      {:else if bookingsList.length === 0}
        <p class="empty-text">No bookings yet.</p>
      {:else}
        <table class="bookings-table">
          <thead>
            <tr><th>When</th><th>Invitee</th><th>Status</th></tr>
          </thead>
          <tbody>
            {#each bookingsList as b (b.id)}
              <tr class:cancelled={b.status === 'cancelled'}>
                <td>{fmtBooking(b)}</td>
                <td>
                  <div>{b.invitee_name}</div>
                  <div class="email">{b.invitee_email}</div>
                </td>
                <td><span class="status status-{b.status}">{b.status}</span></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>
{/if}

<style>
  .bookings-section {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .bookings-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .bookings-header h3 {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 4px;
  }
  .help-text {
    font-size: 13px;
    color: var(--text-tertiary);
    margin: 0;
  }
  .primary-btn {
    padding: 6px 14px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: white;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }
  .primary-btn:hover { background: var(--accent-hover); }

  .empty {
    padding: 32px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 13px;
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .page-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .page-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--radius-md);
    transition: border-color 0.1s;
  }
  .page-item:hover { border-color: var(--accent); }
  .page-item.inactive { opacity: 0.7; }
  .page-color {
    width: 4px;
    align-self: stretch;
    border-radius: 2px;
  }
  .page-info { flex: 1; min-width: 0; }
  .page-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .page-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    background: var(--surface-active);
    color: var(--text-tertiary);
    border-radius: 3px;
    text-transform: uppercase;
  }
  .page-meta {
    display: flex;
    gap: 6px;
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .slug { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

  .page-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .ghost-btn {
    padding: 4px 10px;
    border: 1px solid transparent;
    background: none;
    color: var(--text-secondary);
    font-size: 12px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .ghost-btn:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .ghost-btn.danger { color: var(--error); }

  .overlay-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.3);
    z-index: 1100;
  }
  .overlay {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1101;
    width: 640px;
    max-height: 80vh;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
  }
  .overlay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border-light);
  }
  .overlay-header h2 { font-size: 15px; font-weight: 600; }
  .overlay-body {
    padding: 16px 20px;
    overflow-y: auto;
  }
  .empty-text { color: var(--text-tertiary); font-size: 13px; }

  .bookings-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .bookings-table th, .bookings-table td {
    padding: 8px 10px;
    text-align: left;
    border-bottom: 1px solid var(--border-light);
  }
  .bookings-table th {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .bookings-table tr.cancelled td { color: var(--text-tertiary); text-decoration: line-through; }
  .bookings-table .email { font-size: 11px; color: var(--text-tertiary); }
  .status {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
    text-transform: capitalize;
  }
  .status-confirmed { background: #d4edda; color: #10b981; }
  .status-cancelled { background: #fee2e2; color: #b91c1c; }
  .status-rescheduled { background: #fff3cd; color: #92400e; }
</style>
