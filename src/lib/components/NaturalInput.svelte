<script>
  import { parseInput } from '../utils/nlp.js';
  import { createEvent } from '../stores/events.svelte.js';
  import { createTask } from '../stores/tasks.svelte.js';
  import { formatTime } from '../utils/dates.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { api as apiClient } from '../api.js';
  import { setDate } from '../stores/view.svelte.js';
  import { tooltip } from '../actions/tooltip.js';

  let { onnewEvent = () => {}, inputEl = $bindable(null), api = $bindable(null) } = $props();

  const prefs = getPrefs();

  let text = $state('');
  let isTaskMode = $state(false);
  let preview = $state(null);
  let showPreview = $state(false);
  let searchResults = $state([]);
  let searchActive = $state(false);
  let searchSelected = $state(0);
  let searchTimer = null;

  function handleInput() {
    if (!text.trim()) {
      preview = null;
      showPreview = false;
      searchResults = [];
      searchActive = false;
      return;
    }
    const parsed = parseInput(isTaskMode ? `task ${text}` : text);
    preview = parsed;
    showPreview = !!parsed;

    // If parser flagged this as a search query (e.g. starts with "/" or has no
    // date), kick off a debounced search against /api/events/search.
    if (parsed?.isSearch || (!parsed?.start && !isTaskMode && text.length >= 2)) {
      searchActive = true;
      if (searchTimer) clearTimeout(searchTimer);
      const q = text.trim().replace(/^\/+/, '');
      searchTimer = setTimeout(async () => {
        try {
          const res = await apiClient(`/api/events/search?q=${encodeURIComponent(q)}&limit=10`);
          if (res.ok) {
            searchResults = res.events || [];
            searchSelected = 0;
          }
        } catch {}
      }, 200);
    } else {
      searchActive = false;
      searchResults = [];
    }
  }

  function jumpToEvent(ev) {
    const d = new Date(ev.start);
    if (!isNaN(d.getTime())) setDate(d);
    text = '';
    preview = null;
    showPreview = false;
    searchResults = [];
    searchActive = false;
    inputEl?.blur();
  }

  async function handleKeydown(e) {
    // Search dropdown navigation takes precedence
    if (searchActive && searchResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); searchSelected = (searchSelected + 1) % searchResults.length; return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); searchSelected = (searchSelected - 1 + searchResults.length) % searchResults.length; return; }
      if (e.key === 'Enter')     { e.preventDefault(); jumpToEvent(searchResults[searchSelected]); return; }
    }

    if (e.key === 'Enter' && text.trim()) {
      e.preventDefault();
      const parsed = parseInput(isTaskMode ? `task ${text}` : text);
      if (!parsed) return;

      if (parsed.isSearch && !parsed.start) {
        // No matching events shown — clear and bail.
        text = '';
        preview = null;
        showPreview = false;
        searchResults = [];
        return;
      }

      if (parsed.isTask || isTaskMode) {
        await createTask({
          content: parsed.title,
          dueDate: parsed.start ? parsed.start.toISOString().split('T')[0] : null,
        });
      } else if (parsed.start) {
        const data = {
          summary: parsed.title,
          start: parsed.start.toISOString(),
          end: parsed.end ? parsed.end.toISOString() :
            new Date(parsed.start.getTime() + (prefs.values.defaultEventDuration || 30) * 60000).toISOString(),
        };
        await createEvent(data);
      }

      text = '';
      preview = null;
      showPreview = false;
    }

    if (e.key === 'Escape') {
      text = '';
      preview = null;
      showPreview = false;
      searchResults = [];
      searchActive = false;
      inputEl?.blur();
    }
  }

  function toggleMode() {
    isTaskMode = !isTaskMode;
  }

  // Expose a small imperative API to parents via bind:api={...}
  $effect(() => {
    api = {
      focus: () => inputEl?.focus(),
      toggleMode,
    };
  });

  const is12h = $derived(prefs.values.timeFormat === '12h');
</script>

<div class="natural-input-wrapper">
  <button
    type="button"
    class="input-mode-indicator"
    class:task-mode={isTaskMode}
    onclick={toggleMode}
    use:tooltip={'Click to toggle (Cmd/Ctrl+K)'}
  >
    {isTaskMode ? 'Task' : 'Event'}
  </button>
  <input
    bind:this={inputEl}
    bind:value={text}
    oninput={handleInput}
    onkeydown={handleKeydown}
    onfocus={() => { if (preview) showPreview = true; }}
    onblur={() => { setTimeout(() => showPreview = false, 200); }}
    type="text"
    class="natural-input"
    placeholder={isTaskMode ? 'New task...' : 'New event...'}
  />
  {#if showPreview && preview && preview.start}
    <div class="preview-popup">
      <span class="preview-title">{preview.title || '(untitled)'}</span>
      <span class="preview-time">
        {formatTime(preview.start, is12h)}
        {#if preview.end}
          - {formatTime(preview.end, is12h)}
        {/if}
      </span>
    </div>
  {:else if searchActive && searchResults.length > 0}
    <div class="search-popup">
      {#each searchResults as ev, i (ev.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="search-row" class:selected={i === searchSelected}
             onmousedown={(e) => { e.preventDefault(); jumpToEvent(ev); }}>
          <span class="search-title">{ev.summary || '(untitled)'}</span>
          <span class="search-when">{new Date(ev.start).toLocaleDateString()}</span>
        </div>
      {/each}
    </div>
  {:else if searchActive && text.length >= 2 && searchResults.length === 0}
    <div class="search-popup">
      <div class="search-empty">No matching events</div>
    </div>
  {/if}
</div>

<style>
  .natural-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .input-mode-indicator {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 3px 6px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--accent-light);
    color: var(--accent);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    transition: filter 0.1s;
  }
  .input-mode-indicator:hover {
    filter: brightness(0.96);
  }
  .input-mode-indicator.task-mode {
    background: #d4edda;
    color: #10b981;
  }
  :global(html.dark) .input-mode-indicator.task-mode {
    background: #1e4d2e;
    color: #6ee7b7;
  }

  .natural-input {
    width: 220px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
  }
  .natural-input:focus {
    border-color: var(--accent);
    background: var(--surface);
  }
  .natural-input::placeholder {
    color: var(--text-tertiary);
  }

  .preview-popup {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 4px;
    padding: 8px 12px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    display: flex;
    justify-content: space-between;
    align-items: center;
    z-index: 100;
    font-size: 13px;
  }

  .preview-title {
    font-weight: 500;
    color: var(--text-primary);
  }

  .preview-time {
    color: var(--text-secondary);
    font-size: 12px;
    white-space: nowrap;
  }
  .search-popup {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    z-index: 100;
    max-height: 320px;
    overflow-y: auto;
  }
  .search-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 13px;
  }
  .search-row.selected, .search-row:hover {
    background: var(--surface-hover);
  }
  .search-title {
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .search-when {
    color: var(--text-tertiary);
    font-size: 11px;
    flex-shrink: 0;
  }
  .search-empty {
    padding: 16px;
    color: var(--text-tertiary);
    font-size: 13px;
    text-align: center;
  }
</style>
