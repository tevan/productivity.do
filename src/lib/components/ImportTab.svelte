<script>
  // Import tab — drop a file, see a preview, confirm to write.
  //
  // Supported formats: ICS (calendar), CSV (events or tasks), Todoist
  // backup JSON, plain markdown / text (notes).

  import { confirmAction } from '../utils/confirmModal.svelte.js';

  let fileInput;
  let dragOver = $state(false);
  let busy = $state(false);
  let preview = $state(null);
  let error = $state(null);
  let successCounts = $state(null);
  let pendingFile = null;

  async function pick(file) {
    error = null;
    successCounts = null;
    preview = null;
    if (!file) return;
    pendingFile = file;
    busy = true;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/import?dryRun=1', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Could not parse file');
      preview = json;
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }

  async function commit() {
    if (!pendingFile) return;
    const sum = preview?.counts || {};
    const total = (sum.events || 0) + (sum.tasks || 0) + (sum.notes || 0) + (sum.projects || 0);
    const ok = await confirmAction({
      title: 'Import these records?',
      body: `This will add ${total} record${total === 1 ? '' : 's'} to your native calendar/tasks/notes. The file's source data is not modified.`,
      confirmLabel: 'Import',
    });
    if (!ok) return;
    busy = true;
    try {
      const fd = new FormData();
      fd.append('file', pendingFile);
      const res = await fetch('/api/import', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Import failed');
      successCounts = json.counts;
      preview = null;
      pendingFile = null;
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }

  function onDrop(e) {
    e.preventDefault();
    dragOver = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) pick(f);
  }
</script>

<div class="import">
  <p class="help-text">
    Bring in calendar events, tasks, and notes from Google Calendar
    (.ics), Todoist (JSON backup), spreadsheets (.csv), or markdown notes
    (.md / .txt). All imports land in your native storage — they survive
    even if you later disconnect any integration.
  </p>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="drop-zone"
    class:dragover={dragOver}
    ondragover={(e) => { e.preventDefault(); dragOver = true; }}
    ondragleave={() => dragOver = false}
    ondrop={onDrop}
    onclick={() => fileInput?.click()}
  >
    <input
      type="file"
      bind:this={fileInput}
      accept=".ics,.csv,.json,.md,.markdown,.txt"
      style="display:none"
      onchange={(e) => pick(e.currentTarget.files?.[0])}
    />
    <div>
      <strong>Drop a file</strong> or click to choose
      <div class="muted">Accepted: .ics, .csv, .json (Todoist backup), .md, .txt</div>
    </div>
  </div>

  {#if busy}
    <div class="loading">Working…</div>
  {/if}

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if preview}
    <div class="preview">
      <h4>Preview</h4>
      <p class="muted">Detected format: <code>{preview.format}</code></p>
      <ul class="counts">
        <li><b>{preview.counts.events}</b> events</li>
        <li><b>{preview.counts.tasks}</b> tasks</li>
        <li><b>{preview.counts.projects || 0}</b> projects</li>
        <li><b>{preview.counts.notes}</b> notes</li>
      </ul>
      {#if preview.preview?.events?.length}
        <details><summary>First few events</summary>
          <ul>{#each preview.preview.events as e}<li>{e.summary} — {e.start}</li>{/each}</ul>
        </details>
      {/if}
      {#if preview.preview?.tasks?.length}
        <details><summary>First few tasks</summary>
          <ul>{#each preview.preview.tasks as t}<li>{t.content}{t.dueDate ? ` (${t.dueDate})` : ''}</li>{/each}</ul>
        </details>
      {/if}
      {#if preview.preview?.notes?.length}
        <details><summary>First few notes</summary>
          <ul>{#each preview.preview.notes as n}<li>{n.title}</li>{/each}</ul>
        </details>
      {/if}
      <div class="actions">
        <button class="primary" onclick={commit} disabled={busy}>Import</button>
        <button onclick={() => { preview = null; pendingFile = null; }}>Cancel</button>
      </div>
    </div>
  {/if}

  {#if successCounts}
    <div class="success">
      Imported: {successCounts.events || 0} events, {successCounts.tasks || 0} tasks,
      {successCounts.projects || 0} projects, {successCounts.notes || 0} notes.
    </div>
  {/if}
</div>

<style>
  .import { display: flex; flex-direction: column; gap: 16px; }
  .help-text { font-size: 13px; color: var(--text-secondary); margin: 0; line-height: 1.5; }
  .drop-zone {
    border: 2px dashed var(--border);
    border-radius: var(--radius-md);
    padding: 28px 16px;
    text-align: center;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
    color: var(--text-secondary);
    font-size: 13px;
  }
  .drop-zone:hover, .drop-zone.dragover {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 4%, transparent);
  }
  .muted { color: var(--text-tertiary); font-size: 11px; margin-top: 4px; }
  .loading { color: var(--text-tertiary); font-size: 13px; }
  .error {
    color: var(--error);
    background: color-mix(in srgb, var(--error) 10%, transparent);
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 13px;
  }
  .preview {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 14px;
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .preview h4 { margin: 0; font-size: 13px; }
  .preview code { background: var(--surface-hover); padding: 1px 5px; border-radius: 3px; font-size: 11px; }
  .counts { list-style: none; padding: 0; margin: 0; display: flex; gap: 14px; font-size: 13px; }
  .actions { display: flex; gap: 8px; margin-top: 6px; }
  .actions button {
    padding: 5px 12px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    font-size: 12px;
    cursor: pointer;
  }
  .actions .primary { background: var(--accent); color: white; border-color: var(--accent); }
  .actions .primary:hover { background: var(--accent-hover); }
  .actions button:disabled { opacity: 0.5; cursor: not-allowed; }
  details summary { cursor: pointer; font-size: 12px; color: var(--text-secondary); }
  details ul { margin: 6px 0 6px 18px; font-size: 12px; color: var(--text-primary); }
  .success {
    color: #047857;
    background: color-mix(in srgb, #10b981 12%, transparent);
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 13px;
  }
  :global(html.dark) .success { color: #6ee7b7; }
</style>
