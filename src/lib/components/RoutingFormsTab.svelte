<script>
  import { api } from '../api.js';
  import { getBookingPages, fetchBookingPages } from '../stores/bookingPages.svelte.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';
  import Dropdown from './Dropdown.svelte';
  import { tooltip } from '../actions/tooltip.js';

  let forms = $state([]);
  let loading = $state(true);
  let busy = $state(false);
  let err = $state('');
  let editing = $state(null); // form id being edited inline

  const pagesStore = getBookingPages();
  const pages = $derived(pagesStore.items);

  async function load() {
    loading = true; err = '';
    try {
      const res = await api('/api/routing-forms');
      if (res.ok) forms = res.forms || [];
      await fetchBookingPages();
    } catch (e) {
      err = e.message;
    } finally {
      loading = false;
    }
  }

  $effect(() => { load(); });

  async function createForm() {
    busy = true; err = '';
    try {
      const res = await api('/api/routing-forms', {
        method: 'POST',
        body: JSON.stringify({
          title: 'New routing form',
          questions: [{ id: `q-${Date.now()}`, label: 'What are you looking for?', fieldType: 'select', options: ['Option A', 'Option B'] }],
          rules: [],
        }),
      });
      if (res.ok) {
        forms = [res.form, ...forms];
        editing = res.form.id;
      } else err = res.error || 'Failed.';
    } finally { busy = false; }
  }

  function getEditing() {
    return forms.find(f => f.id === editing);
  }

  async function saveForm(f) {
    busy = true; err = '';
    try {
      const res = await api(`/api/routing-forms/${f.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: f.title,
          description: f.description,
          questions: f.questions,
          rules: f.rules,
          isActive: f.isActive,
        }),
      });
      if (res.ok) {
        forms = forms.map(x => x.id === f.id ? res.form : x);
        editing = null;
      } else err = res.error || 'Save failed.';
    } finally { busy = false; }
  }

  async function deleteForm(f) {
    if (!await confirmAction({ title: 'Delete routing form?', body: `"${f.title}" will be removed.`, confirmLabel: 'Delete', danger: true })) return;
    busy = true;
    try {
      await api(`/api/routing-forms/${f.id}`, { method: 'DELETE' });
      forms = forms.filter(x => x.id !== f.id);
      if (editing === f.id) editing = null;
    } finally { busy = false; }
  }

  function addQuestion(f) {
    f.questions = [...(f.questions || []), { id: `q-${Date.now()}`, label: 'New question', fieldType: 'text', options: [] }];
  }
  function removeQuestion(f, idx) {
    f.questions = f.questions.filter((_, i) => i !== idx);
  }
  function addRule(f) {
    f.rules = [...(f.rules || []), { questionId: f.questions?.[0]?.id || '', equals: '', pageId: pages[0]?.id || '' }];
  }
  function removeRule(f, idx) {
    f.rules = f.rules.filter((_, i) => i !== idx);
  }

  function publicUrl(slug) { return `${window.location.origin}/book/form/${slug}`; }
  function copy(text) { try { navigator.clipboard.writeText(text); } catch {} }
</script>

<div class="forms-tab">
  <p class="help-text">
    Routing forms ask invitees a few questions, then route them to the right booking page based on their answers.
    Public URL: <code>/book/form/&lt;slug&gt;</code>
  </p>

  {#if err}<div class="error-box">{err}</div>{/if}

  <div class="row-end">
    <button class="primary-btn" onclick={createForm} disabled={busy}>+ New routing form</button>
  </div>

  {#if loading}
    <p class="help-text">Loading…</p>
  {:else if forms.length === 0}
    <p class="help-text">No routing forms yet.</p>
  {:else}
    {#each forms as f (f.id)}
      <div class="form-card" class:editing={editing === f.id}>
        <div class="form-header">
          <div class="form-title">
            {#if editing === f.id}
              <input class="title-input" type="text" bind:value={f.title} />
            {:else}
              <strong>{f.title}</strong>
            {/if}
            <span class="form-meta">/{f.slug} · {(f.questions || []).length} question{(f.questions || []).length === 1 ? '' : 's'} · {(f.rules || []).length} rule{(f.rules || []).length === 1 ? '' : 's'}</span>
          </div>
          <div class="form-actions">
            <button class="ghost-btn" onclick={() => copy(publicUrl(f.slug))} use:tooltip={'Copy public URL'}>Copy link</button>
            <a class="ghost-btn" href={publicUrl(f.slug)} target="_blank" rel="noopener">Open ↗</a>
            {#if editing === f.id}
              <button class="ghost-btn" onclick={() => editing = null}>Cancel</button>
              <button class="primary-btn small" onclick={() => saveForm(f)} disabled={busy}>Save</button>
            {:else}
              <button class="ghost-btn" onclick={() => editing = f.id}>Edit</button>
            {/if}
            <button class="ghost-btn danger" onclick={() => deleteForm(f)} disabled={busy}>Delete</button>
          </div>
        </div>

        {#if editing === f.id}
          <div class="form-body">
            <label class="field full">
              <span>Description</span>
              <textarea rows="2" bind:value={f.description} placeholder="What this form is for"></textarea>
            </label>
            <label class="field toggle">
              <input type="checkbox" bind:checked={f.isActive} />
              <span>Active (publicly accessible)</span>
            </label>

            <h4 class="section-h">Questions</h4>
            {#each f.questions || [] as q, idx (q.id || idx)}
              <div class="sub-card">
                <div class="grid">
                  <label class="field"><span>Question ID</span><input type="text" bind:value={q.id} placeholder="q1" /></label>
                  <label class="field"><span>Field type</span>
                    <Dropdown
                      bind:value={q.fieldType}
                      ariaLabel="Field type"
                      options={[
                        { value: 'text', label: 'Short text' },
                        { value: 'textarea', label: 'Long text' },
                        { value: 'select', label: 'Dropdown' },
                      ]}
                    />
                  </label>
                  <label class="field full"><span>Label</span><input type="text" bind:value={q.label} /></label>
                  {#if q.fieldType === 'select'}
                    <label class="field full"><span>Options (one per line)</span>
                      <textarea rows="3" value={Array.isArray(q.options) ? q.options.join('\n') : ''} oninput={(e) => q.options = e.target.value.split('\n').map(s => s.trim()).filter(Boolean)}></textarea>
                    </label>
                  {/if}
                </div>
                <div class="sub-actions">
                  <button class="ghost-btn danger" onclick={() => removeQuestion(f, idx)}>Remove</button>
                </div>
              </div>
            {/each}
            <button class="ghost-btn add" onclick={() => addQuestion(f)}>+ Add question</button>

            <h4 class="section-h">Routing rules</h4>
            <p class="help-text">If <em>question</em> equals <em>value</em>, send invitee to <em>booking page</em>. First matching rule wins.</p>
            {#each f.rules || [] as r, idx (idx)}
              <div class="rule-row">
                <div class="rule-dd">
                  <Dropdown
                    bind:value={r.questionId}
                    ariaLabel="Question"
                    options={(f.questions || []).map(q => ({ value: q.id, label: q.label }))}
                  />
                </div>
                <span class="op">equals</span>
                <input type="text" bind:value={r.equals} placeholder="answer value" />
                <span class="op">→</span>
                <div class="rule-dd">
                  <Dropdown
                    bind:value={r.pageId}
                    ariaLabel="Booking page"
                    options={pages.map(p => ({ value: p.id, label: p.title }))}
                  />
                </div>
                <button class="ghost-btn icon-only danger" onclick={() => removeRule(f, idx)} aria-label="Remove rule">×</button>
              </div>
            {/each}
            <button class="ghost-btn add" onclick={() => addRule(f)} disabled={(f.questions || []).length === 0 || pages.length === 0}>+ Add rule</button>
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .forms-tab { display: flex; flex-direction: column; gap: 12px; }
  .help-text { color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
  .help-text code { font-family: var(--font-mono, monospace); font-size: 12px; padding: 1px 4px; background: var(--surface-active); border-radius: 4px; }
  .row-end { display: flex; justify-content: flex-end; }
  .form-card { border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 12px; background: var(--surface); }
  .form-card.editing { border-color: var(--accent); }
  .form-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .form-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .form-meta { font-size: 11px; color: var(--text-tertiary); }
  .title-input { padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text-primary); font-size: 14px; font-weight: 600; }
  .form-actions { display: flex; gap: 6px; }
  .form-body { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; margin-top: 12px; border-top: 1px solid var(--border-light); }
  .section-h { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); margin: 8px 0 0 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); }
  .field.full { grid-column: 1 / -1; }
  .field.toggle { flex-direction: row; align-items: center; gap: 6px; }
  .field input, .field textarea, .field select {
    padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm);
    background: var(--surface); color: var(--text-primary); font-size: 13px;
    font-family: inherit;
  }
  .sub-card { border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 10px; background: var(--bg-secondary); }
  .sub-actions { display: flex; justify-content: flex-end; margin-top: 6px; }
  .rule-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .rule-dd { width: 160px; flex-shrink: 0; }
  .rule-row select, .rule-row input {
    padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm);
    background: var(--surface); color: var(--text-primary); font-size: 13px;
  }
  .rule-row .op { color: var(--text-tertiary); font-size: 12px; }
  .ghost-btn { padding: 4px 10px; border: 1px solid var(--border); background: var(--surface); border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; color: var(--text-primary); text-decoration: none; display: inline-flex; align-items: center; }
  .ghost-btn:hover { background: var(--surface-hover); }
  .ghost-btn.danger { color: var(--danger, #ef4444); }
  .ghost-btn.icon-only { padding: 2px 8px; }
  .ghost-btn.add { align-self: flex-start; }
  .primary-btn { padding: 6px 12px; border: none; background: var(--accent); color: white; border-radius: var(--radius-sm); font-size: 13px; cursor: pointer; font-weight: 500; }
  .primary-btn.small { padding: 4px 10px; font-size: 12px; }
  .primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .error-box { padding: 8px 12px; background: rgba(239, 68, 68, 0.1); color: var(--danger, #ef4444); border-radius: var(--radius-sm); font-size: 13px; }
</style>
