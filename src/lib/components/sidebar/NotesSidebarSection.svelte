<script>
  // Sidebar-only Notes navigator — used when the user is in the Notes
  // holistic view. Mirrors the selection state with the main pane via the
  // notesView store, so clicking here jumps the reader pane to that note.
  //
  // Intentionally NOT a duplicate of the main-pane list: this is compact,
  // shows just title + recency, and skips the snippet/body. The main pane
  // is the place to read; the sidebar is the place to navigate.

  import { getContext } from 'svelte';
  import { getNotes } from '../../stores/notes.svelte.js';
  import { getNotesView, selectNote } from '../../stores/notesView.svelte.js';
  import { tooltip } from '../../actions/tooltip.js';

  const notesStore = getNotes();
  const notesView = getNotesView();
  const app = getContext('app');

  // Sort: pinned first, then most-recently-updated. Same shape as the
  // main pane so users see consistent ordering.
  const notes = $derived.by(() => {
    return [...notesStore.items].sort((a, b) => {
      if (a.pinned !== b.pinned) return b.pinned - a.pinned;
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
  });

  function timeAgo(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
</script>

<div class="notes-section">
  <div class="section-head">
    <h4>Notes <span class="count">{notes.length}</span></h4>
    <button
      class="add-btn"
      onclick={() => app?.editNote?.()}
      use:tooltip={'New note'}
      aria-label="New note"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <path d="M12 5v14M5 12h14"/>
      </svg>
    </button>
  </div>
  {#if notes.length === 0}
    <p class="empty">No notes yet.</p>
  {:else}
    <ul class="note-list">
      {#each notes as n (n.id)}
        <li>
          <button
            class="note-row"
            class:active={notesView.selectedId === n.id}
            class:pinned={n.pinned}
            style={n.color ? `border-left-color: var(--color-${n.color}, ${n.color});` : ''}
            onclick={() => selectNote(n.id)}
          >
            {#if n.pinned}
              <svg class="pin" width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M14 2l-1 8 5 4v2H6v-2l5-4-1-8h4z"/>
              </svg>
            {/if}
            <span class="title">{n.title || 'Untitled'}</span>
            <span class="time">{timeAgo(n.updatedAt)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .notes-section {
    padding: 8px 8px 12px;
    border-bottom: 1px solid var(--border-light);
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    /* Take available space when this section is at the top of the sidebar
       so the user can scan their notes without scrolling. The MiniCalendar
       below sits in its natural height. */
    overflow: hidden;
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
    padding: 0 4px;
  }
  .section-head h4 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .count {
    font-size: 10px;
    font-weight: 500;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .add-btn {
    width: 22px;
    height: 22px;
    border: 1px solid var(--border);
    background: none;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .add-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--surface-hover); }

  .empty {
    font-size: 11px;
    color: var(--text-tertiary);
    margin: 8px 4px 0;
  }
  .note-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    min-height: 0;
    /* When there are many notes the section becomes scrollable; cap height
       so the sidebar's other sections stay reachable. */
    max-height: 60vh;
  }
  .note-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border: none;
    background: none;
    text-align: left;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-primary);
    font-size: 12px;
    min-width: 0;
    border-left: 2px solid transparent;
    margin-left: -2px;
  }
  .note-row.pinned {
    border-left-color: var(--accent);
  }
  .note-row:hover { background: var(--surface-hover); }
  .note-row.active {
    background: var(--accent-light);
    color: var(--accent);
  }
  .pin { color: var(--accent); flex-shrink: 0; }
  .title {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }
  .time {
    font-size: 10px;
    color: var(--text-tertiary);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .note-row.active .time { color: inherit; opacity: 0.7; }
</style>
