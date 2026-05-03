<script>
  import { createNote, updateNote, deleteNote } from '../stores/notes.svelte.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';
  import RevisionHistoryPanel from './RevisionHistoryPanel.svelte';
  import NoteCommentsPanel from './NoteCommentsPanel.svelte';
  import NoteContextPanel from './NoteContextPanel.svelte';
  import FilePicker from './FilePicker.svelte';
  import { tooltip } from '../actions/tooltip.js';
  import { renderMarkdown, SLASH_COMMANDS, applySlash, tryMarkdownShortcut } from '../utils/markdown.js';

  let { note, onclose = () => {} } = $props();

  let title = $state(note?.title || '');
  let body = $state(note?.body || '');
  let pinned = $state(!!note?.pinned);
  let color = $state(note?.color || null);
  let historyOpen = $state(false);
  let commentsOpen = $state(false);
  // Live Context Panel — Notes pillar's "stake". Default-on for notes that
  // are likely to have linked items (existing notes), default-off for brand
  // new ones to keep the empty state clean.
  let contextOpen = $state(!!note?.id);
  function onRestored(r) {
    // Restored note comes back in the response; sync local state so the
    // editor reflects the restored content immediately.
    if (r?.note) {
      title = r.note.title || '';
      body = r.note.body || '';
      pinned = !!r.note.pinned;
      color = r.note.color || null;
    }
  }
  let colorOpen = $state(false);
  // The 12 named scheme slots — picking one of these routes through the
  // active color scheme via var(--color-{slot}). Plus null = no color.
  const COLOR_SLOTS = ['sky','lavender','rose','peach','mint','sage','butter','coral','lilac','cloud','powder','blush'];
  let saving = $state(false);
  let lastSaved = $state(null);
  let dirty = $state(false);
  let mode = $state('edit'); // 'edit' | 'preview' | 'split'
  let textareaEl;

  // Slash command menu state
  let slashOpen = $state(false);
  let slashFilter = $state('');
  let slashIndex = $state(0);
  const filteredCommands = $derived(
    SLASH_COMMANDS.filter(c =>
      !slashFilter || c.label.toLowerCase().includes(slashFilter.toLowerCase()) ||
      c.id.toLowerCase().includes(slashFilter.toLowerCase())
    )
  );

  // Auto-save 800ms after the user stops typing.
  let saveTimer = null;
  $effect(() => {
    title; body; pinned; color; // track
    if (!dirty) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { save(); }, 800);
    return () => clearTimeout(saveTimer);
  });

  function markDirty() { dirty = true; }

  async function save() {
    saving = true;
    try {
      if (note?.id) {
        await updateNote(note.id, { title, body, pinned, color });
      } else {
        const created = await createNote({ title, body, pinned, color });
        if (created) note = created;
      }
      dirty = false;
      lastSaved = new Date();
    } finally {
      saving = false;
    }
  }

  async function handleDelete() {
    if (!note?.id) { onclose(); return; }
    const prefs = getPrefs();
    if (prefs.values.confirmDeleteNote !== false) {
      const ok = await confirmAction({
        title: 'Delete note?',
        body: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
    }
    await deleteNote(note.id);
    onclose();
  }

  function handleKey(e) {
    if (e.key === 'Escape') {
      if (slashOpen) { slashOpen = false; e.preventDefault(); return; }
      onclose();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
    // Cmd/Ctrl+E toggles edit/preview
    if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
      e.preventDefault();
      mode = mode === 'edit' ? 'preview' : 'edit';
    }
  }

  // ----- Slash menu navigation while it's open ------------------------
  function onTextareaKeydown(e) {
    if (slashOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); slashIndex = (slashIndex + 1) % filteredCommands.length; return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); slashIndex = (slashIndex - 1 + filteredCommands.length) % filteredCommands.length; return; }
      if (e.key === 'Enter')     { e.preventDefault(); pickSlash(filteredCommands[slashIndex]); return; }
      if (e.key === 'Escape')    { e.preventDefault(); slashOpen = false; return; }
    }
    // Tab inside a table cell: jump to next pipe (basic table nav).
    // Implementation: if cursor is on a line containing pipes, advance to
    // the next `|` and place the cursor right after it.
    if (e.key === 'Tab' && textareaEl) {
      const v = textareaEl.value;
      const c = textareaEl.selectionStart;
      const lineEnd = v.indexOf('\n', c);
      const line = v.slice(v.lastIndexOf('\n', c - 1) + 1, lineEnd < 0 ? v.length : lineEnd);
      if (line.includes('|')) {
        e.preventDefault();
        const nextPipe = v.indexOf('|', c);
        if (nextPipe >= 0) {
          textareaEl.selectionStart = textareaEl.selectionEnd = nextPipe + 2;
        }
      }
    }
  }

  // Run markdown auto-formats on input (after the keystroke is in the value).
  function onTextareaInput(e) {
    markDirty();
    if (!textareaEl) return;
    const justTyped = e.data; // null on backspace, ' ', '\n', etc.

    // Detect slash trigger: just typed '/', and prev char is start-of-line or whitespace.
    if (justTyped === '/') {
      const c = textareaEl.selectionStart;
      const prev = c >= 2 ? body[c - 2] : '\n';
      if (!prev || prev === '\n' || prev === ' ') {
        slashOpen = true;
        slashFilter = '';
        slashIndex = 0;
        return;
      }
    }

    // While slash menu is open, track filter text after the '/'.
    if (slashOpen && textareaEl) {
      const c = textareaEl.selectionStart;
      const slashPos = body.lastIndexOf('/', c - 1);
      if (slashPos < 0 || /\s/.test(body.slice(slashPos + 1, c))) {
        slashOpen = false;
      } else {
        slashFilter = body.slice(slashPos + 1, c);
        slashIndex = 0;
      }
    }

    // Apply markdown shortcuts (bullet continuation, checkbox, hr, etc.)
    if (justTyped === ' ' || justTyped === '\n' || e.inputType === 'insertLineBreak') {
      const c = textareaEl.selectionStart;
      const trigger = e.inputType === 'insertLineBreak' ? '\n' : justTyped;
      const result = tryMarkdownShortcut(body, c, trigger);
      if (result) {
        body = result.value;
        // Restore cursor after Svelte updates the value next tick.
        queueMicrotask(() => {
          if (textareaEl) {
            textareaEl.selectionStart = textareaEl.selectionEnd = result.cursor;
          }
        });
      }
    }
  }

  function pickSlash(cmd) {
    if (!cmd || !textareaEl) return;
    const c = textareaEl.selectionStart;
    const result = applySlash(body, c, cmd);
    body = result.value;
    slashOpen = false;
    slashFilter = '';
    queueMicrotask(() => {
      if (textareaEl) {
        textareaEl.selectionStart = textareaEl.selectionEnd = result.cursor;
        textareaEl.focus();
      }
    });
  }

  const renderedHtml = $derived(renderMarkdown(body));
