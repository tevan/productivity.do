<script>
  import { api } from '../api.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';

  let templates = $state([]);
  let editing = $state(null);

  async function load() {
    const r = await api('/api/event-templates');
    if (r?.ok) templates = r.templates;
  }
  load();

  function newTemplate() {
    editing = { id: null, name: '', summary: '', description: '', location: '', durationMinutes: 30 };
  }

  function editTemplate(t) {
    editing = { ...t };
  }

  async function save() {
    const path = editing.id ? `/api/event-templates/${editing.id}` : '/api/event-templates';
    const method = editing.id ? 'PUT' : 'POST';
    await api(path, { method, body: JSON.stringify(editing) });
    editing = null;
    load();
  }

  async function remove(id) {
    if (!await confirmAction({ title: 'Delete template?', confirmLabel: 'Delete', danger: true })) return;
    await api(`/api/event-templates/${id}`, { method: 'DELETE' });
    load();
  }
</script>

<div class="tpl-editor">
  <p class="hint">Save events you create often (e.g. "1:1 with X", "weekly review") and reuse them in one click.</p>

  {#if !editing}
    {#each templates as t (t.id)}
      <div class="tpl-row">
        <div class="tpl-info">
          <div class="tpl-name">{t.name}</div>
          <div class="tpl-meta">{t.durationMinutes} min{#if t.location} · {t.location}{/if}</div>
        </div>
        <button class="btn-sm" onclick={() => editTemplate(t)}>Edit</button>
        <button class="btn-sm danger" onclick={() => remove(t.id)}>×</button>
      </div>
    {:else}
      <div class="empty">No templates yet.</div>
    {/each}
    <button class="btn-primary" onclick={newTemplate}>+ New template</button>
  {:else}
    <div class="form">
      <label>Name <input bind:value={editing.name} placeholder="1:1 with Sam" /></label>
      <label>Title <input bind:value={editing.summary} placeholder="1:1" /></label>
      <label>Location <input bind:value={editing.location} placeholder="Zoom / Office / etc." /></label>
      <label>Duration (min) <input type="number" min="5" max="480" step="5" bind:value={editing.durationMinutes} /></label>
      <label>Description <textarea bind:value={editing.description} rows="3"></textarea></label>
      <div class="form-actions">
        <button class="btn-secondary" onclick={() => editing = null}>Cancel</button>
        <button class="btn-primary" onclick={save} disabled={!editing.name}>Save</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .tpl-editor { display: flex; flex-direction: column; gap: 10px; }
  .hint { font-size: 12px; color: var(--text-secondary); margin: 0; }
  .tpl-row { display: flex; align-items: center; gap: 10px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; }
  .tpl-info { flex: 1; min-width: 0; }
  .tpl-name { font-size: 13px; font-weight: 500; }
  .tpl-meta { font-size: 11px; color: var(--text-tertiary); }
  .empty { font-size: 12px; color: var(--text-tertiary); padding: 8px 0; }
  .form { display: flex; flex-direction: column; gap: 8px; }
  .form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); }
  .form input, .form textarea { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text-primary); font-size: 13px; }
  .form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
  .btn-sm, button { padding: 4px 10px; font-size: 12px; border: 1px solid var(--border); background: var(--bg); border-radius: 6px; cursor: pointer; color: var(--text-primary); }
  .btn-sm.danger, button.danger { color: var(--error); border-color: var(--error); }
  .btn-primary { background: var(--accent); color: white; border-color: var(--accent); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
