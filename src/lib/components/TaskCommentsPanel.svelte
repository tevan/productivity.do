<script>
  // Comments overlay for a task. Mirrors NoteCommentsPanel but talks to
  // the existing Todoist-backed comment routes (`content` field, ID is a
  // Todoist comment id, no soft-delete — Todoist hard-deletes).

  import { api } from '../api.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';

  let { taskId, onclose = () => {} } = $props();

  let comments = $state([]);
  let loading = $state(true);
  let err = $state('');
  let busy = $state(false);
  let draft = $state('');
  let editingId = $state(null);
  let editDraft = $state('');

  async function load() {
    loading = true; err = '';
    const r = await api(`/api/tasks/${taskId}/comments`);
    if (r?.ok) comments = r.comments || [];
    else err = r?.error || 'Could not load comments';
    loading = false;
  }
  $effect(() => { load(); });

  async function post() {
    const content = draft.trim();
    if (!content) return;
    busy = true;
    const r = await api(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    busy = false;
    if (r?.ok && r.comment) {
      // Todoist returns the raw comment; normalize to our list shape.
      comments = [...comments, {
        id: r.comment.id,
        content: r.comment.content,
        postedAt: r.comment.posted_at || new Date().toISOString(),
      }];
      draft = '';
    } else {
      err = r?.error || 'Could not post';
    }
  }

  function startEdit(c) {
    editingId = c.id;
    editDraft = c.content;
  }
  function cancelEdit() {
    editingId = null;
    editDraft = '';
  }
  async function saveEdit(c) {
    const content = editDraft.trim();
    if (!content) return;
    busy = true;
    const r = await api(`/api/tasks/comments/${c.id}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    busy = false;
    if (r?.ok) {
      comments = comments.map(x => x.id === c.id ? { ...x, content } : x);
      cancelEdit();
    } else {
      err = r?.error || 'Could not save';
    }
  }
  async function remove(c) {
    if (!await confirmAction({
      title: 'Delete this comment?',
      body: 'This is permanent — Todoist hard-deletes comments.',
      confirmLabel: 'Delete',
    })) return;
    busy = true;
    const r = await api(`/api/tasks/comments/${c.id}`, { method: 'DELETE' });
    busy = false;
    if (r?.ok) {
      comments = comments.filter(x => x.id !== c.id);
    } else {
      err = r?.error || 'Could not delete';
    }
  }

  function relative(iso) {
    if (!iso) return '';
    const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
    const sec = Math.round((Date.now() - d.getTime()) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
    if (sec < 86400 * 7) return `${Math.round(sec / 86400)}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function full(iso) {
    if (!iso) return '';
    const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
    return d.toLocaleString();
  }

  function onKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      post();
    }
  }
</script>

<div class="cmt-panel">
  <header class="cmt-head">
    <h4>Comments {#if comments.length > 0}<span class="count">({comments.length})</span>{/if}</h4>
    <button class="close-btn" onclick={onclose} aria-label="Close comments">×</button>
  </header>

  {#if loading}
    <div class="cmt-empty">Loading…</div>
  {:else if err && comments.length === 0}
    <div class="cmt-empty err">{err}</div>
  {:else}
    <div class="cmt-body">
      {#if comments.length === 0}
        <div class="cmt-empty">No comments yet — leave a note for future-you.</div>
      {:else}
        <ul class="cmt-list">
          {#each comments as c (c.id)}
            <li class="cmt-row">
              <div class="cmt-meta">
                <span class="when" title={full(c.postedAt)}>{relative(c.postedAt)}</span>
                <div class="cmt-actions">
                  {#if editingId !== c.id}
                    <button class="link-btn" onclick={() => startEdit(c)}>Edit</button>
                    <button class="link-btn danger" onclick={() => remove(c)}>Delete</button>
                  {/if}
                </div>
              </div>
              {#if editingId === c.id}
                <textarea bind:value={editDraft} rows="3" class="cmt-edit"></textarea>
                <div class="cmt-edit-actions">
                  <button class="cancel-btn" onclick={cancelEdit}>Cancel</button>
                  <button class="save-btn" onclick={() => saveEdit(c)} disabled={busy || !editDraft.trim()}>Save</button>
                </div>
              {:else}
                <p class="cmt-body-text">{c.content}</p>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <div class="cmt-compose">
      <textarea
        bind:value={draft}
        placeholder="Leave a comment…"
        rows="2"
        onkeydown={onKeydown}
      ></textarea>
      <div class="cmt-compose-actions">
        <span class="hint">⌘+Enter to post</span>
        <button class="post-btn" onclick={post} disabled={busy || !draft.trim()}>Post</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .cmt-panel {
    position: absolute; inset: 0;
    background: var(--surface);
    display: flex; flex-direction: column;
    z-index: 5;
  }
  .cmt-head {
    display: flex; justify-content: space-between; align-items: center;
    padding: 14px 18px; border-bottom: 1px solid var(--border);
  }
  .cmt-head h4 { margin: 0; font-size: 14px; font-weight: 600; }
  .cmt-head .count { color: var(--text-tertiary); font-weight: 400; margin-left: 4px; }
  .close-btn {
    background: none; border: none; cursor: pointer;
    font-size: 22px; line-height: 1; color: var(--text-tertiary);
    padding: 0 8px;
  }
  .close-btn:hover { color: var(--text-primary); }
  .cmt-empty {
    padding: 24px; color: var(--text-tertiary); font-size: 13px; text-align: center;
  }
  .cmt-empty.err { color: var(--error, #c62828); }
  .cmt-body { flex: 1; overflow-y: auto; padding: 8px 0; }
  .cmt-list { list-style: none; margin: 0; padding: 0; }
  .cmt-row { padding: 12px 18px; border-bottom: 1px solid var(--border); }
  .cmt-row:last-child { border-bottom: none; }
  .cmt-meta {
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; color: var(--text-tertiary);
    margin-bottom: 6px;
  }
  .cmt-actions { margin-left: auto; display: flex; gap: 10px; }
  .link-btn {
    background: none; border: none;
    color: var(--text-tertiary); cursor: pointer;
    font-size: 11px; padding: 0;
  }
  .link-btn:hover { color: var(--text-primary); text-decoration: underline; }
  .link-btn.danger:hover { color: var(--error, #c62828); }
  .cmt-body-text {
    margin: 0;
    font-size: 13px; line-height: 1.55;
    white-space: pre-wrap; word-wrap: break-word;
    color: var(--text-primary);
  }
  .cmt-edit {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: 13px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    resize: vertical;
  }
  .cmt-edit-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
  .cancel-btn, .save-btn, .post-btn {
    padding: 5px 12px; font-size: 12px; cursor: pointer;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-secondary); color: var(--text-primary);
  }
  .save-btn, .post-btn {
    background: var(--accent); color: white; border-color: var(--accent);
  }
  .save-btn:disabled, .post-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .cmt-compose {
    border-top: 1px solid var(--border);
    padding: 12px 18px;
    background: var(--bg-secondary);
  }
  .cmt-compose textarea {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: 13px;
    resize: vertical;
    min-height: 56px;
    background: var(--surface);
    color: var(--text-primary);
  }
  .cmt-compose-actions {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: 6px;
  }
  .hint { font-size: 11px; color: var(--text-tertiary); }
</style>
