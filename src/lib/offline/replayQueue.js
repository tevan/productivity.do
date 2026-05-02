// Offline write queue.
//
// Strategy:
//   - Mutations (POST/PUT/PATCH/DELETE) intercepted by api.js call enqueue()
//     when the network is unreachable.
//   - Each entry carries a stable client-side `idempotencyKey` so retries
//     on the server are deduped by /api/v1's existing Idempotency-Key
//     middleware (or, for non-/api/v1 routes, simply replayed once).
//   - On `online`, drainQueue() runs every queued request in insertion
//     order. Last-write-wins: if the local copy is older than the server
//     copy, the server overwrites.
//   - Replay errors that look transient (network, 5xx, 408, 425, 429) are
//     left in the queue for the next online window. Permanent errors
//     (4xx other than the transient set) are dropped after writing a
//     `failure` entry to the activity log so the user can see what didn't
//     replay.
//
// Why IndexedDB and not localStorage:
//   - localStorage is synchronous and capped at ~5MB across all keys
//   - IndexedDB survives tab/process death and supports binary bodies if
//     we ever need to queue file uploads (avatar change while offline)
//   - The wrapper here is hand-rolled — we don't pull in idb-keyval
//     because the surface we need is tiny.

const DB_NAME = 'productivity-offline';
const DB_VERSION = 1;
const STORE_QUEUE = 'queue';
const STORE_LOG = 'activity-log';

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_LOG)) {
        const log = db.createObjectStore(STORE_LOG, { keyPath: 'id', autoIncrement: true });
        log.createIndex('replayedAt', 'replayedAt');
      }
    };
  });
  return _dbPromise;
}

async function tx(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const result = fn(store);
    t.oncomplete = () => resolve(result?.value !== undefined ? result.value : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// Subscriber pattern: components want to render "N pending" without
// polling. enqueue/drain emit; subscribers receive the new count.
const _listeners = new Set();
function emit() {
  count().then(n => _listeners.forEach(fn => { try { fn(n); } catch {} }));
}
export function subscribe(fn) {
  _listeners.add(fn);
  count().then(fn);
  return () => _listeners.delete(fn);
}

export async function count() {
  return tx(STORE_QUEUE, 'readonly', store => {
    return new Promise((resolve, reject) => {
      const r = store.count();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  });
}

export async function enqueue({ url, method, headers, body, idempotencyKey }) {
  await tx(STORE_QUEUE, 'readwrite', store => {
    store.add({
      url,
      method,
      headers: headers || {},
      body: body ?? null,
      idempotencyKey: idempotencyKey || null,
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
    });
  });
  emit();
}

export async function listAll() {
  return tx(STORE_QUEUE, 'readonly', store => {
    return new Promise((resolve, reject) => {
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  });
}

async function remove(id) {
  await tx(STORE_QUEUE, 'readwrite', store => store.delete(id));
}

async function bumpAttempts(id, lastError) {
  await tx(STORE_QUEUE, 'readwrite', store => {
    return new Promise((resolve, reject) => {
      const g = store.get(id);
      g.onsuccess = () => {
        const row = g.result;
        if (!row) return resolve();
        row.attempts = (row.attempts || 0) + 1;
        row.lastError = lastError;
        row.lastAttemptAt = new Date().toISOString();
        const p = store.put(row);
        p.onsuccess = () => resolve();
        p.onerror = () => reject(p.error);
      };
      g.onerror = () => reject(g.error);
    });
  });
}

export async function logActivity(entry) {
  await tx(STORE_LOG, 'readwrite', store => {
    store.add({
      ...entry,
      replayedAt: new Date().toISOString(),
    });
  });
}

// Activity log read — surfaced in Settings → Activity for the user-facing
// "what got replayed / what failed" view. Returns most-recent first, capped.
export async function recentActivity(limit = 100) {
  return tx(STORE_LOG, 'readonly', store => {
    return new Promise((resolve, reject) => {
      const idx = store.index('replayedAt');
      const items = [];
      const req = idx.openCursor(null, 'prev');
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && items.length < limit) {
          items.push(cursor.value);
          cursor.continue();
        } else {
          resolve(items);
        }
      };
      req.onerror = () => reject(req.error);
    });
  });
}

const TRANSIENT_STATUSES = new Set([0, 408, 425, 429, 500, 502, 503, 504]);

let _draining = false;
let _drainPromise = null;

export function drainQueue() {
  if (_drainPromise) return _drainPromise;
  _drainPromise = (async () => {
    _draining = true;
    try {
      while (true) {
        const items = await listAll();
        if (items.length === 0) break;
        // Process in insertion order; the autoincrement keypath gives us
        // a monotonic sequence. Order matters: a delete after an update
        // shouldn't run first.
        items.sort((a, b) => a.id - b.id);
        const item = items[0];
        try {
          const headers = { ...(item.headers || {}) };
          if (item.idempotencyKey) headers['Idempotency-Key'] = item.idempotencyKey;
          if (item.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
          const res = await fetch(item.url, {
            method: item.method,
            headers,
            credentials: 'include',
            body: item.body,
          });
          if (res.ok) {
            await remove(item.id);
            await logActivity({
              kind: 'replayed',
              url: item.url,
              method: item.method,
              status: res.status,
              enqueuedAt: item.enqueuedAt,
            });
            emit();
          } else if (TRANSIENT_STATUSES.has(res.status)) {
            // Leave it queued. Bump attempts so we can give up after many.
            await bumpAttempts(item.id, `HTTP ${res.status}`);
            if ((item.attempts || 0) + 1 >= 12) {
              await remove(item.id);
              await logActivity({
                kind: 'gave_up',
                url: item.url,
                method: item.method,
                status: res.status,
                enqueuedAt: item.enqueuedAt,
                reason: 'too many transient failures',
              });
            }
            // Stop draining; try again on next online tick.
            break;
          } else {
            // Permanent failure (4xx). Drop the entry; record so the user
            // can see what didn't replay.
            const text = await res.text().catch(() => '');
            await remove(item.id);
            await logActivity({
              kind: 'failed',
              url: item.url,
              method: item.method,
              status: res.status,
              error: text.slice(0, 300),
              enqueuedAt: item.enqueuedAt,
            });
            emit();
          }
        } catch (err) {
          // Network died mid-drain. Leave the queue alone for the next
          // online tick.
          await bumpAttempts(item.id, String(err?.message || err)).catch(() => {});
          break;
        }
      }
    } finally {
      _draining = false;
      _drainPromise = null;
    }
  })();
  return _drainPromise;
}

export function isDraining() { return _draining; }

// Hook into the browser's online/offline events. Idempotent — calling
// twice doesn't double-register.
let _wired = false;
export function wireOnlineListener() {
  if (_wired) return;
  _wired = true;
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => { drainQueue().catch(() => {}); });
  // Try immediately on register too — if the user was offline when the
  // tab opened and is online now, drain right away.
  if (navigator.onLine) drainQueue().catch(() => {});
}
