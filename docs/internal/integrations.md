# Integrations Architecture

## Why this exists

Earlier versions hardcoded Google Calendar as the only event source and
Todoist as the only task source. That made the app unusable to anyone who
didn't already have those accounts, and left no path for adding new
sources without rewriting half the codebase.

This abstraction lets the app work standalone (native source) and lets
each external tool plug in as one adapter.

## Three pillars

1. **Native storage** — `events_native`, `tasks_native`, `projects_native`
   tables. The user can use the app with no integrations and never lose
   data when they disconnect a source.
2. **Source column** — `provider` is on every event and task row. Routes
   read across providers; writes route to the right backend.
3. **Adapter registry** — each integration is one file in
   `backend/integrations/<provider>/adapter.js` exporting an object with
   the standard shape (auth, sync, mutations, disconnect).

## Adapter shape

```js
export const adapter = {
  provider: 'foo',           // unique key
  name: 'Foo',               // display name
  kind: 'tasks' | 'calendar' | 'tasks+calendar' | 'notes',
  authType: 'oauth' | 'pat' | 'caldav',
  description: '…',
  docsUrl: 'https://…',
  syncEnabled: true,
  requiresEnv: ['FOO_CLIENT_ID'],

  // Auth — implement only what your authType needs
  authStartUrl(userId, redirectUri),
  authCallback(userId, code, redirectUri),
  authValidatePat(userId, token),
  authValidateCaldav(userId, { serverUrl, username, password }),

  // Sync
  syncTasks(userId),
  syncEvents(userId),

  // Mutations — provider-side writes
  createTask(userId, task),
  updateTask(userId, sourceId, patch),
  deleteTask(userId, sourceId),
  completeTask(userId, sourceId),
  createEvent(userId, calendarId, event),
  updateEvent(userId, calendarId, eventId, event),
  deleteEvent(userId, calendarId, eventId),

  // Disconnect — clear tokens (and optionally cached rows)
  disconnect(userId, { wipeCache = true }),
};
```

Adapters that aren't fully implemented use `_stub.js`'s `makeStub()`:
they appear in the UI as "coming soon" and throw 501-shaped errors if
called. Asana, ClickUp, Jira, Evernote, and Monday.com are stubs today.

## Source ids

Each provider namespaces its source ids so they don't collide:

| Provider | Pattern |
|---|---|
| `native` | `<uuid>` (we own it) |
| `todoist` | raw Todoist task id |
| `google_tasks` | `gt_<listId>_<taskId>` |
| `notion` | `notion_<pageId>` |
| `linear` | `linear_<issueId>` |
| `trello` | `trello_<cardId>` |
| `microsoft_todo` | `mstodo_<listId>_<taskId>` |
| `microsoft_calendar` | `ms_<eventId>` |
| `caldav` | `caldav_<icsUid>` |

Source ids are stored in `tasks_cache.todoist_id` (legacy column name —
keep it for now to avoid a destructive migration; semantics changed to
"upstream id, namespaced if needed").

## Persistence

`integrations(user_id, provider, status, access_token, refresh_token,
expires_at, account_email, metadata_json, last_synced_at, last_error)`.

- One row per `(user_id, provider)`. UNIQUE constraint enforces.
- `metadata_json` carries provider-specific config (Notion db id,
  Trello board id list, Linear team id list, CalDAV server URL).
- Tokens stored plaintext. **TODO**: encrypt at rest before public launch.
  Approach: `KEK` env var → AES-GCM the token columns. SQLite has no
  native row-level encryption; we'd encrypt before insert / decrypt on
  read in `store.js`.

## Routes

All under `/api/integrations`:

| Method+Path | Purpose |
|---|---|
| `GET /api/integrations` | List adapters + connection state |
| `POST /api/integrations/:provider/pat` | PAT auth |
| `POST /api/integrations/:provider/caldav` | CalDAV auth |
| `GET /api/integrations/:provider/oauth/start` | OAuth start URL |
| `GET /api/integrations/:provider/oauth/callback` | OAuth code exchange |
| `POST /api/integrations/:provider/sync` | Trigger sync now |
| `POST /api/integrations/:provider/config` | Provider-specific config |
| `GET /api/integrations/notion/databases` | List Notion dbs the token can see |
| `GET /api/integrations/trello/boards` | List Trello boards |
| `GET /api/integrations/linear/teams` | List Linear teams |
| `DELETE /api/integrations/:provider` | Disconnect (optionally wipe cache) |

## Read merge: how `/api/events` and `/api/tasks` work

**`/api/events`**: returns Google events (live-fetched from each visible
calendar) + `events_native` rows + `events_cache` rows where
`provider != 'google_calendar'`. Native and Microsoft/CalDAV events are
appended after the Google merge — no dedup across sources because they
represent genuinely separate events.

**`/api/tasks`**: returns Todoist tasks (live from Todoist API) +
`tasks_native` rows + `tasks_cache` rows where `provider != 'todoist'`.
Native and provider-cached projects merge into the `projects` array too.

## Front-end routing

The events store and tasks store inspect the `provider` field on each
record and route mutations to either `/api/native/...` or `/api/...`.
Native is the default for `createEvent` / `createTask` when no provider
is specified — we want first-time users to land in the native flow
without accidentally requiring an integration.

## Cron / background sync

Not yet wired — adapters expose `syncTasks(userId)` and `syncEvents(userId)`
but only the manual "Sync now" button in the Settings UI calls them.
**TODO**: cron loop iterating connected integrations, calling sync per
provider every N minutes (likely 15m for tasks, 5m for calendar).

## Adding a new integration

1. Create `backend/integrations/<provider>/adapter.js`.
2. Implement what you can; the rest goes through `_stub.js`.
3. Add the import + array entry to `backend/integrations/registry.js`.
4. If the provider needs server-side env vars, set `requiresEnv: [...]`
   so the UI shows a hint to the operator.
5. PAT-based providers need `authValidatePat`. OAuth providers need
   `authStartUrl` + `authCallback`. CalDAV providers need
   `authValidateCaldav`.
6. Sync must upsert into `tasks_cache` (with `provider = '<provider>'`)
   or `events_cache` — never directly into the native tables.
7. Add provider-specific config endpoints to `backend/routes/integrations.js`
   if the user needs to pick e.g. a board/database/team after connecting.
