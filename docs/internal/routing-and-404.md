# Routing and 404 handling

**Date:** 2026-04-30
**Status:** Implemented

## Decision: real 404, not a redirect to `/`

Previously, any unmatched non-API path served `index.html`. So
`https://productivity.do/asdfasdf` would load the SPA. That's the default
SPA-fallback pattern, but it has problems:

- **SEO** — search engines index dead URLs as if they're real pages
- **User confusion** — "I thought I was on the bookings page" when
  they had a typo in the URL
- **Monitoring blindness** — broken links never surface; everything
  looks like a 200
- **Back button breaks** — landing on `/garbage`, hitting back, going
  forward again puts you in an unrecoverable state

We now serve a real **HTTP 404** with a styled page at
`backend/views/404.html`. Status code matters more than the visual
treatment.

## Why not redirect to `/`?

Redirects lie about what happened. The user clicked a link, saw `/foo`
in the URL bar, and ended up on `/`. They'll think they're somewhere
they're not, or that the link "took them home" when actually it was
broken. Real 404 with a clear "Open the app" button is more honest.

The only redirects we do are for **known-old patterns** (e.g., if we
ever rename `/calendar` → `/`, that gets a 301 redirect because we know
the original was legitimate). Unknown garbage paths get 404.

## Legitimate paths

Any of these returns 200:

- `/` — main SPA
- `/login` — login page (handled before SPA fallback)
- `/book/:slug[/:typeSlug]` — public booking widget
- `/book/cancel/:token`, `/book/reschedule/:token`, `/book/i/:token`,
  `/book/form/:slug` — public booking sub-flows
- `/q/:id` — public quick-slot widget
- `/developers` — public API docs
- `/embed.js` — public embed script
- `/home.html`, `/features.html`, `/pricing.html`, `/security.html`,
  `/about.html`, `/changelog.html`, `/terms.html`, `/privacy.html`,
  `/signup.html` — marketing pages
- `/api/v1/openapi.json`, `/api/v1/ping` — public API endpoints
- `/ics/u/:token` — public ICS calendar feed
- `/assets/*` — built JS/CSS bundles
- `/favicon.svg`, `/favicon.ico` — favicons

Everything else gets a 404.

## Implementation

The catch-all in `backend/server.js` is the *last* matched route. By the
time we get there, named handlers (booking, quick-slot, marketing, etc.)
have already responded. Static-file serving has also already responded.
So an unmatched path here is genuinely unknown.

```js
const FOUR_OH_FOUR = readFileSync(join(__dirname, 'views/404.html'), 'utf8');

app.get('/{*splat}', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }
  if (req.path === '/') {
    return res.sendFile(join(distPath, 'index.html'));
  }
  res.status(404).type('html').send(FOUR_OH_FOUR);
});
```

## When the SPA needs more routes

Today the SPA has no client-side router — there's only `/`. If we ever
add SPA routes (`/calendar/2026-05-01`, `/tasks/inbox`, etc.), we need
to:

1. Add those paths to a `SPA_ROUTES` allowlist in server.js
2. Match them in the catch-all and serve `index.html` (200) for those
3. Everything else still 404s

Don't be tempted to "just serve `index.html` for any non-API path" again
— we end up back where we started.
