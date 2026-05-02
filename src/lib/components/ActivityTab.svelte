<script>
  // Activity feed — cross-resource recent revisions for this user.
  // Surfaces every notable change to notes/tasks (etc.) with a relative
  // timestamp and what changed. Per-resource history with restore lives
  // on the resource's own viewer (note editor → "Version history").

  import { api } from '../api.js';

  let items = $state([]);
  let loading = $state(true);

  async function load() {
    loading = true;
    const r = await api('/api/activity?limit=200');
    items = r?.ok ? (r.items || []) : [];
    loading = false;
  }
  $effect(() => { load(); });

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
        <li class="feed-row">
          <span class="when" title={item.createdAt}>{relativeWhen(item.createdAt)}</span>
          <span class="op">{OP_LABELS[item.op] || item.op}</span>
          <span class="kind">{RES_LABELS[item.resource] || item.resource}</span>
          {#if item.label}
            <span class="label">"{item.label}"</span>
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
  .label { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
