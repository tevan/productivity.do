<script>
  import BookingWidget from './lib/booking/BookingWidget.svelte';
  import CancelWidget from './lib/booking/CancelWidget.svelte';
  import RoutingFormWidget from './lib/booking/RoutingFormWidget.svelte';

  // URL shapes:
  //   /book/:slug                       — direct booking page
  //   /book/:slug/:typeSlug             — direct booking, specific event type
  //   /book/cancel/:token               — cancel a booking
  //   /book/reschedule/:token           — reschedule (currently cancel + rebook)
  //   /book/i/:token                    — single-use invite
  //   /book/form/:slug                  — routing form
  const path = window.location.pathname.replace(/^\/+/, '').split('/');
  // path[0] === 'book'
  const action = path[1];
  const param = path[2];
  const param2 = path[3];

  let mode = 'book';
  let slug = '';
  let typeSlug = '';
  let token = '';
  let inviteToken = '';

  if (action === 'cancel' && param) {
    mode = 'cancel';
    token = param;
  } else if (action === 'reschedule' && param) {
    mode = 'reschedule';
    token = param;
  } else if (action === 'i' && param) {
    // Single-use invite link: /book/i/<token>
    mode = 'invite';
    inviteToken = param;
  } else if (action === 'form' && param) {
    mode = 'form';
    slug = param;
  } else if (action) {
    mode = 'book';
    slug = action;
    if (param) typeSlug = param;
  }

  // For invite mode we need to look up the page slug from the token
  let inviteSlug = $state('');
  let inviteError = $state('');
  let inviteLoading = $state(false);
  if (mode === 'invite') {
    inviteLoading = true;
    fetch(`/api/public/invite/${inviteToken}`)
      .then(r => r.json())
      .then(j => {
        if (j.ok) inviteSlug = j.invite.pageSlug;
        else inviteError = j.error || 'Invalid invite link.';
      })
      .catch(e => { inviteError = e.message; })
      .finally(() => { inviteLoading = false; });
  }
</script>

<div class="book-shell">
  {#if mode === 'book' && slug}
    <BookingWidget {slug} {typeSlug} />
  {:else if mode === 'cancel'}
    <CancelWidget {token} />
  {:else if mode === 'reschedule'}
    <CancelWidget {token} reschedule />
  {:else if mode === 'invite'}
    {#if inviteLoading}
      <div class="loading">Loading…</div>
    {:else if inviteError}
      <div class="error">{inviteError}</div>
    {:else if inviteSlug}
      <BookingWidget slug={inviteSlug} {inviteToken} />
    {/if}
  {:else if mode === 'form'}
    <RoutingFormWidget {slug} />
  {:else}
    <div class="error">Invalid booking link.</div>
  {/if}
</div>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: #f8f7f5;
    font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    color: #1a1a1a;
    min-height: 100vh;
  }
  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }
  :global(button) { cursor: pointer; }

  .book-shell {
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 32px 16px;
  }

  .loading {
    padding: 32px;
    background: white;
    border-radius: 12px;
    color: #6b7280;
  }
  .error {
    padding: 32px;
    background: white;
    border-radius: 12px;
    color: #b91c1c;
    font-weight: 500;
  }
</style>
