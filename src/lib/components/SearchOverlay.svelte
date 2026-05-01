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

  let debounceId = null;
  $effect(() => {
    const q = query.trim();
    if (debounceId) clearTimeout(debounceId);
    if (q.length < 2) { results = []; return; }
    debounceId = setTimeout(async () => {
      loading = true;
      try {
        const res = await api(`/api/events/search?q=${encodeURIComponent(q)}`);
        if (res.ok) results = res.events || [];
      } finally {
        loading = false;
      }
    }, 200);
  });

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
  {#if loading}
    <div class="status">Searching…</div>
  {:else if results.length === 0 && query.trim().length >= 2}
    <div class="status">No matches.</div>
  {:else if results.length > 0}
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
  .status { padding: 12px; color: var(--text-tertiary); font-size: 13px; }
  .results { list-style: none; padding: 4px 0 0; margin: 8px 0 0; max-height: 60vh; overflow-y: auto; }
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
