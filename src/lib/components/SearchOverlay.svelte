<script>
  import { api } from '../api.js';
  import { setDate, setView } from '../stores/view.svelte.js';
  import { lowerAmPm } from '../utils/dates.js';

  let { onclose = () => {} } = $props();
  let query = $state('');
  let results = $state([]);
  let loading = $state(false);
  let inputEl;

  $effect(() => {
    if (inputEl) inputEl.focus();
  });

  // Backend cap is 50; default is 20. Start at 20, let the user click
  // "Show more" to bump to 50 if they need to.
  let limit = $state(20);
  let totalShown = $derived(results.length);
  let canShowMore = $derived(results.length === limit && limit < 50);

  let debounceId = null;
  $effect(() => {
    const q = query.trim();
    if (debounceId) clearTimeout(debounceId);
    if (q.length < 2) { results = []; limit = 20; return; }
    debounceId = setTimeout(async () => {
      loading = true;
      try {
        const res = await api(`/api/events/search?q=${encodeURIComponent(q)}&limit=${limit}`);
        if (res.ok) results = res.events || [];
      } finally {
        loading = false;
      }
    }, 200);
  });

  async function showMore() {
    limit = 50;
    loading = true;
    try {
      const res = await api(`/api/events/search?q=${encodeURIComponent(query.trim())}&limit=50`);
      if (res.ok) results = res.events || [];
    } finally {
      loading = false;
    }
  }

  function jumpTo(ev) {
    setDate(new Date(ev.start));
    onclose();
  }

  function handleKey(e) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={handleKey} />

<div class="overlay-backdrop" onclick={onclose} role="presentation"></div>
<div class="overlay-card" role="dialog" aria-label="Search events">
  <input
    bind:this={inputEl}
    bind:value={query}
    type="search"
    placeholder="Search events…"
    autocomplete="off"
    spellcheck="false"
  />
  {#if loading && results.length === 0}
    <div class="status">Searching…</div>
  {:else if results.length === 0 && query.trim().length >= 2}
    <div class="status">No matches. Try a different word, or check Google Calendar — events sync every few minutes.</div>
  {:else if results.length > 0}
    <div class="result-count">
      {totalShown} {totalShown === 1 ? 'result' : 'results'}{limit === 50 && totalShown === 50 ? ' (max)' : ''}
    </div>
    <ul class="results">
      {#each results as r (r.id)}
        <li>
          <button onclick={() => jumpTo(r)}>
            <div class="title">{r.summary || '(no title)'}</div>
            <div class="meta">
              {lowerAmPm(new Date(r.start).toLocaleString(undefined, {
                weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'
              }))}
              {#if r.location}· {r.location}{/if}
            </div>
          </button>
        </li>
      {/each}
    </ul>
    {#if canShowMore}
      <button class="show-more" onclick={showMore} disabled={loading}>
        {loading ? 'Loading…' : 'Show more'}
      </button>
    {/if}
  {/if}
</div>

<style>
  .overlay-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.4);
    z-index: 999;
  }
  .overlay-card {
    position: fixed;
    top: 80px; left: 50%; transform: translateX(-50%);
    width: 90%; max-width: 540px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    z-index: 1000;
    box-shadow: var(--shadow-lg);
  }
  input {
    width: 100%;
    padding: 10px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 15px;
  }
  input:focus { outline: none; border-color: var(--accent); }
  .status { padding: 12px; color: var(--text-tertiary); font-size: 13px; line-height: 1.5; }
  .result-count {
    font-size: 11px; color: var(--text-tertiary);
    padding: 8px 4px 0; font-weight: 500;
  }
  .results { list-style: none; padding: 4px 0 0; margin: 4px 0 0; max-height: 50vh; overflow-y: auto; }
  .show-more {
    display: block; width: 100%;
    padding: 8px; margin-top: 6px;
    background: var(--surface-hover); border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 12px; font-weight: 500;
    cursor: pointer;
  }
  .show-more:hover { background: var(--accent-light); color: var(--accent); }
  .show-more:disabled { opacity: 0.6; cursor: wait; }
  .results li { margin: 0; }
  .results button {
    display: block; width: 100%; text-align: left;
    background: transparent; border: none;
    padding: 8px 10px; border-radius: 6px;
    color: var(--text-primary);
    cursor: pointer;
  }
  .results button:hover { background: var(--surface-hover); }
  .title { font-size: 13px; font-weight: 500; }
  .meta { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
</style>
