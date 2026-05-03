<!--
  FounderThoughtsWidget — bottom-right floating composer for the founder's
  in-the-moment thoughts. Founder-gated server-side; mounted only when
  /api/founder-thoughts/whoami returns founder=true.

  Use case: "I'm scrolling through the app, notice something to fix,
  capture it without leaving context. Claude Code processes the inbox
  overnight and acts on the queue."

  Captures by default: URL, path, app-tab, calendar view + date, theme,
  viewport, online state, user agent. Drag-drop, paste, and click-to-pick
  attach images (screenshots).

  Submit: Cmd/Ctrl+Enter. Esc closes. Click backdrop closes.
-->
<script>
  import { onMount } from 'svelte';
  import { api } from '../api.js';
  import { showToast } from '../utils/toast.svelte.js';
  import { getAppView } from '../stores/appView.svelte.js';
  import { getView } from '../stores/view.svelte.js';
  import { getRoute } from '../stores/routeStore.svelte.js';
  import { getPrefs } from '../stores/prefs.svelte.js';

  // --- Founder gate ----------------------------------------------------
  let isFounder = $state(false);
  let gateChecked = $state(false);

  onMount(async () => {
    try {
      const r = await api('/api/founder-thoughts/whoami');
      isFounder = !!r?.founder;
    } catch {}
    gateChecked = true;
  });

  // --- Stores ----------------------------------------------------------
  const appView = getAppView();
  const calendarView = getView();
  const route = getRoute();
  const prefs = getPrefs();

  // --- Composer state --------------------------------------------------
  let open = $state(false);
  let thought = $state('');
  let attachments = $state([]); // { id, file, name, previewUrl, mime, size }
  let sending = $state(false);
  let dragging = $state(false);
  let textareaEl;
  let inputEl;
  let nextAttId = 0;

  function openComposer() {
    open = true;
    queueMicrotask(() => textareaEl?.focus());
  }

  function closeComposer() {
    if (sending) return;
    open = false;
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeComposer();
    }
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
      if (!isImage(f)) continue; // text-only otherwise
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
      // Notes route: /notes/:id
      if (route?.isNote && route?.noteId) {
        return { kind: 'note', id: String(route.noteId) };
      }
      // Integrations: /integrations or /integrations/:provider
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
        // JSON path — lighter, no multipart parsing.
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
      // Success — clear and close. Toast confirms.
      for (const a of attachments) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
      thought = '';
      attachments = [];
      open = false;
      showToast({ message: 'Thought saved', kind: 'info', duration: 2000 });
    } catch (err) {
      showToast({ message: 'Could not save thought', kind: 'error' });
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
      title="Capture thought (founder inbox)"
      aria-label="Capture thought"
      onclick={openComposer}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </button>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="ft-backdrop" onclick={closeComposer}></div>
    <div
      class="ft-composer"
      class:dragging
      role="dialog"
      aria-label="Capture thought"
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      ondrop={onDrop}
    >
      <div class="ft-head">
        <span class="ft-title">Founder inbox</span>
        <span class="ft-hint">⌘↵ to save · Esc to close</span>
      </div>

      <textarea
        bind:this={textareaEl}
        bind:value={thought}
        placeholder="What's on your mind? Drop screenshots here, paste, or click 📎"
        rows="4"
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
                onclick={() => removeAttachment(a.id)}
                disabled={sending}
              >×</button>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="ft-actions">
        <button
          type="button"
          class="ft-attach-btn"
          onclick={onPickClick}
          disabled={sending || attachments.length >= 5}
          title="Attach image (max 5)"
        >📎 Attach</button>
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
          class="ft-cancel"
          onclick={closeComposer}
          disabled={sending}
        >Cancel</button>
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
    box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15));
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

  .ft-backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 1899;
  }
  .ft-composer {
    position: fixed;
    bottom: 18px;
    right: 18px;
    z-index: 1901;
    width: min(440px, calc(100vw - 36px));
    background: var(--surface-elevated, var(--surface));
    border: 1px solid var(--border);
    border-radius: var(--radius-lg, 12px);
    box-shadow: var(--shadow-lg, 0 12px 32px rgba(0,0,0,0.25));
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

  .ft-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .ft-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
  }
  .ft-hint {
    font-size: 11px;
    color: var(--text-tertiary, var(--text-secondary));
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 6px);
    background: var(--surface);
    color: var(--text-primary);
    padding: 10px 12px;
    font: inherit;
    font-size: 13.5px;
    line-height: 1.5;
    resize: vertical;
    min-height: 80px;
    max-height: 320px;
  }
  textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    border-color: var(--accent);
  }

  .ft-attachments {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 180px;
    overflow-y: auto;
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
    font-size: 14px;
    line-height: 1;
  }
  .ft-att-remove:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .ft-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ft-spacer { flex: 1; }
  .ft-attach-btn,
  .ft-cancel,
  .ft-save {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-primary);
    padding: 6px 12px;
    border-radius: var(--radius-sm, 6px);
    font-size: 13px;
    cursor: pointer;
  }
  .ft-attach-btn:disabled,
  .ft-cancel:disabled,
  .ft-save:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .ft-attach-btn:hover:not(:disabled),
  .ft-cancel:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .ft-save {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
    font-weight: 500;
  }
  .ft-save:hover:not(:disabled) {
    filter: brightness(1.05);
  }
</style>
