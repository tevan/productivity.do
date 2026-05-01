/**
 * Plan-required upgrade prompt. Mirrors confirmModal.svelte.js.
 * Triggered automatically by api.js when an endpoint returns 402 or
 * { code: 'plan_required' }, and can also be raised explicitly:
 *
 *   showUpgrade({ feature: 'Round-robin booking', requiredPlan: 'team' });
 */

let pendingUpgrade = $state(null);

export function getPendingUpgrade() {
  return {
    get value() { return pendingUpgrade; },
  };
}

export function showUpgrade({ feature = '', requiredPlan = 'pro', detail = '' } = {}) {
  return new Promise((resolve) => {
    pendingUpgrade = {
      feature, requiredPlan, detail,
      resolve: (v) => {
        pendingUpgrade = null;
        resolve(v);
      },
    };
  });
}
