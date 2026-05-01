<script>
  // Integrations directory inside Settings. Lists every adapter from
  // /api/integrations and lets the user connect, configure, sync, or
  // disconnect each one.
  //
  // Auth flows:
  //   - PAT: inline input, validate-on-paste
  //   - OAuth: redirect to /api/integrations/<provider>/oauth/start
  //   - CalDAV: 3-field form (server URL, username, app password)

  import { onMount, tick } from 'svelte';
  import { api } from '../api.js';
  import { tooltip } from '../actions/tooltip.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';
  import Dropdown from './Dropdown.svelte';

  let { focusProvider = null } = $props();

  let providers = $state([]);
  let loading = $state(true);
  let busy = $state(null);     // provider currently being acted on
  let openProvider = $state(null); // provider whose config panel is open
  let pat = $state('');         // shared input for PAT-on-connect
  let cd = $state({ serverUrl: '', username: '', password: '' });
  let query = $state('');       // search filter
  let activeCat = $state('all'); // category filter
  let statusFilter = $state('all'); // 'all' | 'available' | 'connected' | 'coming_soon'
  let modeFilter = $state('all');   // 'all' | 'sync' | 'import' | 'read'

  // Categories — matches backend/integrations/_categories.js order. Ids must
  // align with each adapter's `category` field.
  const CATEGORIES = [
    { id: 'all',           label: 'All' },
    { id: 'calendar',      label: 'Calendar' },
    { id: 'tasks',         label: 'Tasks' },
    { id: 'notes',         label: 'Notes' },
    { id: 'email',         label: 'Email' },
    { id: 'storage',       label: 'Storage' },
    { id: 'docs',          label: 'Docs' },
    { id: 'meetings',      label: 'Meetings' },
    { id: 'communication', label: 'Communication' },
    { id: 'time',          label: 'Time' },
    { id: 'forms',         label: 'Forms' },
    { id: 'whiteboards',   label: 'Whiteboards' },
    { id: 'design',        label: 'Design' },
    { id: 'crm',           label: 'CRM' },
    { id: 'sms',           label: 'SMS' },
    { id: 'automation',    label: 'Automation' },
  ];

  // Provider-specific config state
  let notionDbs = $state([]);
  let trelloBoards = $state([]);
  let linearTeams = $state([]);
  let notionDbId = $state('');
  let trelloBoardIds = $state([]);
  let linearTeamIds = $state([]);

  async function load() {
    loading = true;
    try {
      const res = await api('/api/integrations');
      providers = res.available || [];
    } finally {
      loading = false;
    }
  }
  onMount(async () => {
    await load();
    if (focusProvider) {
      await tick();
      const el = document.querySelector(`[data-provider="${focusProvider}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('focused');
        setTimeout(() => el.classList.remove('focused'), 2400);
      }
    }
  });

  function byKind(kind) {
    return providers.filter(p => (p.kind || '').split('+').includes(kind));
  }

  // Filtered + grouped view used by the directory layout.
  let filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return providers.filter(p => {
      if (activeCat !== 'all' && (p.category || p.kind) !== activeCat) return false;
      if (statusFilter === 'connected' && !p.connected) return false;
      if (statusFilter === 'available' && (p.status === 'coming_soon' || p.connected)) return false;
      if (statusFilter === 'coming_soon' && p.status !== 'coming_soon') return false;
      if (modeFilter !== 'all' && (p.mode || 'sync') !== modeFilter) return false;
      if (q && !`${p.name} ${p.description || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  let categoryCounts = $derived.by(() => {
    const counts = { all: providers.length };
    for (const p of providers) {
      const c = p.category || p.kind || 'other';
      counts[c] = (counts[c] || 0) + 1;
    }
    return counts;
  });

  // Group filtered providers by category, preserving CATEGORIES order.
  let grouped = $derived.by(() => {
    if (activeCat !== 'all') return [{ id: activeCat, items: filtered }];
    const buckets = new Map();
    for (const p of filtered) {
      const c = p.category || p.kind || 'other';
      if (!buckets.has(c)) buckets.set(c, []);
      buckets.get(c).push(p);
    }
    return CATEGORIES.filter(c => c.id !== 'all' && buckets.has(c.id))
      .map(c => ({ id: c.id, label: c.label, items: buckets.get(c.id) }));
  });

  function categoryLabel(id) {
    return CATEGORIES.find(c => c.id === id)?.label || id;
  }

  async function connectPat(p) {
    if (!pat.trim()) return;
    busy = p.provider;
    try {
      await api(`/api/integrations/${p.provider}/pat`, {
        method: 'POST',
        body: JSON.stringify({ token: pat.trim() }),
      });
      pat = '';
      await load();
      // Auto-load config options for providers that need a follow-up step.
      if (p.provider === 'notion') await loadNotionDbs();
      if (p.provider === 'trello') await loadTrelloBoards();
      if (p.provider === 'linear') await loadLinearTeams();
      openProvider = p.provider;
    } catch (e) {
      alert(e?.message || 'Connection failed');
    } finally {
      busy = null;
    }
  }
  async function connectOauth(p) {
    busy = p.provider;
    try {
      const res = await api(`/api/integrations/${p.provider}/oauth/start`);
      if (res?.url) window.location.href = res.url;
    } finally {
      busy = null;
    }
  }
  async function connectCalDav(p) {
    busy = p.provider;
    try {
      await api(`/api/integrations/${p.provider}/caldav`, {
        method: 'POST',
        body: JSON.stringify(cd),
      });
      cd = { serverUrl: '', username: '', password: '' };
      await load();
    } catch (e) {
      alert(e?.message || 'Connection failed');
    } finally {
      busy = null;
    }
  }
  async function syncNow(p) {
    busy = p.provider;
    try {
      await api(`/api/integrations/${p.provider}/sync`, { method: 'POST' });
      await load();
    } catch (e) {
      alert(e?.message || 'Sync failed');
    } finally {
      busy = null;
    }
  }
  async function disconnect(p) {
    const ok = await confirmAction({
      title: `Disconnect ${p.name}?`,
      body: `Synced data from ${p.name} will be removed locally. Your data on ${p.name} itself is untouched.`,
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    busy = p.provider;
    try {
      await api(`/api/integrations/${p.provider}`, { method: 'DELETE' });
      await load();
    } finally {
      busy = null;
    }
  }

  // Provider-specific config loaders
  async function loadNotionDbs() {
    try {
      const r = await api('/api/integrations/notion/databases');
      notionDbs = r.databases || [];
    } catch { notionDbs = []; }
  }
  async function loadTrelloBoards() {
    try {
      const r = await api('/api/integrations/trello/boards');
      trelloBoards = r.boards || [];
    } catch { trelloBoards = []; }
  }
  async function loadLinearTeams() {
    try {
      const r = await api('/api/integrations/linear/teams');
      linearTeams = r.teams || [];
    } catch { linearTeams = []; }
  }
  async function saveConfig(provider) {
    const body = provider === 'notion' ? { databaseId: notionDbId }
      : provider === 'trello' ? { boardIds: trelloBoardIds }
      : provider === 'linear' ? { teamIds: linearTeamIds }
      : {};
    await api(`/api/integrations/${provider}/config`, { method: 'POST', body: JSON.stringify(body) });
    await syncNow({ provider });
    openProvider = null;
  }
</script>

<div class="integrations">
  {#if loading}
    <div class="loading">Loading…</div>
  {:else}
    <div class="filter-bar">
      <input class="search" type="search" placeholder="Search integrations…" bind:value={query} />
      <Dropdown
        value={statusFilter}
        onchange={(v) => statusFilter = v}
        options={[
          { value: 'all', label: 'All' },
          { value: 'available', label: 'Available' },
          { value: 'connected', label: 'Connected' },
          { value: 'coming_soon', label: 'Coming soon' },
        ]}
      />
      <Dropdown
        value={modeFilter}
        onchange={(v) => modeFilter = v}
        options={[
          { value: 'all',    label: 'All types' },
          { value: 'sync',   label: 'Sync (two-way)' },
          { value: 'import', label: 'Import (one-way)' },
          { value: 'read',   label: 'Read-only' },
        ]}
      />
    </div>

    <div class="cat-row">
      {#each CATEGORIES as c}
        {#if c.id === 'all' || (categoryCounts[c.id] || 0) > 0}
          <button class="cat-chip" class:active={activeCat === c.id} onclick={() => activeCat = c.id}>
            {c.label}
            <span class="cat-count">{categoryCounts[c.id] || 0}</span>
          </button>
        {/if}
      {/each}
    </div>

    {#if filtered.length === 0}
      <div class="empty">
        <div class="empty-title">No integrations match.</div>
        <div class="empty-sub">Try clearing the search or switching categories.</div>
      </div>
    {/if}

    {#each grouped as group (group.id)}
      <div class="kind-section">
        <h4>{categoryLabel(group.id)}</h4>
        <div class="provider-grid">
          {#each group.items as p (p.provider)}
              <div class="provider-card" data-provider={p.provider} class:connected={p.connected} class:errored={p.status === 'error'} class:coming={p.status === 'coming_soon' && !p.connected}>
                <div class="provider-head">
                  <img class="provider-logo" src={`/api/icons/${p.provider}.svg`} alt="" loading="lazy" />
                  <div class="provider-name">
                    {p.name}
                    {#if p.recommended && !p.connected && p.status !== 'coming_soon'}
                      <span class="rec-dot" use:tooltip={'Recommended'}></span>
                    {/if}
                  </div>
                  {#if p.connected}
                    <span class="status-pill" class:err={p.status === 'error'}>
                      {p.status === 'error' ? 'Error' : 'Connected'}
                    </span>
                  {:else if p.status === 'coming_soon'}
                    <span class="status-pill soon">Coming soon</span>
                  {:else if p.status === 'beta'}
                    <span class="status-pill beta">Beta</span>
                  {/if}
                  {#if p.mode === 'import'}
                    <span class="mode-pill import" use:tooltip={'One-way import — bring data in'}>Import</span>
                  {:else if p.mode === 'read'}
                    <span class="mode-pill read" use:tooltip={'Read-only — surfaces data on your calendar'}>Read</span>
                  {/if}
                </div>
                <p class="provider-desc">{p.description}</p>
                {#if p.status === 'coming_soon' && !p.connected}
                  <div class="soon-cta">
                    <a class="docs" href={p.docsUrl} target="_blank" rel="noopener">Learn more</a>
                  </div>
                {:else if p.connected}
                  <div class="provider-meta">
                    {#if p.account_email}<span>{p.account_email}</span>{/if}
                    {#if p.last_synced_at}
                      <span class="dot">·</span>
                      <span use:tooltip={p.last_synced_at}>Last sync: {new Date(p.last_synced_at).toLocaleString()}</span>
                    {/if}
                  </div>
                  {#if p.last_error}
                    <div class="err-msg">{p.last_error}</div>
                  {/if}
                  <div class="provider-actions">
                    {#if p.syncEnabled}
                      <button onclick={() => syncNow(p)} disabled={busy === p.provider}>Sync now</button>
                    {/if}
                    {#if ['notion', 'trello', 'linear'].includes(p.provider)}
                      <button onclick={async () => {
                        openProvider = openProvider === p.provider ? null : p.provider;
                        if (openProvider) {
                          if (p.provider === 'notion') await loadNotionDbs();
                          if (p.provider === 'trello') await loadTrelloBoards();
                          if (p.provider === 'linear') await loadLinearTeams();
                        }
                      }}>
                        Configure
                      </button>
                    {/if}
                    <button class="danger" onclick={() => disconnect(p)} disabled={busy === p.provider}>
                      Disconnect
                    </button>
                  </div>
                {:else}
                  <div class="provider-connect">
                    {#if p.authType === 'pat'}
                      <input type="password" placeholder="Paste your token" bind:value={pat} />
                      <button onclick={() => connectPat(p)} disabled={busy === p.provider || !pat.trim()}>
                        Connect
                      </button>
                    {:else if p.authType === 'oauth'}
                      <button onclick={() => connectOauth(p)} disabled={busy === p.provider}>
                        Connect with {p.name}
                      </button>
                    {:else if p.authType === 'caldav'}
                      <input placeholder="Server URL (e.g. https://caldav.icloud.com)" bind:value={cd.serverUrl} />
                      <input placeholder="Username (email)" bind:value={cd.username} />
                      <input type="password" placeholder="App-specific password" bind:value={cd.password} />
                      <button onclick={() => connectCalDav(p)} disabled={busy === p.provider}>
                        Connect
                      </button>
                    {/if}
                    {#if p.docsUrl}
                      <a class="docs" href={p.docsUrl} target="_blank" rel="noopener">How to get a token</a>
                    {/if}
                    {#if p.requiresEnv?.length}
                      <div class="env-hint">Server admin must set: {p.requiresEnv.join(', ')}</div>
                    {/if}
                  </div>
                {/if}

                {#if openProvider === p.provider && p.provider === 'notion'}
                  <div class="config-pane">
                    <label>Notion database to sync</label>
                    <Dropdown bind:value={notionDbId}
                      options={notionDbs.map(d => ({ value: d.id, label: d.title }))}
                      placeholder="Pick a database…" />
                    <button onclick={() => saveConfig('notion')} disabled={!notionDbId}>Save & sync</button>
                  </div>
                {:else if openProvider === p.provider && p.provider === 'trello'}
                  <div class="config-pane">
                    <label>Trello boards to sync</label>
                    {#each trelloBoards as b}
                      <label class="checkbox-row">
                        <input type="checkbox"
                          checked={trelloBoardIds.includes(b.id)}
                          onchange={(e) => {
                            trelloBoardIds = e.currentTarget.checked
                              ? [...trelloBoardIds, b.id]
                              : trelloBoardIds.filter(x => x !== b.id);
                          }} />
                        <span>{b.name}</span>
                      </label>
                    {/each}
                    <button onclick={() => saveConfig('trello')} disabled={!trelloBoardIds.length}>Save & sync</button>
                  </div>
                {:else if openProvider === p.provider && p.provider === 'linear'}
                  <div class="config-pane">
                    <label>Linear teams to sync (leave empty for issues assigned to you)</label>
                    {#each linearTeams as t}
                      <label class="checkbox-row">
                        <input type="checkbox"
                          checked={linearTeamIds.includes(t.id)}
                          onchange={(e) => {
                            linearTeamIds = e.currentTarget.checked
                              ? [...linearTeamIds, t.id]
                              : linearTeamIds.filter(x => x !== t.id);
                          }} />
                        <span>{t.name} ({t.key})</span>
                      </label>
                    {/each}
                    <button onclick={() => saveConfig('linear')}>Save & sync</button>
                  </div>
                {/if}
              </div>
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .integrations { display: flex; flex-direction: column; gap: 16px; }
  .help-text { color: var(--text-secondary); font-size: 13px; line-height: 1.5; margin: 0; }
  .loading { color: var(--text-tertiary); font-size: 13px; padding: 16px 0; }

  .filter-bar {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .filter-bar .search {
    flex: 0 1 280px;
    min-width: 180px;
    max-width: 320px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 13px;
  }
  /* Compact the two filter dropdowns — they were eating horizontal space
     because Dropdown's inner button is width:100% of its flex slot. */
  .filter-bar :global(.dropdown) { width: auto; flex: 0 0 auto; }
  .filter-bar :global(.dropdown > button) { width: auto; min-width: 120px; }
  .status-toggle {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .status-toggle button {
    padding: 5px 10px;
    border: none;
    border-right: 1px solid var(--border);
    background: var(--surface);
    font-size: 12px;
    cursor: pointer;
    color: var(--text-secondary);
  }
  .status-toggle button:last-child { border-right: none; }
  .status-toggle button.active { background: var(--accent-light); color: var(--accent); font-weight: 600; }

  .cat-row {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 4px;
    /* Right-edge fade indicates more categories scroll into view. */
    mask-image: linear-gradient(to right, black calc(100% - 24px), transparent);
    -webkit-mask-image: linear-gradient(to right, black calc(100% - 24px), transparent);
    scroll-snap-type: x proximity;
  }
  .cat-row::-webkit-scrollbar { display: none; }
  .cat-row { scrollbar-width: none; }
  .cat-row .cat-chip {
    flex-shrink: 0;
    scroll-snap-align: start;
  }
  .cat-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 999px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .cat-chip:hover { background: var(--surface-hover); color: var(--text-primary); }
  .cat-chip.active { background: var(--accent-light); border-color: color-mix(in srgb, var(--accent) 28%, var(--border)); color: var(--accent); font-weight: 600; }
  .cat-count {
    font-size: 10px;
    padding: 0 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text-tertiary) 18%, transparent);
    color: var(--text-tertiary);
  }
  .cat-chip.active .cat-count { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }

  .empty {
    padding: 32px 16px;
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    text-align: center;
  }
  .empty-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .empty-sub { font-size: 12px; color: var(--text-tertiary); margin-top: 4px; }

  .provider-card.coming { opacity: 0.7; }
  .status-pill.soon {
    color: var(--text-tertiary);
    background: color-mix(in srgb, var(--text-tertiary) 14%, transparent);
    border-color: color-mix(in srgb, var(--text-tertiary) 28%, transparent);
  }
  .status-pill.beta {
    color: #b45309;
    background: color-mix(in srgb, #f59e0b 14%, transparent);
    border-color: color-mix(in srgb, #f59e0b 28%, transparent);
  }
  :global(html.dark) .status-pill.beta { color: #fbbf24; }
  .rec-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    margin-left: 4px;
    vertical-align: middle;
  }
  .mode-pill {
    font-size: 9px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-left: 6px;
    border: 1px solid;
  }
  .mode-pill.import {
    color: #6d28d9;
    background: color-mix(in srgb, #8b5cf6 12%, transparent);
    border-color: color-mix(in srgb, #8b5cf6 28%, transparent);
  }
  :global(html.dark) .mode-pill.import { color: #c4b5fd; }
  .mode-pill.read {
    color: #0369a1;
    background: color-mix(in srgb, #0ea5e9 12%, transparent);
    border-color: color-mix(in srgb, #0ea5e9 28%, transparent);
  }
  :global(html.dark) .mode-pill.read { color: #7dd3fc; }
  .soon-cta { display: flex; justify-content: flex-start; }
  .soon-cta .docs { margin-left: 0; }
  .kind-section h4 {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
  }
  .provider-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }
  .provider-card {
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--radius-md);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .provider-card.connected { border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
  .provider-card.errored { border-color: color-mix(in srgb, var(--error) 50%, var(--border)); }
  .provider-card.focused {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
    transition: box-shadow 0.3s, border-color 0.3s;
  }
  .provider-head { display: flex; align-items: center; gap: 10px; }
  .provider-logo {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    object-fit: contain;
    background: var(--surface);
    padding: 3px;
    border: 1px solid var(--border-light);
    flex-shrink: 0;
  }
  :global(html.dark) .provider-logo {
    background: white;
  }
  .provider-card .provider-name { flex: 1; }
  .provider-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .status-pill {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 999px;
    color: #047857;
    background: color-mix(in srgb, #10b981 14%, transparent);
    border: 1px solid color-mix(in srgb, #10b981 28%, transparent);
  }
  :global(html.dark) .status-pill { color: #6ee7b7; }
  .status-pill.err { color: var(--error); background: color-mix(in srgb, var(--error) 14%, transparent); border-color: color-mix(in srgb, var(--error) 28%, transparent); }
  .provider-desc { color: var(--text-secondary); font-size: 12px; line-height: 1.45; margin: 0; }
  .provider-meta { font-size: 11px; color: var(--text-tertiary); display: flex; gap: 6px; flex-wrap: wrap; }
  .err-msg { font-size: 11px; color: var(--error); }
  .provider-connect, .provider-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .provider-connect input {
    flex: 1;
    min-width: 140px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 12px;
  }
  .provider-connect button, .provider-actions button {
    padding: 5px 10px;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--radius-sm);
    font-size: 12px;
    cursor: pointer;
    color: var(--text-primary);
  }
  .provider-connect button:hover, .provider-actions button:hover { background: var(--surface-hover); border-color: var(--accent); }
  .provider-actions button.danger { color: var(--error); }
  .provider-actions button.danger:hover { background: color-mix(in srgb, var(--error) 12%, transparent); border-color: var(--error); }
  .provider-connect button:disabled, .provider-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
  .docs { font-size: 11px; color: var(--text-tertiary); margin-left: auto; }
  .env-hint { font-size: 11px; color: var(--text-tertiary); width: 100%; margin-top: 2px; }
  .config-pane {
    border-top: 1px solid var(--border-light);
    padding-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .config-pane label { font-size: 11px; color: var(--text-secondary); }
  .checkbox-row { display: flex; align-items: center; gap: 6px; font-size: 12px; }
</style>
