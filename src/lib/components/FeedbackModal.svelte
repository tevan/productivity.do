<script>
  // In-app feedback modal. Triggered from the Settings → Help section
  // and a floating "?" footer button. Posts to /api/feedback which
  // logs to the DB and best-effort emails the founder via Resend.
  //
  // Why in-app: lower friction than mailto, captures session context
  // (URL, user agent) automatically, doesn't require typing the user's
  // email since it's tied to their account.
  //
  // Why not a public forum / Discord yet: see
  // docs/internal/community-and-integrations-strategy.md.

  import { api } from '../api.js';
  import Dropdown from './Dropdown.svelte';

  let { onclose = () => {} } = $props();

  let kind = $state('general');
  let body = $state('');
  let busy = $state(false);
  let err = $state('');
  let sentId = $state(null);

  const KIND_OPTIONS = [
    { value: 'general',  label: 'General feedback' },
    { value: 'bug',      label: 'Bug report' },
    { value: 'feature',  label: 'Feature request' },
    { value: 'other',    label: 'Other' },
  ];

  async function submit() {
    const text = body.trim();
    if (!text) { err = 'Tell us something'; return; }
    busy = true; err = '';
    const r = await api('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        body: text,
        url: typeof location !== 'undefined' ? location.pathname + location.search : '',
      }),
    });
    busy = false;
    if (r?.ok) {
      sentId = r.id;
    } else {
      err = r?.error || 'Could not send. Try again?';
    }
  }

  function reset() {
    kind = 'general';
    body = '';
    err = '';
    sentId = null;
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { onclose(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!busy && body.trim()) submit();
    }
  }
</script>

<div class="modal-backdrop" onclick={onclose} role="dialog" aria-label="Send feedback">
  <div class="feedback-modal" onclick={(e) => e.stopPropagation()} onkeydown={onKeydown}>
    <header>
      <h2>Send feedback</h2>
      <button class="close-btn" onclick={onclose} aria-label="Close">×</button>
    </header>

    {#if sentId}
      <div class="success">
        <div class="check">✓</div>
        <h3>Thanks — got it.</h3>
        <p>We read every one. If you asked a question, we'll reply to your account email.</p>
        <div class="success-actions">
          <button class="secondary" onclick={reset}>Send another</button>
          <button class="primary" onclick={onclose}>Done</button>
        </div>
      </div>
    {:else}
      <div class="form">
        <p class="lead">
          What's on your mind? This goes straight to the team. Replies
          come back to your account email.
        </p>

        <label for="kind">Type</label>
        <Dropdown bind:value={kind} options={KIND_OPTIONS} />

        <label for="body">Tell us</label>
        <textarea
          id="body"
          bind:value={body}
          rows="6"
          placeholder="Say anything — the more specific, the better."
          disabled={busy}
        ></textarea>

        {#if err}
          <div class="err">{err}</div>
        {/if}

        <div class="actions">
          <span class="hint">⌘+Enter to send · Esc to close</span>
          <button class="primary" onclick={submit} disabled={busy || !body.trim()}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed; inset: 0;
    background: var(--backdrop, rgba(0,0,0,0.45));
    display: flex; align-items: center; justify-content: center;
    z-index: 1100;
    padding: 16px;
  }
  .feedback-modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    width: 480px; max-width: 100%;
    max-height: 85vh;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }
  header h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .close-btn {
    background: none; border: none; cursor: pointer;
    font-size: 22px; line-height: 1; color: var(--text-tertiary);
    padding: 0 8px;
  }
  .close-btn:hover { color: var(--text-primary); }

  .form, .success {
    padding: 20px;
    display: flex; flex-direction: column; gap: 10px;
    overflow-y: auto;
  }

  .lead {
    margin: 0 0 6px;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.55;
  }

  label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-top: 4px;
  }

  textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: 14px;
    line-height: 1.55;
    resize: vertical;
    min-height: 120px;
    background: var(--bg-secondary);
    color: var(--text-primary);
  }
  textarea:focus { border-color: var(--accent); outline: none; }

  .err {
    padding: 8px 12px;
    background: color-mix(in srgb, var(--error, #c62828) 12%, transparent);
    color: var(--error, #c62828);
    border-radius: var(--radius-sm);
    font-size: 13px;
  }

  .actions {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: 6px;
  }
  .hint { font-size: 11px; color: var(--text-tertiary); }

  .primary, .secondary {
    padding: 7px 14px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
  }
  .primary {
    background: var(--accent); color: white; border-color: var(--accent);
  }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .secondary {
    background: var(--bg-secondary); color: var(--text-primary);
  }

  .success { text-align: center; padding: 28px 24px; }
  .success .check {
    width: 48px; height: 48px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--success, #15803d) 15%, transparent);
    color: var(--success, #15803d);
    margin: 0 auto 12px;
    display: flex; align-items: center; justify-content: center;
    font-size: 28px; font-weight: 700;
  }
  .success h3 { margin: 0 0 4px; font-size: 16px; }
  .success p { margin: 0 0 16px; font-size: 13px; color: var(--text-secondary); }
  .success-actions { display: flex; gap: 8px; justify-content: center; }
</style>
