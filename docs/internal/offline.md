# Offline mode

The SPA at `/` is offline-capable as a Progressive Web App. The booking
widget at `/book/*` and all marketing pages are deliberately online-only.

## Three layers

1. **App shell precache.** `vite-plugin-pwa` generates `dist/sw.js` and
   precaches the build manifest's JS/CSS/HTML/SVG/font files at SW
   install time. Refresh while offline → SW serves `index.html` → SPA
   boots from cache.

2. **Read-through API cache (stale-while-revalidate).** The SW intercepts
   GETs to `/api/{calendars,preferences,calendar-sets,task-columns,
   focus-blocks,booking-pages,notifications,auth/status,
   auth/google/status,notes,links}`, plus prefix matches on
   `/api/{tasks,events,integrations}`. Cache name `productivity-api-v1`,
   max 200 entries, 7-day expiry. Online: fast cached response paints
   immediately; the network response updates the cache. Offline: the
   cached response is the only response.

3. **Write replay queue.** `src/lib/api.js` wraps every request. When
   `navigator.onLine === false` (or the fetch throws mid-flight) on a
   POST/PUT/PATCH/DELETE, the request is enqueued in IndexedDB
   (`productivity-offline.queue`) with a generated `Idempotency-Key`
   header and the synthetic envelope `{ok:true, queued:true,
   idempotencyKey}` is returned. On `online`, `replayQueue.drainQueue()`
   walks the queue in insertion order and replays each request. The
   /api/v1 idempotency middleware dedupes server-side replays; non-/api/v1
   routes simply succeed once.

## Files

- `vite.config.js` — PWA plugin config (precache globs, runtime caches,
  navigation fallback denylist)
- `src/main.js` — SW registration (production only) + online listener wire
- `src/lib/api.js` — fetch wrapper with offline enqueue
- `src/lib/offline/replayQueue.js` — IndexedDB queue + activity log
- `src/lib/components/OfflineChip.svelte` — compact toolbar status chip
- `backend/server.js` — `requireAuth` bypass for `/sw.js`,
  `/manifest.webmanifest`, `/workbox-*`

## What's NOT cached / queued

- `/api/v1/*` (public dev API — not used by SPA)
- `/api/support-chat`, `/api/billing/*`, `/api/stripe/*`, `/api/ai/*`
  (interactive flows where a stale response would mislead the user)
- POSTs to `/api/booking-pages/:id/bookings` (host-side booking management
  fetches this fresh)
- File uploads (avatars) — multipart isn't queued today
- Anything Express handles outside `/api/*`

## Conflict semantics

**Last-write-wins.** When a queued mutation replays, it overwrites
whatever the server has now. We do not surface conflict UI today.

If we ship version history (queued in the backlog), the activity-log
table in IndexedDB will be paired with a server-side per-resource
revision history. Until then, "I made changes on phone offline AND
desktop online while phone was offline" results in the desktop changes
being silently overwritten when phone reconnects.

The IndexedDB activity log (`productivity-offline.activity-log`) stores
every replayed mutation with `{kind, url, method, status, enqueuedAt,
replayedAt, error?}`. Settings → Activity surfaces the last 100 entries
once that view ships.

## Testing offline

1. `npm run build && pm2 restart productivity`
2. Load the SPA at `https://productivity.do` in a browser, log in, click
   around so the SW installs and the API caches warm.
3. DevTools → Application → Service Workers → "Offline" checkbox
4. Refresh — the SPA should still load and last-known data should
   render.
5. Create/edit a task — it appears optimistically; the toolbar chip
   shows "Syncing 1" (or "Offline" pill).
6. Uncheck "Offline" — chip drains, queue replays, server sees the
   change.

## Why not workbox background sync

Workbox has a `BackgroundSyncPlugin` that does the same thing in pure
SW context. We chose app-level replay because:

- The replay needs to integrate with the existing `Idempotency-Key`
  flow on /api/v1 (which the app generates per-request anyway).
- The activity log surfaces in the UI; pure-SW bg-sync is opaque.
- Last-write-wins conflict handling lives in app code. If we add
  conflict UI later, the queue is already in JS, not in a worker.

## Mobile app parity

When we build the native iOS/Android app, the same three-layer model
applies:
- Layer 1 (shell) is implicit (the app binary is local)
- Layer 2 maps to: SQLite cache or Core Data on iOS / Room on Android
- Layer 3 maps to: WorkManager (Android) or BGProcessingTask (iOS)
  with the same insertion-order replay + per-request Idempotency-Key

Last-write-wins applies symmetrically. The activity log lives in the
local DB; surface it in the same Settings → Activity view as the web.
