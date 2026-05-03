<!--
  FounderThoughtsWidget — bottom-right "Provide feedback" composer for
  the site owner. Founder-gated server-side; mounted only when
  /api/founder-thoughts/whoami returns founder=true.

  UX choices (notes for future-us):
    - Sticky: open-state persists in localStorage. Closes only on X
      button click — Esc/click-outside don't dismiss because the user is
      often holding partial context while clicking around the app to
      illustrate something.
    - No backdrop scrim; the calendar/tasks/notes view stays fully usable
      and visible while the panel is open.
    - Tall by default (480px desktop, 60vh mobile) so a paragraph of
      thoughts + a screenshot or two fit without scrolling.
    - Draft persistence: typed text + remembered-attachment NAMES (we
      can't persist File handles across reloads) survive a close-without-
      save. Clearing happens only after a successful submit.
    - Borderless textarea — the panel itself is the container; an inner
      border would feel like a form field.
    - No keyboard-shortcut hints in chrome. ⌘↵ still works; the user
      already knows.

  Backend route is named "founder-thoughts" for grep-ability; the widget
  is a thin client.
-->
<script>
  import { onMount } from 'svelte';
  import { api } from '../api.js';
  import { showToast } from '../utils/toast.svelte.js';
  import { getAppView } from '../stores/appView.svelte.js';
  import { getView } from '../stores/view.svelte.js';
  import { getRoute } from '../stores/routeStore.svelte.js';

  // --- Founder gate ----------------------------------------------------
  let isFounder = $state(false);
  let gateChecked = $state(false);

  onMount(async () => {
    try {
      const r = await api('/api/founder-thoughts/whoami');
      isFounder = !!r?.founder;
    } catch {}
    gateChecked = true;
    // Restore sticky open-state + draft only after gate passes.
    if (isFounder) {
      try {
        if (localStorage.getItem(OPEN_KEY) === '1') open = true;
        const savedDraft = localStorage.getItem(DRAFT_KEY) || '';
        if (savedDraft) thought = savedDraft;
      } catch {}
      // First-time-open auto-focus is handled by the $effect below.
    }
  });

  // --- Stores ----------------------------------------------------------
  const appView = getAppView();
  const calendarView = getView();
  const route = getRoute();

  // --- Storage keys ----------------------------------------------------
  const OPEN_KEY  = 'productivity_feedback_open';
  const DRAFT_KEY = 'productivity_feedback_draft';

  // --- Composer state --------------------------------------------------
  let open = $state(false);
  let thought = $state('');
  let attachments = $state([]); // { id, file, name, previewUrl, mime, size }
  let sending = $state(false);
  let dragging = $state(false);
  let textareaEl;
  let inputEl;
  let nextAttId = 0;

  // Persist draft text on every change so closing-without-save doesn't
  // lose work. Cleared only on successful submit.
  $effect(() => {
    if (!gateChecked || !isFounder) return;
    try {
      if (thought) localStorage.setItem(DRAFT_KEY, thought);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {}
  });

  // Persist open-state. Sticky: only X click flips this to closed.
  function persistOpen(next) {
    try { localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch {}
  }

  function openComposer() {
    open = true;
    persistOpen(true);
    // Focus the textarea on first open of this session — caret-at-end so
    // a saved draft is editable immediately, not selected.
    queueMicrotask(() => {
      if (!textareaEl) return;
      textareaEl.focus();
      const len = textareaEl.value.length;
      try { textareaEl.setSelectionRange(len, len); } catch {}
    });
  }

  function closeComposer() {
    if (sending) return;
    open = false;
    persistOpen(false);
  }

  function onKey(e) {
    if (!open) return;
    // Cmd/Ctrl+Enter still saves — we just don't advertise it in chrome.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  // --- Attachments -----------------------------------------------------
  function isImage(file) {
    return typeof file?.type === 'string' && file.type.startsWith('image/');
  }

  function addFiles(fileList) {
    if (!fileList) return;
    const list = Array.from(fileList).filter(Boolean);
    for (const f of list) {
      if (!isImage(f)) continue;
      if (attachments.length >= 5) break;
      const id = ++nextAttId;
      const previewUrl = URL.createObjectURL(f);
      attachments = [...attachments, {
        id,
        file: f,
        name: f.name || `paste-${id}`,
        previewUrl,
        mime: f.type,
        size: f.size,
      }];
    }
  }

  function removeAttachment(id) {
    const target = attachments.find(a => a.id === id);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    attachments = attachments.filter(a => a.id !== id);
  }

  function onPickClick() { inputEl?.click(); }
  function onPicked(e) {
    addFiles(e.target?.files);
    if (inputEl) inputEl.value = '';
  }

  // Drag/drop on the composer.
  function onDragOver(e) {
    if (!open) return;
    e.preventDefault();
    dragging = true;
  }
  function onDragLeave() { dragging = false; }
  function onDrop(e) {
    e.preventDefault();
    dragging = false;
    addFiles(e.dataTransfer?.files);
  }

  // Paste-from-clipboard (only when composer is open).
  function onPaste(e) {
    if (!open) return;
    const items = Array.from(e.clipboardData?.items || []);
    const files = items
      .filter(i => i.kind === 'file')
      .map(i => i.getAsFile())
      .filter(Boolean);
    if (files.length) addFiles(files);
  }

  // --- Context capture -------------------------------------------------
  function captureContext() {
    const resource = (() => {
      if (route?.isNote && route?.noteId) {
        return { kind: 'note', id: String(route.noteId) };
      }
      if (route?.isIntegrations) {
        return { kind: 'integration', id: route.integrationProvider || 'index' };
      }
      return null;
    })();

    return {
      url:          location.href,
      path:         location.pathname,
      appView:      appView?.current || null,
      calendarView: calendarView?.currentView || null,
      date:         calendarView?.currentDate ? toYmd(calendarView.currentDate) : null,
      resource,
      viewport:     { w: window.innerWidth, h: window.innerHeight },
      online:       typeof navigator !== 'undefined' ? !!navigator.onLine : null,
      theme:        document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      userAgent:    navigator.userAgent,
    };
  }

  function toYmd(d) {
    if (!(d instanceof Date)) {
      try { d = new Date(d); } catch { return null; }
    }
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // --- Submit ----------------------------------------------------------
  async function submit() {
    if (sending) return;
    const t = thought.trim();
    if (!t) return;

    sending = true;
    const ctx = captureContext();

    let res;
    try {
      if (attachments.length === 0) {
        res = await fetch('/api/founder-thoughts', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ thought: t, context: ctx }),
        });
      } else {
        const fd = new FormData();
        fd.append('thought', t);
        fd.append('context', JSON.stringify(ctx));
        for (const a of attachments) fd.append('file', a.file, a.name);
        res = await fetch('/api/founder-thoughts', {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        });
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        showToast({ message: json?.error || `Failed (${res.status})`, kind: 'error' });
        return;
      }
      // Success — clear draft and attachments, keep panel open. The user
      // is in a flow; they may want to drop another thought immediately.
      for (const a of attachments) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
      thought = '';
      attachments = [];
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      showToast({ message: 'Feedback saved', kind: 'info', duration: 2000 });
      queueMicrotask(() => textareaEl?.focus());
    } catch (err) {
      showToast({ message: 'Could not save feedback', kind: 'error' });
    } finally {
      sending = false;
    }
  }

  function fmtSize(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

<svelte:window onkeydown={onKey} onpaste={onPaste} />

{#if gateChecked && isFounder}
  {#if !open}
    <button
      class="ft-fab"
      type="button"
      title="Provide feedback"
      aria-label="Provide feedback"
      onclick={openComposer}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </button>
  {:else}
    <!-- No scrim. The panel sits over the page; the page stays interactive. -->
    <div
      class="ft-composer"
      class:dragging
      role="dialog"
      aria-label="Provide feedback"
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      ondrop={onDrop}
    >
      <div class="ft-head">
        <span class="ft-title">Feedback</span>
        <button
          class="ft-close"
          type="button"
          aria-label="Close"
          title="Close"
          onclick={closeComposer}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <textarea
        bind:this={textareaEl}
        bind:value={thought}
        placeholder="Add feedback..."
        spellcheck="true"
        disabled={sending}
      ></textarea>

      {#if attachments.length > 0}
        <ul class="ft-attachments">
          {#each attachments as a (a.id)}
            <li class="ft-att">
              <img src={a.previewUrl} alt="" class="ft-thumb" />
              <span class="ft-att-meta">
                <span class="ft-att-name" title={a.name}>{a.name}</span>
                <span class="ft-att-size">{fmtSize(a.size)}</span>
              </span>
              <button
                class="ft-att-remove"
                type="button"
                title="Remove"
                aria-label="Remove attachment"
                onclick={() => removeAttachment(a.id)}
                disabled={sending}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="ft-actions">
        <button
          type="button"
          class="ft-icon-btn"
          aria-label="Attach image"
          title="Attach image"
          onclick={onPickClick}
          disabled={sending || attachments.length >= 5}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21.44 11.05L12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>
        <input
          type="file"
          accept="image/*"
          multiple
          bind:this={inputEl}
          onchange={onPicked}
          style="display: none"
        />
        <span class="ft-spacer"></span>
        <button
          type="button"
          class="ft-save"
          onclick={submit}
          disabled={sending || !thought.trim()}
        >{sending ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  {/if}
{/if}

<style>
  /* ---- FAB ---------------------------------------------------------- */
  .ft-fab {
    position: fixed;
    bottom: 18px;
    right: 18px;
    z-index: 1900;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--surface-elevated, var(--surface));
    color: var(--text-secondary);
    box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.15));
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 120ms, color 120ms, border-color 120ms;
  }
  .ft-fab:hover {
    transform: scale(1.05);
    color: var(--accent);
    border-color: var(--accent);
  }
  .ft-fab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* ---- Composer ----------------------------------------------------- */
  .ft-composer {
    position: fixed;
    bottom: 18px;
    right: 18px;
    z-index: 1901;
    width: min(440px, calc(100vw - 36px));
    height: min(520px, calc(100vh - 36px));
    background: var(--surface-elevated, var(--surface));
    border: 1px solid var(--border);
    border-radius: var(--radius-lg, 12px);
    box-shadow: var(--shadow-lg, 0 12px 32px rgba(0, 0, 0, 0.25));
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: border-color 120ms, background 120ms;
  }
  .ft-composer.dragging {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--surface-elevated, var(--surface)));
  }

  /* On narrow viewports, attach to the bottom edge but keep height
     reasonable. No full-screen takeover; the calendar still peeks. */
  @media (max-width: 640px) {
    .ft-composer {
      bottom: 12px;
      right: 12px;
      left: 12px;
      width: auto;
      height: min(60vh, 520px);
    }
  }

  .ft-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .ft-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
  }
  .ft-close {
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .ft-close:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .ft-close:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* Borderless textarea — the panel itself is the container. Filling the
     panel ensures the user sees a generous writing surface. */
  textarea {
    flex: 1;
    width: 100%;
    box-sizing: border-box;
    border: none;
    background: transparent;
    color: var(--text-primary);
    padding: 0;
    font: inherit;
    font-size: 14px;
    line-height: 1.55;
    resize: none;
    min-height: 0;
  }
  textarea::placeholder {
    color: var(--text-tertiary, var(--text-secondary));
    opacity: 0.7;
    font-weight: 400;
  }
  textarea:focus {
    outline: none;
  }
  textarea:disabled {
    opacity: 0.6;
  }

  /* ---- Attachments -------------------------------------------------- */
  .ft-attachments {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 180px;
    overflow-y: auto;
    flex-shrink: 0;
  }
  .ft-att {
    display: grid;
    grid-template-columns: 40px 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 4px 6px;
    border-radius: var(--radius-sm, 6px);
    background: var(--surface);
  }
  .ft-thumb {
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: 4px;
  }
  .ft-att-meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
  }
  .ft-att-name {
    font-size: 12px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ft-att-size {
    font-size: 11px;
    color: var(--text-tertiary, var(--text-secondary));
  }
  .ft-att-remove {
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .ft-att-remove:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  /* ---- Footer actions ---------------------------------------------- */
  .ft-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .ft-spacer { flex: 1; }
  .ft-icon-btn {
    width: 32px;
    height: 32px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-secondary);
    border-radius: var(--radius-sm, 6px);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .ft-icon-btn:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .ft-icon-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .ft-save {
    border: 1px solid var(--accent);
    background: var(--accent);
    color: white;
    padding: 6px 14px;
    border-radius: var(--radius-sm, 6px);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .ft-save:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .ft-save:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
