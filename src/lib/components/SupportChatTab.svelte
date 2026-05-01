<script>
  // Settings → Help → AI assistant.
  //
  // Conversational support widget. Each message goes to /api/support-chat
  // which calls Claude Haiku grounded in the knowledgebase. Daily budget
  // (25 messages) is enforced server-side; we surface the warning at 20.

  import { onMount, tick } from 'svelte';
  import { api } from '../api.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';

  let messages = $state([]);  // [{ role: 'user'|'assistant', content }]
  let input = $state('');
  let sending = $state(false);
  let usage = $state({ used: 0, limit: 25, warn: false });
  let sessionId = $state(crypto.randomUUID());
  let chatEl;

  onMount(async () => {
    try {
      const r = await api('/api/support-chat/usage');
      usage = r.usage || usage;
    } catch { /* not signed in or offline */ }
    pushAssistant(
      "Hi! I'm productivity.do's assistant. Ask me anything about features, " +
      "billing, integrations, or troubleshooting. I'll escalate to a human " +
      "for billing or account questions."
    );
  });

  function pushUser(text) {
    messages = [...messages, { role: 'user', content: text }];
  }
  function pushAssistant(text, opts = {}) {
    messages = [...messages, { role: 'assistant', content: text, ...opts }];
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    if (usage.used >= usage.limit) return;

    pushUser(text);
    input = '';
    sending = true;
    await scrollToBottom();

    // Send the last 6 turns as history so the model has context.
    const history = messages.slice(-7, -1).map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await api('/api/support-chat', {
        method: 'POST',
        body: JSON.stringify({ message: text, sessionId, history }),
      });
      pushAssistant(res.reply, { escalated: res.escalated });
      usage = res.usage || usage;
    } catch (err) {
      // Server may have returned the daily-limit error; api() throws on non-2xx.
      const msg = err?.body?.message || err?.message || 'Something went wrong.';
      pushAssistant(msg, { error: true });
      // Re-fetch usage in case the limit was hit
      try { const r = await api('/api/support-chat/usage'); usage = r.usage; } catch {}
    } finally {
      sending = false;
      await scrollToBottom();
    }
  }

  async function escalate() {
    const ok = await confirmAction({
      title: 'Talk to a human?',
      body: `We'll forward this conversation to support@productivity.do and reply by email within 1 business day.`,
      confirmLabel: 'Send to support',
    });
    if (!ok) return;
    try {
      await api('/api/support-chat/escalate', {
        method: 'POST',
        body: JSON.stringify({ sessionId, note: '(user clicked talk to a human)' }),
      });
      pushAssistant('Forwarded to support@productivity.do. You\'ll hear back by email within 1 business day.', { meta: true });
    } catch (err) {
      pushAssistant(`Couldn't forward to support — please email support@productivity.do directly.`, { error: true });
    }
  }

  async function scrollToBottom() {
    await tick();
    if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const remaining = $derived(Math.max(0, usage.limit - usage.used));
  const limitReached = $derived(usage.used >= usage.limit);
</script>

<div class="support-chat">
  <div class="header">
    <p class="help-text">
      Ask anything about productivity.do. Powered by Claude, grounded in our help docs.
      For billing, refunds, or account changes, I'll route you to a human.
    </p>
    <div class="links">
      <a href="/help" target="_blank" rel="noopener">Browse help center →</a>
      <a href="mailto:support@productivity.do">Email support →</a>
    </div>
  </div>

  <div class="chat-window" bind:this={chatEl} role="log" aria-live="polite">
    {#each messages as m, i (i)}
      <div class="bubble {m.role}" class:error={m.error} class:meta={m.meta}>
        <div class="bubble-body">{m.content}</div>
        {#if m.escalated}
          <div class="escalated-pill">Forwarded to support team</div>
        {/if}
      </div>
    {/each}
    {#if sending}
      <div class="bubble assistant typing">
        <span></span><span></span><span></span>
      </div>
    {/if}
  </div>

  {#if usage.warn && !limitReached}
    <div class="usage-warn">
      You've used {usage.used} of {usage.limit} AI assistant messages today.
      {remaining} left before the assistant pauses until tomorrow. Browse
      <a href="/help" target="_blank">/help</a> or
      <a href="mailto:support@productivity.do">email support</a> if you need
      more help today.
    </div>
  {/if}

  {#if limitReached}
    <div class="usage-blocked">
      You've hit today's limit of {usage.limit} AI messages. The assistant
      resumes tomorrow. Meanwhile, the
      <a href="/help" target="_blank">help center</a> has detailed answers,
      or email <a href="mailto:support@productivity.do">support@productivity.do</a>
      and we'll respond by tomorrow.
    </div>
  {/if}

  <div class="input-row">
    <textarea
      bind:value={input}
      onkeydown={onKey}
      placeholder={limitReached ? 'Daily limit reached — see options above' : 'Type your question…'}
      rows="2"
      disabled={limitReached || sending}
    ></textarea>
    <div class="actions">
      <button class="btn primary" onclick={send} disabled={!input.trim() || limitReached || sending}>
        {sending ? 'Sending…' : 'Send'}
      </button>
      <button class="btn-link" onclick={escalate} disabled={messages.length < 2}>
        Talk to a human
      </button>
    </div>
  </div>
</div>

<style>
  .support-chat { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 500px; }
  .header { display: flex; flex-direction: column; gap: 6px; }
  .help-text { font-size: 13px; color: var(--text-secondary); margin: 0; line-height: 1.5; }
  .links { display: flex; gap: 16px; font-size: 12px; }
  .links a { color: var(--accent); text-decoration: none; }
  .links a:hover { text-decoration: underline; }

  .chat-window {
    flex: 1;
    min-height: 280px;
    max-height: 540px;
    overflow-y: auto;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .bubble {
    max-width: 85%;
    padding: 10px 14px;
    border-radius: 14px;
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .bubble.user {
    align-self: flex-end;
    background: var(--accent);
    color: white;
    border-bottom-right-radius: 4px;
  }
  .bubble.assistant {
    align-self: flex-start;
    background: var(--surface);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-bottom-left-radius: 4px;
  }
  .bubble.error { border-color: var(--error); color: var(--error); }
  .bubble.meta { background: var(--accent-light); color: var(--accent); border-color: transparent; }

  .escalated-pill {
    margin-top: 6px;
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 999px;
    background: color-mix(in srgb, #f59e0b 12%, transparent);
    color: #b45309;
    border: 1px solid color-mix(in srgb, #f59e0b 28%, transparent);
  }

  .bubble.typing { display: inline-flex; gap: 4px; padding: 14px 16px; }
  .bubble.typing span {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--text-tertiary);
    animation: bounce 1.4s ease-in-out infinite;
  }
  .bubble.typing span:nth-child(2) { animation-delay: 0.2s; }
  .bubble.typing span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce {
    0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
    40% { opacity: 1; transform: translateY(-4px); }
  }

  .usage-warn, .usage-blocked {
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    line-height: 1.5;
  }
  .usage-warn {
    background: color-mix(in srgb, #f59e0b 10%, transparent);
    border: 1px solid color-mix(in srgb, #f59e0b 28%, transparent);
    color: #92400e;
  }
  :global(html.dark) .usage-warn { color: #fbbf24; }
  .usage-blocked {
    background: color-mix(in srgb, var(--text-tertiary) 10%, transparent);
    border: 1px solid var(--border);
    color: var(--text-secondary);
  }
  .usage-warn a, .usage-blocked a { color: var(--accent); }

  .input-row { display: flex; flex-direction: column; gap: 6px; }
  .input-row textarea {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 13px;
    resize: vertical;
    font-family: inherit;
  }
  .input-row textarea:disabled { opacity: 0.6; }
  .actions { display: flex; gap: 12px; align-items: center; }

  .btn {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-primary);
    font-size: 13px;
    cursor: pointer;
  }
  .btn.primary { background: var(--accent); color: white; border-color: var(--accent); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-link {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 12px;
    padding: 0;
    text-decoration: underline;
  }
  .btn-link:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
