<script>
  import { getPendingConfirm } from '../utils/confirmModal.svelte.js';

  const store = getPendingConfirm();
  const c = $derived(store.value);

  function handleKeydown(e) {
    if (!c) return;
    if (e.key === 'Escape') c.resolve(false);
    if (e.key === 'Enter') c.resolve(true);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if c}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="backdrop" onclick={() => c.resolve(false)}></div>
  <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
    <h2 id="confirm-title">{c.title}</h2>
    {#if c.body}<p>{c.body}</p>{/if}
    <div class="actions">
      <button class="btn ghost" onclick={() => c.resolve(false)}>{c.cancelLabel}</button>
      <button class="btn" class:danger={c.danger} onclick={() => c.resolve(true)} autofocus>{c.confirmLabel}</button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 2000;
  }
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 2001;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: 20px 22px;
    width: min(440px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h2 { font-size: 15px; font-weight: 600; margin: 0; }
  p { font-size: 13px; color: var(--text-secondary); margin: 0; line-height: 1.5; }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
  .btn {
    padding: 6px 14px;
    border: 1px solid var(--border);
    background: var(--accent);
    color: white;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .btn.danger {
    background: var(--danger, #ef4444);
    border-color: var(--danger, #ef4444);
  }
  .btn.ghost {
    background: var(--surface);
    color: var(--text-primary);
  }
  .btn.ghost:hover { background: var(--surface-hover); }
</style>
