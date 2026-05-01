// Background sync loop for connected integrations.
//
// Iterates every connected `integrations` row on a schedule, dispatches to
// the adapter's syncTasks / syncEvents methods, updates last_synced_at and
// last_error. Uses a per-row stagger so a 1000-user instance doesn't hammer
// the same provider in the same second.
//
// One-process model — fine for SQLite + PM2 single-instance. If we ever
// shard across processes, switch to a coordinator (advisory lock or a
// `sync_leases` table).

import { getDb, q } from '../db/init.js';
import { getAdapter } from './registry.js';
import { markSynced, parseMetadata } from './store.js';
import { captureError } from '../lib/sentry.js';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;       // run the picker every 5 min
const PER_PROVIDER_TTL_MS = 15 * 60 * 1000;   // each provider re-syncs every ~15 min
const PER_TICK_LIMIT = 25;                    // process at most N rows per tick
const PER_ROW_TIMEOUT_MS = 60 * 1000;         // hard cap per provider call

function eligibleRows() {
  const cutoff = new Date(Date.now() - PER_PROVIDER_TTL_MS).toISOString();
  return q(`
    SELECT id, user_id, provider, last_synced_at
    FROM integrations
    WHERE status = 'connected'
      AND (last_synced_at IS NULL OR last_synced_at < ?)
    ORDER BY last_synced_at IS NULL DESC, last_synced_at ASC
    LIMIT ?
  `).all(cutoff, PER_TICK_LIMIT);
}

async function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

async function syncRow(row) {
  const adapter = getAdapter(row.provider);
  if (!adapter) return; // adapter removed / renamed — leave row alone
  const kinds = (adapter.kind || '').split('+');
  let firstError = null;
  if (kinds.includes('tasks') && typeof adapter.syncTasks === 'function') {
    try {
      await withTimeout(adapter.syncTasks(row.user_id), PER_ROW_TIMEOUT_MS, `${row.provider}.syncTasks`);
    } catch (e) {
      firstError = firstError || e;
      captureError(e, { provider: row.provider, op: 'syncTasks', userId: row.user_id });
    }
  }
  if (kinds.includes('calendar') && typeof adapter.syncEvents === 'function') {
    try {
      await withTimeout(adapter.syncEvents(row.user_id), PER_ROW_TIMEOUT_MS, `${row.provider}.syncEvents`);
    } catch (e) {
      firstError = firstError || e;
      captureError(e, { provider: row.provider, op: 'syncEvents', userId: row.user_id });
    }
  }
  markSynced(row.user_id, row.provider, firstError ? String(firstError.message || firstError) : null);
}

let timer = null;
let running = false;

async function tick() {
  if (running) return; // overlap guard — long syncs shouldn't queue up
  running = true;
  try {
    const rows = eligibleRows();
    for (const row of rows) {
      try { await syncRow(row); }
      catch (e) { captureError(e, { provider: row.provider, op: 'tick' }); }
    }
  } finally {
    running = false;
  }
}

export function startSyncRunner() {
  if (timer) return;
  // Stagger first run by 30s so server boot doesn't hammer external APIs.
  setTimeout(() => {
    tick();
    timer = setInterval(tick, SYNC_INTERVAL_MS);
  }, 30_000);
}

export function stopSyncRunner() {
  if (timer) { clearInterval(timer); timer = null; }
}

// Used by /api/integrations/:provider/sync — manual trigger reuses the same
// dispatch but skips the eligibility filter.
export async function syncNow(userId, provider) {
  const row = q(
    'SELECT id, user_id, provider FROM integrations WHERE user_id = ? AND provider = ?'
  ).get(userId, provider);
  if (!row) throw new Error('not connected');
  await syncRow(row);
}
