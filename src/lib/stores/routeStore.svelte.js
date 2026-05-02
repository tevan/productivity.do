// Minimal client-side routing for the SPA. Today the app is single-route
// at `/`. We're adding a few escape hatches (`/integrations[/:provider]`,
// future `/developers/*`, etc.) without pulling in a full router — the
// surface is too small to justify the dep.
//
// Listens to popstate so back/forward work natively. Mutations go through
// `navigate(path)` which uses pushState so the URL stays canonical.

const initial = typeof window === 'undefined' ? '/' : window.location.pathname;
let path = $state(initial);

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => { path = window.location.pathname; });
}

export function getRoute() {
  return {
    get path() { return path; },
    get isIntegrations() { return path === '/integrations' || path.startsWith('/integrations/'); },
    get integrationsProvider() {
      const m = path.match(/^\/integrations\/([^/?#]+)/);
      return m ? m[1] : null;
    },
    get isAdminMetrics() { return path === '/admin/metrics'; },
  };
}

export function navigate(p, { replace = false } = {}) {
  if (typeof window === 'undefined') return;
  if (p === path) return;
  if (replace) window.history.replaceState(null, '', p);
  else window.history.pushState(null, '', p);
  path = p;
}
