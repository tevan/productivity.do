/**
 * Toast notifications — non-blocking feedback for actions that succeed,
 * fail, or are reversible.
 *
 * API:
 *   showToast({
 *     message: string,
 *     kind?: 'success' | 'error' | 'info',     // default 'info'
 *     duration?: number,                        // ms; 0 = persist; default 4000
 *     action?: { label, onClick },              // optional inline action button
 *   }) -> id
 *
 *   dismissToast(id)
 *
 * Convenience wrappers:
 *   toastSuccess(msg, opts?)
 *   toastError(msg, opts?)
 *   toastUndo(msg, onUndo, opts?)   // 6s default, "Undo" action button
 *
 * The store is consumed by `<ToastRoot>` mounted once in App.svelte.
 * This module exports an array-based $state so the root reactively renders.
 *
 * Why a singleton store and not Svelte context: the call sites are
 * stateless modules (`stores/events.svelte.js`, `api.js` interceptors)
 * that can't reach into a component context. A module-level store keeps
 * them decoupled.
 */

let nextId = 1;
const toasts = $state([]);

export function getToasts() { return toasts; }

export function showToast({
  message,
  kind = 'info',
  duration = 4000,
  action = null,
} = {}) {
  if (!message) return null;
  const id = nextId++;
  const toast = { id, message, kind, action };
  toasts.push(toast);
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

export function dismissToast(id) {
  const idx = toasts.findIndex(t => t.id === id);
  if (idx >= 0) toasts.splice(idx, 1);
}

export function toastSuccess(message, opts = {}) {
  return showToast({ kind: 'success', message, ...opts });
}

export function toastError(message, opts = {}) {
  // Errors get a longer default duration so the user can read them before
  // they vanish. 7s vs 4s.
  return showToast({ kind: 'error', message, duration: 7000, ...opts });
}

/**
 * Undo toast — 6 seconds, with an Undo action that calls `onUndo`. The
 * onUndo callback should return a Promise so we can briefly show "Undoing…"
 * before the toast clears.
 */
export function toastUndo(message, onUndo, opts = {}) {
  let undone = false;
  const id = showToast({
    kind: 'info',
    message,
    duration: 6000,
    action: {
      label: 'Undo',
      onClick: async () => {
        if (undone) return;
        undone = true;
        try {
          await onUndo();
        } finally {
          dismissToast(id);
        }
      },
    },
    ...opts,
  });
  return id;
}
