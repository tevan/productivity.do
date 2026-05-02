import App from './App.svelte';
import './app.css';
import { mount } from 'svelte';
import { wireOnlineListener } from './lib/offline/replayQueue.js';

const app = mount(App, {
  target: document.getElementById('app'),
});

// Service Worker registration — production only. Vite dev server's HMR
// fights with SW caching; we rely on Vite's own hot-reload during dev.
// `import.meta.env.PROD` is the build-time switch.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // Lazy-load so dev builds don't pay the bytes.
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      onRegistered(reg) {
        // Re-check for SW updates every hour. Without this, a long-running
        // tab can serve a months-old shell after the user has refreshed
        // dozens of times — autoUpdate only re-checks on navigation.
        if (reg) setInterval(() => reg.update().catch(() => {}), 60 * 60_000);
      },
      onRegisterError(err) {
        console.warn('[sw] registration failed:', err);
      },
    });
  }).catch(err => console.warn('[sw] virtual import failed:', err));
}

// Drain the replay queue when the browser comes back online. Idempotent —
// safe to call once at boot.
wireOnlineListener();

export default app;
