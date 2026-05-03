<!--
  AppearsInPanel — shows every event/task/note that references a file.

  Props:
    fileId : number  (required)
    onclose : () => void  (optional — called when user dismisses the panel)

  Behavior:
    - Fetches /api/files/:id/appears-in on mount.
    - Groups results by source_type (events / tasks / notes).
    - Each row shows the resource label + a contextual timestamp.
    - Clicking a note row navigates to it (notes have an internal route).
      Tasks/events show the label only — opening them from a file detail
      view would need cross-store coordination we don't have wired yet.
    - "Missing" rows (resource was deleted but link survived) render with a
      muted strikethrough so the user notices and can detach if desired.
-->
<script>
  import { api } from '../api.js';
  import { onMount } from 'svelte';

  let { fileId, onclose = () => {} } = $props();

  let loading = $state(true);
  let error = $state(null);
  let links = $state([]);

  onMount(async () => {
    try {
      const r = await api(`/api/files/${fileId}/appears-in`);
      if (!r?.ok) {
        error = r?.error || 'Could not load';
      } else {
        links = r.links;
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  const grouped = $derived.by(() => {
    const out = { event: [], task: [], note: [] };
    for (const l of links) {
      if (out[l.sourceType]) out[l.sourceType].push(l);
    }
    return out;
  });

  function fmtTimestamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: sameYear ? undefined : 'numeric',
    });
  }

  function iconFor(sourceType) {
    if (sourceType === 'event') return '📅';
    if (sourceType === 'task') return '✓';
    if (sourceType === 'note') return '📝';
    return '·';
  }

  function navigate(link) {
    if (!link.url) return;
    // Notes are SPA-routable. Tasks/events would need a store edit-trigger
    // we don't expose from this panel today.
    window.history.pushState({}, '', link.url);
    window.dispatchEvent(new PopStateEvent('popstate'));
    onclose();
  }
</script>

<div class="panel" role="region" aria-label="Appears in">
  <div class="head">
    <span class="title">Appears in</span>
    <button type="button" class="close" onclick={onclose} aria-label="Close">×</button>
  </div>

  {#if loading}
    <div class="state">Loading…</div>
  {:else if error}
    <div class="state error">{error}</div>
  {:else if links.length === 0}
    <div class="state">Not attached to anything else.</div>
  {:else}
    {#each ['event', 'task', 'note'] as kind}
      {#if grouped[kind].length > 0}
        <div class="group">
          <div class="group-head">{kind}s · {grouped[kind].length}</div>
          <ul class="list">
            {#each grouped[kind] as link}
              <li class="row" class:missing={link.missing} class:archived={link.archived} class:completed={link.completed}>
                <span class="icon">{iconFor(link.sourceType)}</span>
                {#if link.url && !link.missing}
                  <button type="button" class="label as-link" onclick={() => navigate(link)}>
                    {link.label || `(${link.sourceType} ${link.sourceId})`}
                  </button>
                {:else}
                  <span class="label">
                    {link.missing ? `(deleted ${link.sourceType})` : (link.label || `(${link.sourceType} ${link.sourceId})`)}
                  </span>
                {/if}
                {#if link.timestamp}
                  <span class="ts">{fmtTimestamp(link.timestamp)}</span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .panel {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    margin-top: 6px;
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--surface-hover);
    border-bottom: 1px solid var(--border-light, var(--border));
  }
  .title {
    font-size: 12px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
  }
  .close {
    width: 20px;
    height: 20px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }
  .close:hover {
    background: var(--surface);
    color: var(--text-primary);
  }
  .state {
    padding: 10px 12px;
    font-size: 12px;
    color: var(--text-tertiary, var(--text-secondary));
  }
  .state.error { color: var(--error, #ef4444); }
  .group { padding: 4px 0; }
  .group + .group { border-top: 1px solid var(--border-light, var(--border)); }
  .group-head {
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary, var(--text-secondary));
    padding: 4px 12px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: grid;
    grid-template-columns: 18px 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 4px 12px;
    font-size: 13px;
  }
  .row:hover { background: var(--surface-hover); }
  .row.missing { opacity: 0.55; }
  .row.archived .label, .row.completed .label { text-decoration: line-through; }
  .icon {
    font-size: 12px;
    color: var(--text-secondary);
    text-align: center;
  }
  .label {
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .label.as-link {
    border: none;
    background: transparent;
    padding: 0;
    cursor: pointer;
    font: inherit;
  }
  .label.as-link:hover {
    color: var(--accent);
    text-decoration: underline;
  }
  .ts {
    color: var(--text-tertiary, var(--text-secondary));
    font-size: 11px;
    white-space: nowrap;
  }
</style>
