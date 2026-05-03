<!--
  FilePicker — drop, paste, click-to-upload + list of attached files.

  Props:
    sourceType : 'event' | 'task' | 'note'  (required)
    sourceId   : string                     (required; nullable while editor
                                             is in "draft" state — see below)

  Behavior:
    - When sourceId is set, attaching uploads with sourceType+sourceId so the
      file is linked in one round-trip.
    - When sourceId is null (e.g., the editor hasn't created the row yet),
      files upload-but-don't-link. The parent should call attachPending()
      after it knows its id.

  Drop zones, paste handler, and the rendered list all live in this single
  component — drop it into any editor.
-->
<script>
  import { api } from '../api.js';
  import { showToast } from '../utils/toast.svelte.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';
  import AppearsInPanel from './AppearsInPanel.svelte';

  let {
    sourceType,
    sourceId = null,
    files = $bindable([]),
  } = $props();

  let dragging = $state(false);
  let uploading = $state(false);
  let pendingUploads = $state([]); // file objects uploaded before sourceId existed
  let appearsInOpenFor = $state(null); // file id whose appears-in panel is open

  // In-flight upload tracking. Each entry: {tempId, name, percent, xhr}.
  // tempId is a client-side stable key for the row; replaced by the server
  // file id after success.
  let inFlight = $state([]);
  let nextTempId = 0;

  // Re-fetch attachments whenever sourceId becomes known (or changes).
  $effect(() => {
    if (sourceId) loadAttached();
  });

  async function loadAttached() {
    if (!sourceId) return;
    const r = await api(`/api/files/by-source?sourceType=${sourceType}&sourceId=${encodeURIComponent(sourceId)}`);
    if (r?.ok) files = r.files;
  }

  function uploadOne(file) {
    // XHR (not fetch) because fetch lacks an upload-progress event hook.
    // Returns a promise + provides a cancel via inFlight entry.
    const tempId = ++nextTempId;
    const fd = new FormData();
    fd.append('file', file);
    if (sourceId) {
      fd.append('sourceType', sourceType);
      fd.append('sourceId', String(sourceId));
    }

    const xhr = new XMLHttpRequest();
    const entry = { tempId, name: file.name, percent: 0, xhr, error: null };
    inFlight = [...inFlight, entry];

    return new Promise((resolve) => {
      xhr.upload.addEventListener('progress', (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        // Trigger reactivity by replacing the array — direct mutation of
        // a $state-tracked object array element doesn't always re-render.
        inFlight = inFlight.map(x => x.tempId === tempId ? { ...x, percent: pct } : x);
      });

      xhr.addEventListener('load', () => {
        let json = null;
        try { json = JSON.parse(xhr.responseText); } catch {}
        inFlight = inFlight.filter(x => x.tempId !== tempId);
        if (xhr.status < 200 || xhr.status >= 300 || !json?.ok) {
          showToast({
            message: json?.error || `Upload failed (${xhr.status || 'no response'})`,
            kind: 'error',
          });
          resolve(null);
        } else {
          resolve(json.file);
        }
      });

      xhr.addEventListener('error', () => {
        inFlight = inFlight.filter(x => x.tempId !== tempId);
        showToast({ message: 'Upload failed (network error)', kind: 'error' });
        resolve(null);
      });

      xhr.addEventListener('abort', () => {
        inFlight = inFlight.filter(x => x.tempId !== tempId);
        // No toast for user-initiated cancel.
        resolve(null);
      });

      xhr.open('POST', '/api/files');
      xhr.withCredentials = true;
      xhr.send(fd);
    });
  }

  function cancelUpload(tempId) {
    const entry = inFlight.find(x => x.tempId === tempId);
    entry?.xhr?.abort();
  }

  async function uploadFiles(list) {
    if (!list?.length) return;
    uploading = true;
    try {
      for (const f of list) {
        const uploaded = await uploadOne(f);
        if (!uploaded) continue;
        if (sourceId) {
          files = [uploaded, ...files.filter(x => x.id !== uploaded.id)];
        } else {
          pendingUploads = [uploaded, ...pendingUploads];
        }
      }
    } finally {
      uploading = false;
    }
  }

  // Called by parent once sourceId is known (e.g., after note/task create).
  export async function attachPending(newSourceId) {
    if (!pendingUploads.length) return;
    for (const f of pendingUploads) {
      await api(`/api/files/${f.id}/links`, {
        method: 'POST',
        body: JSON.stringify({ sourceType, sourceId: String(newSourceId) }),
      });
    }
    files = [...pendingUploads, ...files];
    pendingUploads = [];
  }

  async function detach(file) {
    if (sourceId) {
      const r = await api(`/api/files/${file.id}/links`, {
        method: 'DELETE',
        body: JSON.stringify({ sourceType, sourceId: String(sourceId) }),
      });
      if (!r?.ok) {
        showToast({ message: 'Could not detach file', kind: 'error' });
        return;
      }
    } else {
      pendingUploads = pendingUploads.filter(f => f.id !== file.id);
    }
    files = files.filter(f => f.id !== file.id);
  }

  async function deleteFile(file) {
    const yes = await confirmAction({
      title: 'Delete file?',
      body: `"${file.originalName}" will be removed from every event, task, and note it's attached to. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!yes) return;
    const r = await api(`/api/files/${file.id}`, { method: 'DELETE' });
    if (!r?.ok) {
      showToast({ message: 'Could not delete file', kind: 'error' });
      return;
    }
    files = files.filter(f => f.id !== file.id);
    pendingUploads = pendingUploads.filter(f => f.id !== file.id);
  }

  // ---- Drag/drop ----
  function onDragOver(e) {
    e.preventDefault();
    dragging = true;
  }
  function onDragLeave() { dragging = false; }
  function onDrop(e) {
    e.preventDefault();
    dragging = false;
    const list = Array.from(e.dataTransfer?.files || []);
    if (list.length) uploadFiles(list);
  }

  // ---- Paste images from clipboard ----
  function onPaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const blobs = items
      .filter(i => i.kind === 'file')
      .map(i => i.getAsFile())
      .filter(Boolean);
    if (blobs.length) {
      e.preventDefault();
      uploadFiles(blobs);
    }
  }

  // ---- File input click ----
  let inputEl;
  function onPick() { inputEl?.click(); }
  function onPicked(e) {
    const list = Array.from(e.target?.files || []);
    if (list.length) uploadFiles(list);
    if (inputEl) inputEl.value = '';
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function isImage(file) { return file.mime?.startsWith('image/'); }

  const allFiles = $derived([...pendingUploads, ...files]);
</script>

<svelte:window onpaste={onPaste} />

<div
  class="picker"
  class:dragging
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  role="region"
  aria-label="Attached files"
>
  <div class="header">
    <span class="label">
      Files{allFiles.length ? ` (${allFiles.length})` : ''}
    </span>
    <button type="button" class="add" onclick={onPick} disabled={uploading}>
      {uploading ? 'Uploading…' : '+ Attach'}
    </button>
    <input
      type="file"
      multiple
      bind:this={inputEl}
      onchange={onPicked}
      style="display: none"
    />
  </div>

  {#if inFlight.length > 0}
    <ul class="progress-list">
      {#each inFlight as entry (entry.tempId)}
        <li class="progress-row">
          <span class="progress-name">{entry.name}</span>
          <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={entry.percent}>
            <div class="progress-fill" style="width: {entry.percent}%"></div>
          </div>
          <span class="progress-pct">{entry.percent}%</span>
          <button type="button" class="btn-icon" title="Cancel upload" onclick={() => cancelUpload(entry.tempId)}>×</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if allFiles.length === 0 && inFlight.length === 0}
    <p class="empty">Drop, paste, or click <strong>Attach</strong> to add files.</p>
  {:else if allFiles.length > 0}
    <ul class="list">
      {#each allFiles as f (f.id)}
        <li class="row">
          {#if isImage(f)}
            <a href={f.url} target="_blank" rel="noopener" class="thumb-link">
              <img src={f.thumbUrl || f.url} alt="" class="thumb" loading="lazy" />
            </a>
          {:else}
            <a href={f.url} target="_blank" rel="noopener" class="icon-link">
              <span class="icon">{f.mime?.includes('pdf') ? '📄' : '📎'}</span>
            </a>
          {/if}
          <div class="meta">
            <a href={f.url} target="_blank" rel="noopener" class="name">{f.originalName}</a>
            <span class="size">
              {fmtSize(f.size)}
              {#if f.appearsInOthers > 0}
                <span class="appears-in" title="Also attached to {f.appearsInOthers} other {f.appearsInOthers === 1 ? 'place' : 'places'}">
                  · linked in {f.appearsInOthers + 1} places
                </span>
              {/if}
            </span>
          </div>
          <div class="actions">
            {#if f.appearsInOthers > 0}
              <button
                type="button"
                class="btn-icon"
                class:active={appearsInOpenFor === f.id}
                title="Show all places this file appears"
                onclick={() => appearsInOpenFor = appearsInOpenFor === f.id ? null : f.id}
              >🔗</button>
            {/if}
            <button type="button" class="btn-icon" title="Detach from this {sourceType}" onclick={() => detach(f)}>×</button>
            <button type="button" class="btn-icon danger" title="Delete file everywhere" onclick={() => deleteFile(f)}>🗑</button>
          </div>
        </li>
        {#if appearsInOpenFor === f.id}
          <li class="panel-row">
            <AppearsInPanel fileId={f.id} onclose={() => appearsInOpenFor = null} />
          </li>
        {/if}
      {/each}
    </ul>
  {/if}
</div>

<style>
  .picker {
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    transition: border-color 120ms, background 120ms;
  }
  .picker.dragging {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .add {
    font-size: 12px;
    padding: 3px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-primary);
    cursor: pointer;
  }
  .add:hover { background: var(--surface-hover); }
  .add:disabled { opacity: 0.6; cursor: progress; }
  .empty {
    font-size: 12px;
    color: var(--text-tertiary, var(--text-secondary));
    margin: 4px 0 2px;
  }
  .progress-list {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .progress-row {
    display: grid;
    grid-template-columns: 1fr 100px auto auto;
    gap: 8px;
    align-items: center;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    background: var(--surface-hover);
  }
  .progress-name {
    font-size: 12px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .progress-track {
    position: relative;
    height: 6px;
    background: var(--border);
    border-radius: 3px;
    overflow: hidden;
  }
  .progress-fill {
    position: absolute;
    inset: 0;
    width: 0;
    background: var(--accent);
    transition: width 120ms;
  }
  .progress-pct {
    font-size: 11px;
    color: var(--text-secondary);
    min-width: 32px;
    text-align: right;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: grid;
    grid-template-columns: 32px 1fr auto;
    gap: 10px;
    align-items: center;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
  }
  .row:hover { background: var(--surface-hover); }
  .thumb {
    width: 32px;
    height: 32px;
    object-fit: cover;
    border-radius: 4px;
    display: block;
  }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    font-size: 16px;
    background: var(--surface-hover);
    border-radius: 4px;
  }
  .thumb-link, .icon-link {
    display: inline-flex;
    cursor: pointer;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
  }
  .name {
    color: var(--text-primary);
    font-size: 13px;
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name:hover { text-decoration: underline; }
  .size {
    color: var(--text-tertiary, var(--text-secondary));
    font-size: 11px;
  }
  .appears-in {
    color: var(--accent);
    margin-left: 2px;
  }
  .actions {
    display: flex;
    gap: 2px;
  }
  .btn-icon {
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }
  .btn-icon:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .btn-icon.active {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
  }
  .btn-icon.danger:hover {
    color: var(--error, #ef4444);
  }
  .panel-row {
    list-style: none;
    padding: 0 6px 4px 42px;
  }
</style>
