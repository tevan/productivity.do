<script>
  import { api } from '../api.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';

  let keys = $state([]);
  let scopes = $state([]);
  // Group scopes by resource for a friendlier picker. Headers let the user
  // pick "events read+write" without scanning a long flat list of pills.
  const scopeGroups = $derived.by(() => {
    const groups = [
      { label: 'Events',     match: /events|calendars/ },
      { label: 'Tasks',      match: /tasks/ },
      { label: 'Bookings',   match: /bookings/ },
      { label: 'Webhooks',   match: /webhooks/ },
      { label: 'Admin',      match: /^admin$/ },
    ];
    const seen = new Set();
    const out = [];
    for (const g of groups) {
      const items = scopes.filter(s => g.match.test(s) && !seen.has(s));
      items.forEach(i => seen.add(i));
      if (items.length) out.push({ label: g.label, items });
    }
    const rest = scopes.filter(s => !seen.has(s));
    if (rest.length) out.push({ label: 'Other', items: rest });
    return out;
  });
  let subs = $state([]);
  let loading = $state(true);
  let busy = $state(false);
  let err = $state('');

  let newKeyName = $state('');
  let newKeyScopes = $state(['read:bookings']);
  let lastNewKey = $state(null);

  let newWebhookUrl = $state('');
  let newWebhookEvents = $state('booking.created');
  let lastNewSecret = $state(null);

  const EVENT_OPTIONS = [
    'booking.created',
    'booking.canceled',
    'booking.rescheduled',
    'task.created',
    'task.updated',
    'task.completed',
    'event.created',
    'event.updated',
    'event.deleted',
    '*',
  ];

  async function load() {
    loading = true; err = '';
    try {
      const [a, b] = await Promise.all([
        api('/api/api-keys'),
        api('/api/webhooks'),
      ]);
      if (a.ok) { keys = a.keys || []; scopes = a.scopes || []; }
      if (b.ok) { subs = b.subscriptions || []; }
    } catch (e) {
      err = e.message;
    } finally {
      loading = false;
    }
  }

  $effect(() => { load(); });

  // When the user checks "Admin (full access)" we auto-select every other
  // scope so the UI matches what admin actually grants. We stash whatever
  // they had selected so unchecking admin restores their pre-admin choice
  // instead of dropping them back to nothing.
  let scopesBeforeAdmin = $state(null); // null = no stash; [] = stashed empty
  function toggleScope(scope) {
    const turningOn = !newKeyScopes.includes(scope);
    if (scope === 'admin') {
      if (turningOn) {
        scopesBeforeAdmin = newKeyScopes.filter(s => s !== 'admin');
        newKeyScopes = [...scopes];
      } else {
        newKeyScopes = scopesBeforeAdmin || [];
        scopesBeforeAdmin = null;
      }
      return;
    }
    newKeyScopes = turningOn
      ? [...newKeyScopes, scope]
      : newKeyScopes.filter(s => s !== scope);
  }

  async function createKey() {
    if (newKeyScopes.length === 0) { err = 'Pick at least one scope.'; return; }
    busy = true; err = '';
    try {
      const res = await api('/api/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: newKeyName || 'API key', scopes: newKeyScopes }),
      });
      if (res.ok) {
        lastNewKey = res.key;
        newKeyName = '';
        await load();
      } else {
        err = res.error || 'Failed.';
      }
    } finally { busy = false; }
  }
  async function rotateKey(id) {
    if (!await confirmAction({
      title: 'Rotate API key?',
      body: 'Issues a new secret. The old secret keeps working for 7 days so you can redeploy without downtime, then auto-revokes.',
      confirmLabel: 'Rotate',
    })) return;
    busy = true;
    try {
      const res = await api(`/api/api-keys/${id}/rotate`, { method: 'POST' });
      if (res?.ok && res.key?.key) {
        // The fresh secret is only visible right now — surface it the
        // same way createKey() does.
        newKey = res.key;
        await loadKeys();
      }
    } finally { busy = false; }
  }

  async function revokeKey(id) {
    if (!await confirmAction({ title: 'Revoke API key?', body: 'It will stop working immediately. You can\'t undo this.', confirmLabel: 'Revoke', danger: true })) return;
    busy = true;
    try {
      await api(`/api/api-keys/${id}/revoke`, { method: 'POST' });
      await load();
    } finally { busy = false; }
  }
  async function deleteKey(id) {
    if (!await confirmAction({ title: 'Delete API key?', body: 'This is permanent.', confirmLabel: 'Delete', danger: true })) return;
    busy = true;
    try {
      await api(`/api/api-keys/${id}`, { method: 'DELETE' });
      await load();
    } finally { busy = false; }
  }

  async function createWebhook() {
    if (!newWebhookUrl) { err = 'URL is required.'; return; }
    const events = newWebhookEvents.split(',').map(s => s.trim()).filter(Boolean);
    busy = true; err = '';
    try {
      const res = await api('/api/webhooks', {
        method: 'POST',
        body: JSON.stringify({ url: newWebhookUrl, events }),
      });
      if (res.ok) {
        lastNewSecret = res.subscription.secret;
        newWebhookUrl = '';
        await load();
      } else {
        err = res.error || 'Failed.';
      }
    } finally { busy = false; }
  }
  async function toggleWebhook(s) {
    busy = true;
    try {
      await api(`/api/webhooks/${s.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !s.isActive }),
      });
      await load();
    } finally { busy = false; }
  }
  async function rotateSecret(id) {
    if (!await confirmAction({ title: 'Rotate signing secret?', body: 'The old secret stops verifying immediately. Update your receiver before rotating.', confirmLabel: 'Rotate', danger: true })) return;
    busy = true;
    try {
      const res = await api(`/api/webhooks/${id}/rotate-secret`, { method: 'POST' });
      if (res.ok) lastNewSecret = res.secret;
      await load();
    } finally { busy = false; }
  }
  async function deleteWebhook(id) {
    if (!await confirmAction({ title: 'Delete webhook subscription?', confirmLabel: 'Delete', danger: true })) return;
    busy = true;
    try {
      await api(`/api/webhooks/${id}`, { method: 'DELETE' });
      await load();
    } finally { busy = false; }
  }

  function copy(text) { try { navigator.clipboard.writeText(text); } catch {} }
  function fmtDate(s) { return s ? new Date(s).toLocaleString() : '—'; }
</script>

<div class="dev-tab">
  <p class="help-text">
    Generate API keys to access the public API at <code>/api/v1/*</code>, or subscribe webhooks to receive events.
    Full reference at <a href="/developers" target="_blank" rel="noopener">/developers</a>.
  </p>

  {#if err}<div class="error-box">{err}</div>{/if}

  <h3 class="section-h">API keys</h3>
  <div class="card">
    <div class="grid">
      <label class="field"><span>Key name</span><input type="text" bind:value={newKeyName} placeholder="e.g. Zapier integration" /></label>
    </div>
    <div class="scope-groups">
      {#each scopeGroups as group}
        <div class="scope-group">
          <div class="scope-group-h">{group.label}</div>
          <div class="scope-group-pills">
            {#each group.items as s}
              <label class="scope-pill" class:scope-admin={s === 'admin'}>
                <input type="checkbox" checked={newKeyScopes.includes(s)} onchange={() => toggleScope(s)} />
                <span>{s === 'admin' ? 'Admin (full access)' : s.replace(/^(read|write):(.+)$/, (_, verb, res) => `${verb[0].toUpperCase()}${verb.slice(1)} ${res}`)}</span>
              </label>
            {/each}
          </div>
        </div>
      {/each}
    </div>
    <div class="row-end">
      <button class="primary-btn" onclick={createKey} disabled={busy}>{busy ? '…' : 'Create key'}</button>
    </div>
    {#if lastNewKey}
      <div class="reveal">
        <strong>Save this key — it will not be shown again:</strong>
        <code class="secret">{lastNewKey.key}</code>
        <button class="ghost-btn" onclick={() => copy(lastNewKey.key)}>Copy</button>
        <button class="ghost-btn" onclick={() => lastNewKey = null}>Dismiss</button>
      </div>
    {/if}
  </div>

  {#if loading}
    <p class="help-text">Loading…</p>
  {:else if keys.length === 0}
    <p class="help-text">No API keys yet.</p>
  {:else}
    <table class="dev-table">
      <thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th>Status</th><th></th></tr></thead>
      <tbody>
        {#each keys as k}
          <tr class:revoked={!!k.revokedAt}>
            <td>{k.name}</td>
            <td><code>pk_live_{k.prefix}…</code></td>
            <td><span class="scopes">{(k.scopes || []).join(', ')}</span></td>
            <td title={k.lastUsedIp || k.lastUsedUserAgent ? `${k.lastUsedIp || '?'} · ${k.lastUsedUserAgent || ''}` : ''}>
              {fmtDate(k.lastUsedAt)}
            </td>
            <td>
              {#if k.revokedAt}
                Revoked
              {:else if k.rotatedAt}
                Rotating (old)
              {:else}
                Active
              {/if}
            </td>
            <td class="row-actions">
              {#if !k.revokedAt && !k.rotatedAt}
                <button class="ghost-btn" onclick={() => rotateKey(k.id)} disabled={busy}>Rotate</button>
                <button class="ghost-btn" onclick={() => revokeKey(k.id)} disabled={busy}>Revoke</button>
              {:else if !k.revokedAt}
                <button class="ghost-btn" onclick={() => revokeKey(k.id)} disabled={busy}>Revoke now</button>
              {/if}
              <button class="ghost-btn danger" onclick={() => deleteKey(k.id)} disabled={busy}>Delete</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <h3 class="section-h">Webhook subscriptions</h3>
  <div class="card">
    <div class="grid">
      <label class="field full"><span>Webhook URL</span><input type="url" bind:value={newWebhookUrl} placeholder="https://your-server.com/hooks/productivity" /></label>
      <label class="field full"><span>Events (comma separated, or <code>*</code> for all)</span>
        <input type="text" bind:value={newWebhookEvents} list="event-options" placeholder="booking.created, booking.canceled" />
        <datalist id="event-options">
          {#each EVENT_OPTIONS as e}<option value={e}></option>{/each}
        </datalist>
      </label>
    </div>
    <div class="row-end">
      <button class="primary-btn" onclick={createWebhook} disabled={busy}>{busy ? '…' : 'Subscribe'}</button>
    </div>
    {#if lastNewSecret}
      <div class="reveal">
        <strong>Signing secret — save it now:</strong>
        <code class="secret">{lastNewSecret}</code>
        <button class="ghost-btn" onclick={() => copy(lastNewSecret)}>Copy</button>
        <button class="ghost-btn" onclick={() => lastNewSecret = null}>Dismiss</button>
      </div>
    {/if}
  </div>

  {#if loading}
    <p class="help-text">Loading…</p>
  {:else if subs.length === 0}
    <p class="help-text">No webhook subscriptions yet.</p>
  {:else}
    <table class="dev-table">
      <thead><tr><th>URL</th><th>Events</th><th>Last delivery</th><th>Status</th><th></th></tr></thead>
      <tbody>
        {#each subs as s}
          <tr class:inactive={!s.isActive}>
            <td><code>{s.url}</code></td>
            <td><span class="scopes">{(s.events || []).join(', ')}</span></td>
            <td>{fmtDate(s.lastDeliveryAt)} {s.lastDeliveryStatus ? `· ${s.lastDeliveryStatus}` : ''}</td>
            <td>{s.isActive ? 'Active' : 'Paused'}</td>
            <td class="row-actions">
              <button class="ghost-btn" onclick={() => toggleWebhook(s)} disabled={busy}>{s.isActive ? 'Pause' : 'Resume'}</button>
              <button class="ghost-btn" onclick={() => rotateSecret(s.id)} disabled={busy}>Rotate secret</button>
              <button class="ghost-btn danger" onclick={() => deleteWebhook(s.id)} disabled={busy}>Delete</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .dev-tab { display: flex; flex-direction: column; gap: 16px; }
  .help-text { color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
  .help-text code { font-family: var(--font-mono, monospace); font-size: 12px; padding: 1px 4px; background: var(--surface-active); border-radius: 4px; }
  .help-text a { color: var(--accent); }
  .section-h { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); margin-top: 8px; }
  .card { border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 12px; background: var(--surface); display: flex; flex-direction: column; gap: 10px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); }
  .field.full { grid-column: 1 / -1; }
  .field input { padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text-primary); font-size: 13px; }
  .scope-groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin: 8px 0 12px;
  }
  .scope-group {
    padding: 10px 12px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .scope-group-h {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
    margin-bottom: 6px;
  }
  .scope-group-pills {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .scope-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    background: transparent;
    font-size: 12px;
    cursor: pointer;
    color: var(--text-secondary);
  }
  .scope-pill:hover { background: var(--surface-hover); color: var(--text-primary); }
  .scope-pill input { cursor: pointer; }
  .scope-pill.scope-admin {
    /* Admin = wildcard scope (full read/write across all resources). Visually
       distinguished but not alarming — softer amber treatment, not error red. */
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .scope-pill.scope-admin span {
    color: var(--text-primary);
    font-weight: 500;
  }
  .scope-pill.scope-admin::before {
    content: '★';
    color: var(--accent);
    font-size: 10px;
    margin-right: 2px;
  }
  .row-end {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--border-light);
  }
  .reveal { display: flex; align-items: center; gap: 8px; padding: 10px; background: var(--accent-soft, rgba(99, 102, 241, 0.08)); border-radius: var(--radius-sm); flex-wrap: wrap; font-size: 13px; }
  .reveal .secret { flex: 1; font-family: var(--font-mono, monospace); font-size: 12px; word-break: break-all; padding: 4px 8px; background: var(--surface); border-radius: 4px; }
  .dev-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .dev-table th { text-align: left; padding: 6px 8px; color: var(--text-tertiary); font-weight: 500; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--border-light); }
  .dev-table td { padding: 8px; border-bottom: 1px solid var(--border-light); vertical-align: top; }
  .dev-table tr.revoked, .dev-table tr.inactive { opacity: 0.5; }
  .scopes { font-family: var(--font-mono, monospace); font-size: 11px; color: var(--text-secondary); }
  .row-actions { display: flex; gap: 4px; justify-content: flex-end; }
  .ghost-btn { padding: 4px 8px; border: 1px solid var(--border); background: var(--surface); border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; color: var(--text-primary); }
  .ghost-btn:hover { background: var(--surface-hover); }
  .ghost-btn.danger { color: var(--danger, #ef4444); }
  .primary-btn { padding: 6px 12px; border: none; background: var(--accent); color: white; border-radius: var(--radius-sm); font-size: 13px; cursor: pointer; font-weight: 500; }
  .primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .error-box { padding: 8px 12px; background: rgba(239, 68, 68, 0.1); color: var(--danger, #ef4444); border-radius: var(--radius-sm); font-size: 13px; }
  code { font-family: var(--font-mono, monospace); font-size: 12px; }
</style>
