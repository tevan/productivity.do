/**
 * Promise-based recurring-event scope picker. Returns one of:
 *   'instance'  — just this event
 *   'series'    — all events in the series (the parent and every instance)
 *   'following' — this event and all future ones in the series
 *   null        — user cancelled (Esc / backdrop / Cancel button)
 *
 * Usage:
 *   import { chooseRecurrenceScope } from '$lib/utils/chooseScopeModal.svelte.js';
 *   const scope = await chooseRecurrenceScope({ title: 'Delete recurring event?', verb: 'Delete' });
 *   if (!scope) return;  // user cancelled
 *
 * Mirrors the confirmModal pattern: a single $state(null) holds the
 * pending request; ScopeModalRoot (mounted once in App.svelte) renders
 * the dialog when set.
 *
 * The default-selected option is 'instance' — matching the safest
 * outcome (only this occurrence is affected). Users have to actively
 * select a wider scope.
 */

let pendingScope = $state(null);

export function getPendingScope() {
  return {
    get value() { return pendingScope; },
  };
}

/**
 * Returns Promise<'instance' | 'series' | 'following' | null>.
 *
 * @param {object}  opts
 * @param {string}  opts.title       — e.g. "Delete recurring event?"
 * @param {string}  opts.body        — optional context line.
 * @param {string}  opts.verb        — the action label, e.g. "Delete" or "Edit".
 *                                     Used in radio-button labels for clarity.
 * @param {boolean} opts.danger      — if true, confirm button is red.
 */
export function chooseRecurrenceScope({
  title = 'Apply to which events?',
  body = '',
  verb = 'Apply',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    pendingScope = {
      title,
      body,
      verb,
      danger,
      resolve: (v) => {
        pendingScope = null;
        resolve(v);
      },
    };
  });
}
