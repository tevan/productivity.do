import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    svelte(),
    // Service Worker for offline support. Strategy:
    //  - precache the SPA shell (index.html + JS/CSS/font assets) so a
    //    refresh while offline still loads the app
    //  - runtime cache /api GETs as stale-while-revalidate (read-through)
    //  - mutations are queued by src/lib/offline/replayQueue.js (NOT the
    //    workbox bg-sync plugin) because we want app-level retry/replay
    //    with the same Idempotency-Key plumbing /api/v1 uses
    //  - book.html (the Calendly-style widget) is excluded — that flow
    //    needs server-side slot recheck and isn't useful offline.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // we register manually in src/main.js
      strategies: 'generateSW',
      filename: 'sw.js',
      manifest: {
        name: 'productivity.do',
        short_name: 'productivity',
        description: 'Calendar, tasks, and booking pages',
        theme_color: '#3b82f6',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
        // book.html and its bundle ride along on the same dist/ — exclude
        // them so the SW doesn't confuse the widget with the main SPA.
        globIgnores: ['**/book.html', '**/book-*.js', '**/book-*.css'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // SPA fallback so /integrations, /developers, etc. resolve to
        // index.html when offline. Deny anything Express handles
        // server-side.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/book\b/,
          /^\/q\//,
          /^\/help\b/,
          /^\/developers\b/,
          /^\/ics\//,
          /^\/avatars\//,
          /^\/embed\.js$/,
          /^\/home\.html$/,
          /^\/(features|pricing|security|about|changelog|terms|privacy|signup)\.html$/,
          /^\/roadmap\b/,
        ],
        runtimeCaching: [
          // Read-through SWR cache for protected API GETs the SPA hits
          // on every boot. The events store has its own in-memory cache
          // on top; this layer is the *durability* layer that survives
          // refresh/offline.
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && (
                url.pathname === '/api/calendars' ||
                url.pathname === '/api/preferences' ||
                url.pathname === '/api/calendar-sets' ||
                url.pathname === '/api/task-columns' ||
                url.pathname === '/api/focus-blocks' ||
                url.pathname === '/api/booking-pages' ||
                url.pathname === '/api/notifications' ||
                url.pathname === '/api/auth/status' ||
                url.pathname === '/api/auth/google/status' ||
                url.pathname === '/api/notes' ||
                url.pathname === '/api/links' ||
                url.pathname.startsWith('/api/tasks') ||
                url.pathname.startsWith('/api/events') ||
                url.pathname.startsWith('/api/integrations')
              ),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'productivity-api-v1',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Provider brand icons — long-lived, content-addressable by slug.
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && url.pathname.startsWith('/api/icons/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'productivity-icons',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Disabled: dev uses Vite HMR which doesn't play with SWs and
        // makes refresh-loop debugging miserable. Build-time only.
        enabled: false,
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        book: resolve(__dirname, 'book.html'),
      },
      output: {
        manualChunks(id) {
          // Pull markdown rendering deps into their own chunk so the main
          // bundle stays lean. They're only used when a note editor or
          // notes view actually renders. Loaded eagerly today since notes
          // load on app boot, but isolating makes future code-split easier.
          if (id.includes('node_modules/marked') ||
              id.includes('node_modules/highlight.js') ||
              id.includes('node_modules/dompurify')) {
            return 'markdown';
          }
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3020',
        changeOrigin: true,
      },
    },
  },
});
