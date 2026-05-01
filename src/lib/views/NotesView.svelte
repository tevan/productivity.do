<script>
  // Holistic Notes view — full-screen list of notes with a reading pane on
  // the right. Scaffold: split layout, click a note to read/edit it inline.
  import { getContext, tick } from 'svelte';
  import { getNotes, updateNote } from '../stores/notes.svelte.js';
  import { getNotesView } from '../stores/notesView.svelte.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { renderMarkdown } from '../utils/markdown.js';
  import NotesSidebarSection from '../components/sidebar/NotesSidebarSection.svelte';

  const notesStore = getNotes();
  const notesView = getNotesView();
  const prefs = getPrefs();
  const app = getContext('app');

  // Mobile: when the app sidebar is hidden the user has no path to the
  // notes list, so render an inline list (until they pick one).
  let isMobile = $state(typeof window !== 'undefined' && window.innerWidth < 768);
  $effect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => { isMobile = window.innerWidth < 768; };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  // Selection lifted into notesView store so the sidebar's Notes section
  // can drive it (and reflect it) when in Notes appView.
  const notes = $derived(notesStore.items);
  const selected = $derived(notes.find(n => n.id === notesView.selectedId) || null);
  const selectedHtml = $derived(selected ? renderMarkdown(selected.body || '') : '');

  // Metadata derivations. Each cell is independently toggleable in Settings.
  // Word count strips markdown punctuation so "**bold**" counts as one word.
  // Reading time is words ÷ 200 (rough adult prose pace), rounded up to 1m
  // minimum so a short note doesn't read "0 min".
  const wordCount = $derived.by(() => {
    if (!selected?.body) return 0;
    const cleaned = selected.body.replace(/[#*_`>\-\[\]()!]/g, ' ');
    const words = cleaned.match(/\S+/g);
    return words ? words.length : 0;
  });
  const charCount = $derived(selected?.body?.length || 0);
  const readMinutes = $derived(wordCount > 0 ? Math.max(1, Math.round(wordCount / 200)) : 0);

  // Friendly relative time ("2h ago"); the absolute date is shown in tooltip
  // and on hover so the user can get exact when they need it.
  function relativeTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function absoluteTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  async function newNote() {
    app?.editNote?.();
  }

  // ---- Inline editing ----
  // Click body / title to swap rendered view for a textarea. Save on blur.
  // Escape exits without saving the in-flight buffer; the rendered view
  // stays in sync with the store, so re-entering re-derives from store.
  let editingBody = $state(false);
  let editingTitle = $state(false);
  let bodyBuffer = $state('');
  let titleBuffer = $state('');
  let bodyTextarea = $state(null);
  let titleInput = $state(null);

  // Reset buffers + edit mode whenever the selected note changes.
  $effect(() => {
    void notesView.selectedId;
    editingBody = false;
    editingTitle = false;
  });

  async function startEditBody() {
    if (!selected) return;
    bodyBuffer = selected.body || '';
    editingBody = true;
    await tick();
    bodyTextarea?.focus();
    // Auto-resize on first paint
    autoResize();
  }
  function autoResize() {
    if (!bodyTextarea) return;
    bodyTextarea.style.height = 'auto';
    bodyTextarea.style.height = bodyTextarea.scrollHeight + 'px';
  }
  async function saveBody() {
    if (!selected || !editingBody) return;
    const body = bodyBuffer;
    editingBody = false;
    if ((selected.body || '') !== body) {
      await updateNote(selected.id, { body });
    }
  }
  function cancelBody() {
    editingBody = false;
  }
  function bodyKey(e) {
    if (e.key === 'Escape') { cancelBody(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveBody(); }
  }

  async function startEditTitle() {
    if (!selected) return;
    titleBuffer = selected.title || '';
    editingTitle = true;
    await tick();
    titleInput?.focus();
    titleInput?.select();
  }
  async function saveTitle() {
    if (!selected || !editingTitle) return;
    const title = titleBuffer.trim();
    editingTitle = false;
    if ((selected.title || '') !== title) {
      await updateNote(selected.id, { title });
    }
  }
  function cancelTitle() { editingTitle = false; }
  function titleKey(e) {
    if (e.key === 'Escape') { cancelTitle(); }
    if (e.key === 'Enter') { e.preventDefault(); saveTitle(); }
  }
</script>

<div class="notes-view">
  <!-- Heading lives in the toolbar (top-left, where the date range sits in
       Calendar view) — keeps the page chrome consistent across views. -->

  {#if notes.length === 0}
    <div class="empty">
      <p>No notes yet.</p>
      <button class="btn-primary" onclick={newNote}>Create your first note</button>
    </div>
  {:else}
    <!-- The app sidebar's NotesSidebarSection is the canonical list — no
         second list inside the view. Full-width reader pane here. -->
    <main class="reader">
      {#if selected}
        <div class="reader-head">
          {#if editingTitle}
            <input
              bind:this={titleInput}
              class="title-input"
              bind:value={titleBuffer}
              onblur={saveTitle}
              onkeydown={titleKey}
              placeholder="Untitled"
            />
          {:else}
            <h2 onclick={startEditTitle} title="Click to edit">
              {#if selected.color}
                <span class="color-dot" style="background: var(--color-{selected.color}, {selected.color});" aria-hidden="true"></span>
              {/if}
              {selected.title || 'Untitled'}
            </h2>
          {/if}
          <button class="btn-ghost" onclick={() => app?.editNote?.(selected)} title="Color, pin, delete…">More</button>
        </div>
        {#if editingBody}
          <textarea
            bind:this={bodyTextarea}
            class="body-textarea"
            bind:value={bodyBuffer}
            oninput={autoResize}
            onblur={saveBody}
            onkeydown={bodyKey}
            placeholder="Write something… (markdown supported)"
          ></textarea>
        {:else if selected.body}
          <div
            class="reader-body markdown-body"
            onclick={startEditBody}
            onkeydown={(e) => e.key === 'Enter' && startEditBody()}
            role="textbox"
            tabindex="0"
            title="Click to edit"
          >{@html selectedHtml}</div>
        {:else}
          <div
            class="reader-body empty-body"
            onclick={startEditBody}
            onkeydown={(e) => e.key === 'Enter' && startEditBody()}
            role="textbox"
            tabindex="0"
          >Click to write something…</div>
        {/if}
        <!-- Footer: secondary metadata. Created / Updated stay accessible
             but de-emphasized; word/char/read-time only render when the
             user has explicitly enabled them in Settings. -->
        <footer class="reader-footer">
          {#if selected.updatedAt}
            <span class="footer-cell" title={absoluteTime(selected.updatedAt)}>Updated {relativeTime(selected.updatedAt)}</span>
          {/if}
          {#if selected.createdAt}
            <span class="footer-cell" title={absoluteTime(selected.createdAt)}>· Created {relativeTime(selected.createdAt)}</span>
          {/if}
          {#if prefs.values.notesShowWords && wordCount > 0}
            <span class="footer-cell">· {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}</span>
          {/if}
          {#if prefs.values.notesShowChars && charCount > 0}
            <span class="footer-cell">· {charCount.toLocaleString()} {charCount === 1 ? 'char' : 'chars'}</span>
          {/if}
          {#if prefs.values.notesShowReadTime && readMinutes > 0}
            <span class="footer-cell" title="At ~200 words/min">· {readMinutes} min read</span>
          {/if}
        </footer>
      {:else if isMobile}
        <!-- Mobile: app sidebar is hidden by default and the toggle is a
             40px target up top, so render the list inline instead. -->
        <div class="mobile-list">
          <NotesSidebarSection />
        </div>
      {:else}
        <div class="reader-empty">Select a note from the sidebar to read.</div>
      {/if}
    </main>
  {/if}
</div>

<style>
  .notes-view {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .btn-primary {
    padding: 6px 14px;
    background: var(--accent);
    color: white;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  .btn-ghost {
    padding: 4px 12px;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 12px;
    cursor: pointer;
  }
  .btn-ghost:hover { color: var(--text-primary); border-color: var(--accent); }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    gap: 12px;
  }
  .empty p { margin: 0; font-size: 14px; }

  .reader {
    flex: 1;
    overflow-y: auto;
    padding: 24px 32px 32px;
    min-width: 0;
  }
  .reader-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  .reader-head h2 {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
    letter-spacing: -0.01em;
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .color-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    display: inline-block;
  }
  /* Title input mirrors the h2 visually so swap is seamless. */
  .title-input {
    font-size: 20px;
    font-weight: 600;
    border: none;
    background: transparent;
    color: var(--text-primary);
    width: 100%;
    padding: 0;
    margin: 0;
    letter-spacing: -0.01em;
    outline: 1px solid var(--accent);
    outline-offset: 4px;
    border-radius: 2px;
  }
  .reader-head h2 { cursor: text; }
  .reader-body {
    font-size: 14px;
    line-height: 1.65;
    color: var(--text-primary);
    word-wrap: break-word;
    cursor: text;
    /* Subtle hover affordance — the body's clickable for edit. */
    border-radius: 4px;
    padding: 4px;
    margin: -4px;
    transition: background 0.1s;
  }
  .reader-body:hover { background: var(--surface-hover); }
  .empty-body { color: var(--text-tertiary); font-style: italic; }
  /* Textarea matches reader-body sizing so swap doesn't reflow. */
  .body-textarea {
    width: 100%;
    min-height: 200px;
    font-size: 14px;
    line-height: 1.65;
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 8px;
    margin: -4px;
    font-family: inherit;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
  }
  /* Footer: secondary, accessible but never prominent. */
  .reader-footer {
    margin-top: 32px;
    padding-top: 12px;
    border-top: 1px solid var(--border-light);
    font-size: 11px;
    color: var(--text-tertiary);
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .footer-cell {
    display: inline-block;
  }
  .markdown-body :global(h1) { font-size: 22px; font-weight: 700; margin: 16px 0 12px; letter-spacing: -0.02em; }
  .markdown-body :global(h2) { font-size: 18px; font-weight: 600; margin: 16px 0 10px; }
  .markdown-body :global(h3) { font-size: 16px; font-weight: 600; margin: 14px 0 8px; }
  .markdown-body :global(p)  { margin: 0 0 12px; }
  .markdown-body :global(ul), .markdown-body :global(ol) { margin: 0 0 12px; padding-left: 24px; }
  .markdown-body :global(li) { margin-bottom: 4px; }
  .markdown-body :global(blockquote) {
    border-left: 3px solid var(--border);
    padding: 0 0 0 12px;
    color: var(--text-secondary);
    margin: 12px 0;
  }
  .markdown-body :global(hr) { border: none; border-top: 1px solid var(--border); margin: 18px 0; }
  .markdown-body :global(code) {
    background: var(--surface-hover);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 12px;
    font-family: ui-monospace, monospace;
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
  .markdown-body :global(th) { background: var(--surface-hover); font-weight: 600; }
  .markdown-body :global(a) { color: var(--accent); text-decoration: none; }
  .markdown-body :global(a:hover) { text-decoration: underline; }
  .reader-empty {
    color: var(--text-tertiary);
    font-size: 13px;
    text-align: center;
    margin-top: 80px;
  }
  .mobile-list {
    /* Reuse the sidebar's NotesSection inline. Reset the negative margin
       and surface tint that NotesSidebarSection assumes (it normally lives
       inside a tinted sidebar). */
    margin: -8px -8px 0;
  }

  @media (max-width: 768px) {
    .reader { padding: 16px 18px; }
  }
</style>
