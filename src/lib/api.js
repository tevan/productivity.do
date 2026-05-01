import { showUpgrade } from './utils/upgradeModal.svelte.js';

export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch { data = { ok: false, error: 'Bad response' }; }

  // 402 / { code: 'plan_required' } → surface the upgrade modal automatically.
  // Callers still get the original payload back so they can inline-handle the
  // error text. The modal is fire-and-forget — we don't await it.
  if (data && data.code === 'plan_required') {
    const requiredPlan = data.requiredPlan || (data.error?.toLowerCase().includes('team') ? 'team' : 'pro');
    // Don't block on the user's choice. They'll either upgrade (page redirect)
    // or dismiss; either way the original API call has already failed.
    showUpgrade({
      feature: data.feature || '',
      requiredPlan,
      detail: data.error || '',
    });
  }
  return data;
}