</script>

<svelte:window onkeydown={handleKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onclose}>
  <div class="note-modal" class:has-context={contextOpen && note?.id} onclick={(e) => e.stopPropagation()}>
    <div class="note-header">
      <input
        class="note-title"
        bind:value={title}
        oninput={markDirty}
        placeholder="Title"
        autofocus
      />
      <div class="header-actions">
        <div class="mode-toggle" role="tablist" aria-label="View mode">
          <button class:active={mode === 'edit'} onclick={() => mode = 'edit'} use:tooltip={'Edit (Cmd+E to toggle)'} role="tab">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class:active={mode === 'split'} onclick={() => mode = 'split'} use:tooltip={'Split view'} role="tab">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
          </button>
          <button class:active={mode === 'preview'} onclick={() => mode = 'preview'} use:tooltip={'Preview'} role="tab">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
        <button
          class="icon-btn"
          class:active={pinned}
          onclick={() => { pinned = !pinned; markDirty(); }}
          use:tooltip={pinned ? 'Unpin' : 'Pin to top'}
          aria-label={pinned ? 'Unpin' : 'Pin'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
        </button>
        <!-- Color picker. The current swatch is the trigger; a popover with
             all 12 slots + "no color" shows on click. Slots route through
             the active scheme via var(--color-{slot}), so the same note
             retints when the scheme changes. -->
        <div class="color-pick">
          <button
            class="icon-btn color-trigger"
            onclick={() => colorOpen = !colorOpen}
            use:tooltip={'Color'}
            aria-label="Color"
          >
            <span class="color-trigger-dot" style="background: {color ? `var(--color-${color}, ${color})` : 'transparent'}; border-color: {color ? 'transparent' : 'var(--border)'};"></span>
          </button>
          {#if colorOpen}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="color-pop" onclick={(e) => e.stopPropagation()}>
              <button class="swatch swatch-clear" class:active={!color} onclick={() => { color = null; markDirty(); colorOpen = false; }} use:tooltip={'No color'}>×</button>
              {#each COLOR_SLOTS as slot}
                <button class="swatch" class:active={color === slot}
                  style="background: var(--color-{slot});"
                  onclick={() => { color = slot; markDirty(); colorOpen = false; }}
                  use:tooltip={slot}
                  aria-label={slot}
                ></button>
              {/each}
            </div>
          {/if}
        </div>
        {#if note?.id}
          <button class="icon-btn" class:active={contextOpen} onclick={() => contextOpen = !contextOpen} use:tooltip={contextOpen ? 'Hide context' : 'Show context'} aria-label="Toggle context panel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          </button>
          <button class="icon-btn" onclick={() => commentsOpen = true} use:tooltip={'Comments'} aria-label="Comments">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </button>
          <button class="icon-btn" onclick={() => historyOpen = true} use:tooltip={'Version history'} aria-label="Version history">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
          </button>
        {/if}
        <button class="icon-btn" onclick={handleDelete} use:tooltip={'Delete'} aria-label="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
        <button class="icon-btn" onclick={onclose} use:tooltip={'Close'} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <div class="note-body" class:split={mode === 'split'}>
      {#if mode === 'edit' || mode === 'split'}
        <div class="edit-pane">
          <textarea
            bind:value={body}
            bind:this={textareaEl}
            oninput={onTextareaInput}
            onkeydown={onTextareaKeydown}
            placeholder="Start writing… markdown supported. Type / for commands."
            spellcheck="true"
          ></textarea>
          {#if slashOpen}
            <!-- Anchored slash menu. Position is approximate (just below the
                 textarea content area) — fine for a non-precision picker. -->
            <div class="slash-menu" role="listbox">
              {#each filteredCommands as cmd, i}
                <button
                  class="slash-item"
                  class:highlighted={i === slashIndex}
                  onmouseenter={() => slashIndex = i}
                  onclick={() => pickSlash(cmd)}
                  type="button"
                  role="option"
                  aria-selected={i === slashIndex}
                >
                  <span class="slash-label">{cmd.label}</span>
                  <span class="slash-desc">{cmd.desc}</span>
                </button>
              {/each}
              {#if filteredCommands.length === 0}
                <div class="slash-empty">No matches.</div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
      {#if mode === 'preview' || mode === 'split'}
        <div class="preview-pane markdown-body">
          {#if body.trim()}
            {@html renderedHtml}
          {:else}
            <div class="preview-empty">Nothing to preview yet.</div>
          {/if}
        </div>
      {/if}
    </div>

    {#if note?.id}
      <div class="note-files">
        <FilePicker sourceType="note" sourceId={String(note.id)} />
      </div>
    {/if}

    <div class="note-footer">
      <span class="note-status">
        {#if saving}Saving…{:else if lastSaved}Saved{:else}&nbsp;{/if}
      </span>
      <span class="note-hint">/ slash commands · Cmd+E toggle preview · Cmd+S save</span>
    </div>
    {#if historyOpen && note?.id}
      <RevisionHistoryPanel
        resource="notes"
        id={note.id}
        onrestored={onRestored}
        onclose={() => historyOpen = false}
      />
    {/if}
    {#if commentsOpen && note?.id}
      <NoteCommentsPanel
        noteId={note.id}
        onclose={() => commentsOpen = false}
      />
    {/if}
    {#if contextOpen && note?.id}
      <NoteContextPanel
        noteId={note.id}
        onclose={() => contextOpen = false}
      />
    {/if}
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop, rgba(0,0,0,0.4));
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 16px;
  }
  .note-modal {
    position: relative; /* anchor for the version-history overlay */
    background: var(--surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    width: 880px;
    max-width: 100%;
    height: 82vh;
    max-height: 820px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: width 220ms cubic-bezier(.2,.7,.2,1);
  }
  .note-modal.has-context {
    width: 1160px;
    padding-right: 280px;
  }
  @media (max-width: 880px) {
    .note-modal.has-context {
      width: 880px;
      padding-right: 0;
    }
  }
  .note-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-light);
  }
  .note-title {
    flex: 1;
    border: none;
    background: transparent;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    outline: none;
  }
  .header-actions {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .mode-toggle {
    display: inline-flex;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 2px;
    margin-right: 4px;
  }
  .mode-toggle button {
    width: 28px; height: 24px;
    border: none;
    background: transparent;
    border-radius: 999px;
    color: var(--text-tertiary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .mode-toggle button:hover:not(.active) { color: var(--text-primary); }
  .mode-toggle button.active {
    background: var(--surface);
    color: var(--text-primary);
    box-shadow: 0 1px 2px rgba(0,0,0,0.06);
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
  }
  .icon-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
  .icon-btn.active { color: var(--accent); }

  .color-pick { position: relative; }
  .color-trigger-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid;
    box-sizing: border-box;
    display: inline-block;
  }
  .color-pop {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 50;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    padding: 6px;
    display: grid;
    grid-template-columns: repeat(7, 18px);
    gap: 4px;
  }
  .swatch {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid transparent;
    padding: 0;
    cursor: pointer;
    transition: transform 0.06s;
  }
  .swatch:hover { transform: scale(1.15); }
  .swatch.active {
    border-color: var(--text-primary);
    transform: scale(1.15);
  }
  .swatch-clear {
    background: var(--surface);
    border: 1.5px dashed var(--border);
    color: var(--text-tertiary);
    font-size: 11px;
    line-height: 14px;
  }
  .swatch-clear.active { border-color: var(--text-primary); }

  .note-body {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }
  .note-body.split .edit-pane,
  .note-body.split .preview-pane {
    flex: 1;
  }
  .note-body.split .edit-pane {
    border-right: 1px solid var(--border-light);
  }
  .edit-pane, .preview-pane {
    flex: 1;
    overflow: auto;
    position: relative;
  }
  .edit-pane textarea {
    width: 100%;
    height: 100%;
    border: none;
    background: transparent;
    padding: 20px 24px;
    font-size: 14px;
    line-height: 1.65;
    color: var(--text-primary);
    resize: none;
    outline: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    box-sizing: border-box;
  }
  .preview-pane {
    padding: 20px 28px;
    line-height: 1.65;
    font-size: 14px;
    color: var(--text-primary);
  }
  .preview-empty {
    color: var(--text-tertiary);
    font-size: 13px;
    text-align: center;
    margin-top: 40px;
  }

  /* Slash menu */
  .slash-menu {
    position: absolute;
    bottom: 16px;
    left: 24px;
    width: 280px;
    max-height: 280px;
    overflow-y: auto;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    padding: 4px;
    z-index: 10;
  }
  .slash-item {
    width: 100%;
    text-align: left;
    border: none;
    background: transparent;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    color: var(--text-primary);
  }
  .slash-item.highlighted { background: var(--accent-light); }
  .slash-label { font-size: 13px; font-weight: 500; }
  .slash-desc {
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: ui-monospace, monospace;
  }
  .slash-empty {
    padding: 8px;
    font-size: 12px;
    color: var(--text-tertiary);
    text-align: center;
  }

  .note-files {
    padding: 8px 16px 0;
  }

  .note-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 16px;
    font-size: 12px;
    color: var(--text-tertiary);
    border-top: 1px solid var(--border-light);
  }

  /* Markdown preview styles — sober, readable typography. Mirrors GitHub's
     defaults but lighter weight. Highlight.js theme inlined for code blocks. */
  .markdown-body :global(h1) { font-size: 22px; font-weight: 700; margin: 16px 0 12px; letter-spacing: -0.02em; }
  .markdown-body :global(h2) { font-size: 18px; font-weight: 600; margin: 16px 0 10px; }
  .markdown-body :global(h3) { font-size: 16px; font-weight: 600; margin: 14px 0 8px; }
  .markdown-body :global(h4) { font-size: 14px; font-weight: 600; margin: 12px 0 6px; }
  .markdown-body :global(p)  { margin: 0 0 12px; }
  .markdown-body :global(ul), .markdown-body :global(ol) { margin: 0 0 12px; padding-left: 24px; }
  .markdown-body :global(li) { margin-bottom: 4px; }
  .markdown-body :global(li > input[type="checkbox"]) { margin-right: 6px; }
  .markdown-body :global(blockquote) {
    border-left: 3px solid var(--border);
    padding: 0 0 0 12px;
    color: var(--text-secondary);
    margin: 12px 0;
  }
  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 18px 0;
  }
  .markdown-body :global(code) {
    background: var(--surface-hover);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .markdown-body :global(pre) {
    background: var(--bg-secondary);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    overflow-x: auto;
    margin: 12px 0;
  }
  .markdown-body :global(pre code) {
    background: transparent;
    padding: 0;
    font-size: 12px;
    line-height: 1.5;
  }
  .markdown-body :global(table) {
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 13px;
  }
  .markdown-body :global(th), .markdown-body :global(td) {
    border: 1px solid var(--border);
    padding: 6px 10px;
    text-align: left;
  }
  .markdown-body :global(th) {
    background: var(--surface-hover);
    font-weight: 600;
  }
  .markdown-body :global(a) {
    color: var(--accent);
    text-decoration: none;
  }
  .markdown-body :global(a:hover) { text-decoration: underline; }
  .markdown-body :global(strong) { font-weight: 600; }

  /* Highlight.js minimal theme for code blocks. Light + dark via prefers. */
  .markdown-body :global(.hljs-keyword),
  .markdown-body :global(.hljs-selector-tag) { color: #a626a4; }
  .markdown-body :global(.hljs-string),
  .markdown-body :global(.hljs-title) { color: #50a14f; }
  .markdown-body :global(.hljs-number),
  .markdown-body :global(.hljs-built_in) { color: #986801; }
  .markdown-body :global(.hljs-comment) { color: #a0a1a7; font-style: italic; }
  .markdown-body :global(.hljs-attr),
  .markdown-body :global(.hljs-attribute) { color: #4078f2; }
  :global(html.dark) .markdown-body :global(.hljs-keyword) { color: #c678dd; }
  :global(html.dark) .markdown-body :global(.hljs-string) { color: #98c379; }
  :global(html.dark) .markdown-body :global(.hljs-number) { color: #d19a66; }
  :global(html.dark) .markdown-body :global(.hljs-comment) { color: #5c6370; }
  :global(html.dark) .markdown-body :global(.hljs-attr) { color: #61afef; }
</style>
