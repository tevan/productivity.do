<script>
  /*
   * Renders the toast queue in a fixed bottom-center stack. Mounted once
   * from App.svelte (alongside ConfirmRoot + UpgradeRoot). The store API
   * lives in `utils/toast.svelte.js`.
   *
   * Each toast can carry one optional inline action button — used for
   * "Undo" after delete, "View" after create, etc. Clicking the action
   * runs the callback then dismisses the toast (handled by toastUndo()
   * for undo flows; for "View" flows the onClick can dismiss itself).
   */
  import { getToasts, dismissToast } from '../utils/toast.svelte.js';
  import { fly } from 'svelte/transition';

  const toasts = getToasts();
</script>

<div class="toast-stack" role="region" aria-live="polite" aria-label="Notifications">
  {#each toasts as t (t.id)}
    <div
      class="toast"
      class:success={t.kind === 'success'}
      class:error={t.kind === 'error'}
      class:info={t.kind === 'info'}
      in:fly={{ y: 20, duration: 180 }}
      out:fly={{ y: 20, duration: 140 }}
    >
      <span class="toast-msg">{t.message}</span>
      {#if t.action}
        <button class="toast-action" onclick={t.action.onClick}>
          {t.action.label}
        </button>
      {/if}
      <button
        class="toast-close"
        aria-label="Dismiss"
        onclick={() => dismissToast(t.id)}
      >×</button>
    </div>
  {/each}
</div>

<style>
  .toast-stack {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column-reverse;
    gap: 8px;
    z-index: 1300;
    pointer-events: none;
    max-width: calc(100vw - 32px);
  }
  .toast {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px 10px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 500;
    min-width: 280px;
    max-width: 480px;
    /* Left-edge accent strip; color set per-kind below. */
    border-left-width: 3px;
  }
  .toast.success { border-left-color: var(--success, #15803d); }
  .toast.error   { border-left-color: var(--error, #c62828); }
  .toast.info    { border-left-color: var(--accent); }

  .toast-msg {
    flex: 1;
    line-height: 1.4;
  }
  .toast-action {
    background: none;
    border: 1px solid var(--border);
    color: var(--accent);
    font-weight: 600;
    font-size: 12px;
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-family: inherit;
    flex-shrink: 0;
  }
  .toast-action:hover {
    background: var(--accent-light, color-mix(in srgb, var(--accent) 12%, transparent));
    border-color: var(--accent);
  }
  .toast-close {
    background: none;
    border: none;
    color: var(--text-tertiary);
    font-size: 18px;
    line-height: 1;
    padding: 0 2px;
    cursor: pointer;
    font-family: inherit;
    flex-shrink: 0;
  }
  .toast-close:hover { color: var(--text-primary); }

  @media (max-width: 640px) {
    .toast-stack {
      bottom: 80px; /* clear the mobile bottom-nav */
      left: 16px;
      right: 16px;
      transform: none;
    }
    .toast { min-width: 0; width: 100%; }
  }
</style>
