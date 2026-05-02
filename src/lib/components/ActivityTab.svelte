<script>
  // Activity feed — cross-resource recent revisions for this user, MERGED
  // with the offline replay log. The server tells us what was committed
  // (notes/tasks revisions); the offline queue tells us what got replayed
  // or failed when the device came back online. Both streams answer the
  // user's "what just happened?" question, so they belong in one view.

  import { api } from '../api.js';
  import { recentActivity as offlineActivity } from '../offline/replayQueue.js';

  let items = $state([]);
  let loading = $state(true);

  async function load() {
    loading = true;
    const [srv, off] = await Promise.all([
      api('/api/activity?limit=200'),
      offlineActivity(100).catch(() => []),
    ]);
    const serverItems = srv?.ok ? (srv.items || []) : [];
    // Normalize offline entries into the same shape as server revisions.
    // Source `'offline'` lets the row pick a different label / icon.
    const offlineItems = (off || []).map((e, i) => ({
      id: `offline-${e.idempotencyKey || i}-${e.replayedAt}`,
      createdAt: e.replayedAt,
      resource: deriveResource(e.url),
      op: e.kind === 'failure' ? 'failed' : 'replayed',
      source: 'offline',
      label: `${e.method} ${shortPath(e.url)}`,
      detail: e.error || (e.kind === 'success' ? 'Synced' : ''),
    }));
    // Merge + sort newest-first.
    items = [...serverItems, ...offlineItems].sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt))
    );
    loading = false;
  }
  $effect(() => { load(); });

  function deriveResource(url) {
    if (!url) return '';
    const m = String(url).match(/\/api\/([^/?]+)/);
    return m ? m[1] : '';
  }
  function shortPath(url) {
    try { return new URL(url, location.origin).pathname; }
    catch { return url; }
  }

  function relativeWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
    const diffMs = Date.now() - d.getTime();
    const sec = Math.round(diffMs / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
    if (sec < 86400 * 7) return `${Math.round(sec / 86400)}d ago`;
    return d.toLocaleDateString();
  }

  const RES_LABELS = { notes: 'Note', tasks: 'Task' };
  const OP_LABELS = {
    create: 'created',
    update: 'edited',
    delete: 'deleted',
    soft_delete: 'moved to trash',
    restore: 'restored',
    replayed: 'synced (offline)',
    failed: 'failed (offline)',
  };
</script>

<div class="activity-tab">
  <h3>Activity</h3>
  <p class="help-text">A history of changes to your notes and tasks. Up to 90 days; up to 50 versions per item.</p>

  {#if loading}
    <div class="empty">Loading…</div>
  {:else if items.length === 0}
    <div class="empty">No activity yet.</div>
  {:else}
    <ul class="feed">
      {#each items as item (item.id)}
        <li class="feed-row" class:offline={item.source === 'offline'} class:failed={item.op === 'failed'}>
          <span class="when" title={item.createdAt}>{relativeWhen(item.createdAt)}</span>
          <span class="op">{OP_LABELS[item.op] || item.op}</span>
          <span class="kind">{RES_LABELS[item.resource] || item.resource}</span>
          {#if item.label}
            <span class="label">{item.source === 'offline' ? item.label : `"${item.label}"`}</span>
          {/if}
          {#if item.detail}
            <span class="detail">— {item.detail}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .activity-tab { padding: 4px 0; }
  .activity-tab h3 { margin: 0 0 4px; font-size: 16px; font-weight: 600; color: var(--text-primary); }
  .help-text { margin: 0 0 16px; font-size: 13px; color: var(--text-secondary); }
  .empty { padding: 24px 0; color: var(--text-tertiary); font-size: 13px; }
  .feed { list-style: none; padding: 0; margin: 0; }
  .feed-row {
    display: flex; align-items: baseline; gap: 6px;
    padding: 8px 4px;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .feed-row:last-child { border-bottom: none; }
  .when { color: var(--text-tertiary); width: 70px; flex-shrink: 0; font-size: 11px; font-variant-numeric: tabular-nums; }
  .op { color: var(--text-secondary); }
  .kind { color: var(--text-secondary); text-transform: lowercase; }
  .label { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
  .detail { color: var(--text-tertiary); font-size: 12px; }
  .feed-row.offline .op { color: var(--accent); }
  .feed-row.failed .op { color: var(--error, #c62828); }
</style>
