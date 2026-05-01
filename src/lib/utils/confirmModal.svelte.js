/**
 * Promise-based confirmation modal. Replaces window.confirm() so that prompts
 * match the site's design system (per /srv/www/CLAUDE.md UI rules).
 *
 * Usage:
 *   import { confirmAction } from '$lib/utils/confirmModal.svelte.js';
 *   if (!await confirmAction({ title: 'Delete?', body: 'This is permanent.' })) return;
 *
 * The single ConfirmRoot component (mounted once in App.svelte) listens to
 * `pendingConfirm` and renders the modal when set.
 */

let pendingConfirm = $state(null);

export function getPendingConfirm() {
  return {
    get value() { return pendingConfirm; },
  };
}

/**
 * Returns Promise<boolean>. Resolves true on Confirm, false on Cancel/Esc/backdrop.
 */
export function confirmAction({ title = 'Are you sure?', body = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    pendingConfirm = {
      title, body, confirmLabel, cancelLabel, danger,
      resolve: (v) => {
        pendingConfirm = null;
        resolve(v);
      },
    };
  });
}
