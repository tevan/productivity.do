# Zapier app scaffold

Zapier apps are built with the **Zapier Platform CLI** or the web builder.
We scaffold the CLI version because it's easier to put under git.

## Setup (when ready to publish)

```bash
npm install -g zapier-platform-cli
zapier login
zapier init productivity-do --template=oauth2  # or --template=api-key
```

We'll use **API key auth** (matches our `pk_live_…` keys). The user pastes
their key into Zapier's Connect screen; Zapier sends it as a Bearer header
on every request.

## Auth (API key)

```js
// authentication.js
module.exports = {
  type: 'custom',
  test: { url: 'https://productivity.do/api/v1/me' },
  fields: [
    { key: 'apiKey', label: 'API key', type: 'string', required: true,
      helpText: 'Generate one at productivity.do → Settings → Developer.' },
  ],
  connectionLabel: '{{bundle.authData.email}}',
};

// middleware.js
const includeApiKey = (request, z, bundle) => {
  request.headers.Authorization = `Bearer ${bundle.authData.apiKey}`;
  return request;
};
module.exports = { beforeRequest: [includeApiKey] };
```

## Triggers

- `new_event` → poll `GET /api/v1/events?from=<since>&to=<now>` (Zapier
  caches the latest seen `id`)
- `new_task` → poll `GET /api/v1/tasks` (filter created_at > since)
- `task_completed` → poll `GET /api/v1/tasks?completed=true` (since-filter)
- `new_booking` → poll `GET /api/v1/booking-pages/:id/bookings`
- **REST hooks** (preferred over polling): subscribe via
  `POST /api/v1/webhooks` with `{ url, events: [...] }`. Zapier's
  perform-subscribe / perform-unsubscribe / perform call.

## Actions

- `create_task` → `POST /api/v1/tasks`
- `create_event` → `POST /api/v1/events`
- `complete_task` → `POST /api/v1/tasks/:id/complete`
- `cancel_booking` → `POST /api/public/booking/cancel/:token`

## Submission

Zapier requires:
- App icon (256×256 PNG)
- 5 working sample triggers
- 5 working sample actions
- Privacy policy URL (we have one at /privacy.html)
- Terms URL (/terms.html)
- Support email
- Public marketing description

Review cycle: 2–4 weeks.
