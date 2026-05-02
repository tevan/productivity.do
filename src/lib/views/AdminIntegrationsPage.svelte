<script>
  // /admin/integrations — internal reference of the FULL adapter catalog
  // (including stubs / coming-soon adapters that users never see).
  //
  // User-facing /integrations is intentionally narrow: only shipped
  // adapters appear there. Per the breadth-vs-depth memory:
  // "promising something is not as effective as having it." This page
  // is for us — to see what scaffolds exist, what's promoted to user-
  // visible, and what's still on the bench.
  //
  // Source: GET /api/admin/integrations (admin-only, returns the full
  // listAdapters() result without filtering).

  import { api } from '../api.js';

  let total = $state(0);
  let adapters = $state([]);
  let loading = $state(true);
  let err = $state('');
  let query = $state('');
  let statusFilter = $state('all'); // all | stable | beta | coming_soon | deprecated

  async function load() {
    loading = true; err = '';
    const r = await api('/api/admin/integrations');
    if (r?.ok) {
      adapters = r.available || [];
      total = r.total ?? adapters.length;
    } else {
      err = r?.error || 'Could not load catalog';
    }
    loading = false;
  }
  $effect(() => { load(); });

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return adapters.filter(a => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (q && !`${a.name} ${a.provider} ${a.description || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  // Group by category for legibility — same structure as the user-facing
  // marketplace, but here we don't hide empty categories.
  const grouped = $derived.by(() => {
    const map = new Map();
    for (const a of filtered) {
      const c = a.category || a.kind || 'other';
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(a);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, items]) => ({ id, items }));
  });

  const counts = $derived.by(() => {
    const byStatus = { all: adapters.length };
    for (const a of adapters) {
      byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    }
    return byStatus;
  });
</script>

<div class="admin-page">
  <header class="admin-head">
    <a href="/" class="back-link">← App</a>
    <h1>Integrations catalog</h1>
    <span class="generated">Admin-only · full catalog incl. stubs</span>
    <button class="reload-btn" onclick={load} disabled={loading}>↻ Reload</button>
  </header>

  {#if loading}
    <div class="empty">Loading…</div>
  {:else if err}
    <div class="empty err">{err}</div>
  {:else}
    <div class="filters">
      <input
        type="text"
        class="search"
        placeholder="Filter by name or provider…"
        bind:value={query}
      />
      <div class="status-row">
        <button class:active={statusFilter === 'all'}        onclick={() => statusFilter = 'all'}>All ({counts.all || 0})</button>
        <button class:active={statusFilter === 'stable'}     onclick={() => statusFilter = 'stable'}>Stable ({counts.stable || 0})</button>
        <button class:active={statusFilter === 'beta'}       onclick={() => statusFilter = 'beta'}>Beta ({counts.beta || 0})</button>
        <button class:active={statusFilter === 'coming_soon'} onclick={() => statusFilter = 'coming_soon'}>Coming soon ({counts.coming_soon || 0})</button>
        <button class:active={statusFilter === 'deprecated'} onclick={() => statusFilter = 'deprecated'}>Deprecated ({counts.deprecated || 0})</button>
      </div>
    </div>

    <p class="lead">
      <strong>{filtered.length}</strong> of {total} adapters shown.
      User-facing marketplace at <code>/integrations</code> only renders
      <strong>stable + beta</strong> ({(counts.stable || 0) + (counts.beta || 0)}).
      Everything else lives here as scaffolding.
    </p>

    {#each grouped as group (group.id)}
      <section class="cat">
        <h2>{group.id} <span class="cat-count">{group.items.length}</span></h2>
        <table class="adapters">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Name</th>
              <th>Status</th>
              <th>Mode</th>
              <th>Auth</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {#each group.items as a (a.provider)}
              <tr class:user-visible={a.status === 'stable' || a.status === 'beta'}>
                <td class="mono">{a.provider}</td>
                <td>{a.name}</td>
                <td>
                  <span class="status-chip {a.status}">{a.status}</span>
                </td>
                <td>{a.mode || 'sync'}</td>
                <td>{a.authType || '—'}</td>
                <td class="desc">{a.description || ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/each}

    <p class="footnote">
      Adapter source files live in <code>backend/integrations/&lt;provider&gt;/adapter.js</code>. Stubs use <code>backend/integrations/_stub.js#makeStub()</code>. Promote a stub to a real adapter only when ALL four criteria in the breadth-vs-depth memory hold.
    </p>
  {/if}
</div>

<style>
  .admin-page {
    padding: 32px 40px;
    max-width: 1200px;
    margin: 0 auto;
    color: var(--text-primary);
  }
  .admin-head {
    display: flex; align-items: baseline; gap: 16px;
    margin-bottom: 18px;
  }
  .admin-head h1 { font-size: 22px; font-weight: 700; margin: 0; }
  .back-link { color: var(--text-tertiary); font-size: 13px; text-decoration: none; }
  .back-link:hover { color: var(--text-primary); }
  .generated { color: var(--text-tertiary); font-size: 12px; margin-left: auto; }
  .reload-btn {
    background: none; border: 1px solid var(--border);
    padding: 4px 10px; border-radius: 6px;
    color: var(--text-secondary); font-size: 12px; cursor: pointer;
  }
  .reload-btn:hover { color: var(--text-primary); }

  .lead { font-size: 13px; color: var(--text-secondary); margin-bottom: 24px; }
  .lead code { background: var(--bg-secondary); padding: 1px 5px; border-radius: 3px; font-size: 11px; }

  .filters {
    display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
    margin-bottom: 14px;
  }
  .search {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 13px;
    min-width: 240px;
    background: var(--surface);
    color: var(--text-primary);
  }
  .status-row {
    display: flex; gap: 4px; flex-wrap: wrap;
  }
  .status-row button {
    background: var(--bg-secondary); border: 1px solid var(--border);
    padding: 4px 10px; border-radius: 6px;
    font-size: 12px; cursor: pointer;
    color: var(--text-secondary);
  }
  .status-row button:hover { color: var(--text-primary); }
  .status-row button.active { background: var(--accent); color: white; border-color: var(--accent); }

  .cat { margin-bottom: 28px; }
  .cat h2 {
    font-size: 14px; font-weight: 600; margin: 0 0 8px;
    text-transform: capitalize;
    color: var(--text-primary);
  }
  .cat-count {
    font-weight: 400; color: var(--text-tertiary);
    font-size: 12px; margin-left: 4px;
  }

  table.adapters {
    width: 100%; border-collapse: collapse;
    font-size: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  table.adapters th, table.adapters td {
    padding: 6px 10px; text-align: left;
    border-bottom: 1px solid var(--border);
  }
  table.adapters th {
    background: var(--bg-secondary);
    font-weight: 600;
    color: var(--text-secondary);
  }
  table.adapters tr:last-child td { border-bottom: none; }
  table.adapters .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; color: var(--text-tertiary); }
  table.adapters .desc { color: var(--text-secondary); max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  table.adapters tr.user-visible { background: color-mix(in srgb, var(--accent) 4%, transparent); }

  .status-chip {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .status-chip.stable      { background: #dcfce7; color: #166534; }
  .status-chip.beta        { background: #dbeafe; color: #1e40af; }
  .status-chip.coming_soon { background: #fef3c7; color: #92400e; }
  .status-chip.deprecated  { background: #fee2e2; color: #991b1b; }

  .empty { padding: 40px 0; text-align: center; color: var(--text-tertiary); }
  .empty.err { color: var(--error, #c62828); }

  .footnote {
    margin-top: 28px;
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.6;
    border-top: 1px solid var(--border);
    padding-top: 16px;
  }
  .footnote code {
    background: var(--bg-secondary);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 11px;
  }
</style>
