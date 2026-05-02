import { showUpgrade } from './utils/upgradeModal.svelte.js';
import { enqueue } from './offline/replayQueue.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Generate an idempotency key for queued mutations. Uses crypto.randomUUID
// so the server's /api/v1 idempotency middleware can dedupe replays. For
// non-/api/v1 routes the header is ignored — replay is just "send once."
function newIdempotencyKey() {
  try { return crypto.randomUUID(); }
  catch { return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

export async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const isMutation = MUTATING.has(method);

  // If offline AND this is a mutation we know how to replay later, queue it
  // and return a synthetic success-shaped envelope. Stores keep optimistic
  // state on the client; the queue replays on reconnect. GET requests
  // can't be queued — if the SW didn't have a cached response, we fall
  // through to fetch() and let the caller see the failure.
  if (isMutation && typeof navigator !== 'undefined' && navigator.onLine === false) {
    const idempotencyKey = options.headers?.['Idempotency-Key'] || newIdempotencyKey();
    await enqueue({
      url: path,
      method,
      headers: options.headers || {},
      body: options.body || null,
      idempotencyKey,
    });
    return { ok: true, queued: true, idempotencyKey };
  }

  let res;
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
  } catch (err) {
    // Network failure mid-request. For mutations, queue so the change
    // isn't lost. For reads, surface the error to the caller.
    if (isMutation) {
      const idempotencyKey = options.headers?.['Idempotency-Key'] || newIdempotencyKey();
      await enqueue({
        url: path,
        method,
        headers: options.headers || {},
        body: options.body || null,
        idempotencyKey,
      });
      return { ok: true, queued: true, idempotencyKey };
    }
    return { ok: false, error: 'Network unavailable', offline: true };
  }
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
