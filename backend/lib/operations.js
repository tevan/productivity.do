// Long-running operations (LROs).
//
// Geewax Ch 10: endpoints whose work duration can exceed ~3s should return
// 202 + an Operation handle. The caller polls `GET /api/operations/:id`
// (cheap) or `GET /api/operations/:id:wait` (blocks up to 30s) until the
// operation completes.
//
// Why a separate library instead of inlining the table writes in each
// route: most LRO endpoints have the same shape — start the work in a
// detached promise, return the handle, write the result on completion.
// The helpers here are the safe pattern; inline writes are easy to get
// wrong (forgetting to mark done, leaking errors, etc.).
//
// Naming convention for `kind`: `<resource>.<verb>` so we can filter by
// resource type later (e.g. 'event.prep', 'integration.sync'). Don't
// embed user-data in the kind — kinds are a fixed enum.

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/init.js';

export function createOperation({ userId, kind, metadata = null }) {
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO operations (id, user_id, kind, done, metadata_json)
    VALUES (?, ?, ?, 0, ?)
  `).run(id, userId, kind, metadata ? JSON.stringify(metadata) : null);
  return id;
}

export function completeOperation(id, result) {
  getDb().prepare(`
    UPDATE operations
       SET done = 1,
           result_json = ?,
           error_json = NULL,
           completed_at = datetime('now')
     WHERE id = ?
  `).run(JSON.stringify(result ?? null), id);
}

export function failOperation(id, error) {
  const body = (error && typeof error === 'object')
    ? { message: String(error.message || error), code: error.code }
    : { message: String(error) };
  getDb().prepare(`
    UPDATE operations
       SET done = 1,
           result_json = NULL,
           error_json = ?,
           completed_at = datetime('now')
     WHERE id = ?
  `).run(JSON.stringify(body), id);
}

export function updateOperationMetadata(id, metadata) {
  getDb().prepare(`
    UPDATE operations SET metadata_json = ? WHERE id = ?
  `).run(metadata ? JSON.stringify(metadata) : null, id);
}

export function getOperation(id, userId) {
  const row = getDb().prepare(`
    SELECT id, user_id, kind, done, result_json, error_json, metadata_json,
           created_at, completed_at
      FROM operations
     WHERE id = ? AND user_id = ?
  `).get(id, userId);
  return row ? hydrate(row) : null;
}

function hydrate(row) {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    done: !!row.done,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    error: row.error_json ? JSON.parse(row.error_json) : null,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// Run `work()` asynchronously, capture result/error into the operation row.
// Returns immediately. Use this from route handlers that opted into async.
export function runOperation(opId, work) {
  Promise.resolve()
    .then(() => work())
    .then((result) => completeOperation(opId, result))
    .catch((err) => {
      console.warn(`operation ${opId} failed:`, err.message || err);
      failOperation(opId, err);
    });
}

// Poll variant: block up to `timeoutMs` waiting for `done = 1`. Used by
// the `:wait` route variant for clients that want to avoid an explicit
// poll loop (e.g. the SPA's prep button can issue a single :wait call
// instead of polling every 500ms).
export async function waitForOperation(id, userId, { timeoutMs = 30_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let op = getOperation(id, userId);
  while (op && !op.done && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs));
    op = getOperation(id, userId);
  }
  return op;
}

// Periodic sweep: drop completed operations older than 7 days. Failed
// operations stay so dashboards can surface the error retroactively;
// successful operations become noise after the result is consumed.
let sweeper = null;
export function startOperationsSweeper({ intervalMs = 6 * 60 * 60_000 } = {}) {
  if (sweeper) return;
  const sweep = () => {
    try {
      getDb().prepare(`
        DELETE FROM operations
         WHERE done = 1
           AND error_json IS NULL
           AND completed_at < datetime('now', '-7 days')
      `).run();
    } catch (err) {
      console.warn('operations sweep:', err.message);
    }
  };
  sweep();
  sweeper = setInterval(sweep, intervalMs);
  sweeper.unref?.();
}
