import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db = null;

export function getDb() {
  if (db) return db;

  const dbPath = join(__dirname, 'productivity.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  applyMigrations(db);

  return db;
}

// Memoized statement cache — better-sqlite3 best practice is to prepare()
// once per SQL string, not per request. Inline prepare() in route handlers
// re-compiles the SQL on every call. `q(sql)` returns the cached statement
// (preparing it on first use), keyed off the literal SQL string. Only use
// this for STATIC SQL — anything that varies per call (table names,
// dynamically-built WHERE clauses) must continue to call prepare() inline.
const stmtCache = new Map();
export function q(sql) {
  const cached = stmtCache.get(sql);
  if (cached) return cached;
  const stmt = getDb().prepare(sql);
  stmtCache.set(sql, stmt);
  return stmt;
}

// SQL identifier validator: only allow alphanumeric + underscore, not starting
// with a digit. We only call this from applyMigrations() with hard-coded
// strings, but defending here keeps this helper safe if ever reused.
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function ensureColumn(database, table, column, definition) {
  if (!IDENT_RE.test(table)) throw new Error(`Invalid table name: ${table}`);
  if (!IDENT_RE.test(column)) throw new Error(`Invalid column name: ${column}`);
  const cols = database.prepare(`PRAGMA table_info("${table}")`).all();
  if (cols.find(c => c.name === column)) return;
  database.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
}

function columnExists(database, table, column) {
  const cols = database.prepare(`PRAGMA table_info("${table}")`).all();
  return !!cols.find(c => c.name === column);
}

function applyMigrations(database) {
  // ---- Multi-tenancy: users table + user_id FKs on every owner-scoped table ----
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      email_verify_token TEXT,
      plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','team')),
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      current_period_end TEXT,
      team_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_team_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT,
      timezone TEXT,
      display_name TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);
    CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id);
  `);

  // Seed user (id=1) bridges existing single-user data to the new schema.
  // The existing PASSWORD_HASH from .env becomes this user's bcrypt hash.
  const seedEmail = process.env.SEED_USER_EMAIL || 'owner@productivity.do';
  const seedHash = process.env.PASSWORD_HASH || '$2b$10$placeholder';
  database.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, email_verified, plan)
    VALUES (1, ?, ?, 1, 'pro')
  `).run(seedEmail, seedHash);

  // SQLite forbids ADD COLUMN with both REFERENCES and a non-NULL default
  // (because the FK can't be checked atomically against existing rows). We
  // therefore add the column WITHOUT the REFERENCES clause; integrity is
  // still enforced for *new* inserts via PRAGMA foreign_keys + the implicit
  // FK relationship — all our INSERT paths supply a real user_id from
  // req.user.id so referential integrity holds in practice. The user can
  // never be deleted while children exist anyway because we soft-delete users.
  const userIdDef = 'INTEGER NOT NULL DEFAULT 1';
  ensureColumn(database, 'calendars',             'user_id', userIdDef);
  ensureColumn(database, 'events_cache',          'user_id', userIdDef);
  ensureColumn(database, 'calendar_sets',         'user_id', userIdDef);
  ensureColumn(database, 'booking_pages',         'user_id', userIdDef);
  ensureColumn(database, 'routing_forms',         'user_id', userIdDef);
  ensureColumn(database, 'api_keys',              'user_id', userIdDef);
  ensureColumn(database, 'webhook_subscriptions', 'user_id', userIdDef);

  // Indexes for new columns.
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_calendars_user ON calendars(user_id);
    CREATE INDEX IF NOT EXISTS idx_events_cache_user ON events_cache(user_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_sets_user ON calendar_sets(user_id);
    CREATE INDEX IF NOT EXISTS idx_booking_pages_user ON booking_pages(user_id);
    CREATE INDEX IF NOT EXISTS idx_routing_forms_user ON routing_forms(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_subs_user ON webhook_subscriptions(user_id);
  `);

  // Tables requiring a rebuild because the PK changes:
  //   google_tokens   — drops CHECK(id=1), keys by user_id
  //   tasks_cache     — PK becomes (user_id, todoist_id)
  //   sync_state      — PK becomes (user_id, id)
  //   preferences     — PK becomes (user_id, key)
  if (!columnExists(database, 'google_tokens', 'user_id')) {
    database.exec(`
      BEGIN;
      ALTER TABLE google_tokens RENAME TO google_tokens_old;
      CREATE TABLE google_tokens (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expiry TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO google_tokens (user_id, access_token, refresh_token, expiry, updated_at)
        SELECT 1, access_token, refresh_token, expiry, updated_at FROM google_tokens_old;
      DROP TABLE google_tokens_old;
      COMMIT;
    `);
  }

  if (!columnExists(database, 'tasks_cache', 'user_id')) {
    database.exec(`
      BEGIN;
      ALTER TABLE tasks_cache RENAME TO tasks_cache_old;
      CREATE TABLE tasks_cache (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        todoist_id TEXT NOT NULL,
        content TEXT NOT NULL,
        description TEXT,
        project_id TEXT,
        project_name TEXT,
        priority INTEGER DEFAULT 1,
        due_date TEXT,
        due_datetime TEXT,
        is_completed INTEGER DEFAULT 0,
        color TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, todoist_id)
      );
      INSERT OR IGNORE INTO tasks_cache (user_id, todoist_id, content, description, project_id, project_name, priority, due_date, due_datetime, is_completed, color, updated_at)
        SELECT 1, todoist_id, content, description, project_id, project_name, priority, due_date, due_datetime, is_completed, color, updated_at FROM tasks_cache_old;
      DROP TABLE tasks_cache_old;
      CREATE INDEX IF NOT EXISTS idx_tasks_cache_user ON tasks_cache(user_id);
      COMMIT;
    `);
  }

  if (!columnExists(database, 'sync_state', 'user_id')) {
    database.exec(`
      BEGIN;
      ALTER TABLE sync_state RENAME TO sync_state_old;
      CREATE TABLE sync_state (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        sync_token TEXT,
        last_sync TEXT,
        PRIMARY KEY (user_id, id)
      );
      INSERT INTO sync_state (user_id, id, sync_token, last_sync)
        SELECT 1, id, sync_token, last_sync FROM sync_state_old;
      DROP TABLE sync_state_old;
      COMMIT;
    `);
  }

  if (!columnExists(database, 'preferences', 'user_id')) {
    database.exec(`
      BEGIN;
      ALTER TABLE preferences RENAME TO preferences_old;
      CREATE TABLE preferences (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      );
      INSERT INTO preferences (user_id, key, value)
        SELECT 1, key, value FROM preferences_old;
      DROP TABLE preferences_old;
      COMMIT;
    `);
  }

  // ---- Existing column-level migrations (booking pages / bookings) ----
  ensureColumn(database, 'booking_pages', 'logo_url',         'TEXT');
  ensureColumn(database, 'booking_pages', 'cover_image_url',  'TEXT');
  ensureColumn(database, 'booking_pages', 'brand_color',      'TEXT');
  ensureColumn(database, 'booking_pages', 'min_gap_min',      'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'booking_pages', 'weekly_max',       'INTEGER');
  ensureColumn(database, 'booking_pages', 'has_event_types',  'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'booking_pages', 'enable_ics',       'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(database, 'booking_pages', 'send_emails',      'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(database, 'booking_pages', 'reminder_24h',     'INTEGER NOT NULL DEFAULT 1');

  ensureColumn(database, 'bookings', 'type_id',          'TEXT');
  ensureColumn(database, 'bookings', 'invite_token',     'TEXT');
  ensureColumn(database, 'bookings', 'payment_status',   "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(database, 'bookings', 'payment_intent',   'TEXT');
  ensureColumn(database, 'bookings', 'answers_json',     'TEXT');
  ensureColumn(database, 'bookings', 'reminder_sent_at', 'TEXT');

  // Auto-scheduling: per-task duration estimate. Pure local hint — Todoist
  // has no native equivalent, so we store it next to the cached task.
  ensureColumn(database, 'tasks_cache', 'estimated_minutes', 'INTEGER');
  ensureColumn(database, 'tasks_cache', 'parent_id',         'TEXT');

  // AI meeting prep — cached per event so repeat clicks don't re-bill.
  // Keyed by google_event_id which is already PK; invalidated by changing
  // the event's content (we re-prep when summary/description/start changes).
  ensureColumn(database, 'events_cache', 'prep_summary',     'TEXT');
  ensureColumn(database, 'events_cache', 'prep_generated_at', 'TEXT');
  ensureColumn(database, 'events_cache', 'prep_input_hash',  'TEXT');

  // Focus blocks — recurring weekly time-windows the user wants protected.
  // Treated as busy by auto-schedule and rendered as a soft band on the calendar.
  // weekday: 0=Sun..6=Sat. start/end are HH:MM strings in user's primary tz.
  database.exec(`
    CREATE TABLE IF NOT EXISTS focus_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      label TEXT NOT NULL DEFAULT 'Focus',
      weekday INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_focus_blocks_user ON focus_blocks(user_id, weekday);
  `);

  // In-app notification feed.
  database.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      url TEXT,
      data_json TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at);
  `);

  // Notes — local jot-down storage. Body is markdown. Pinned notes float to
  // the top of the sidebar list. Archived notes are hidden by default.
  database.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, archived_at, pinned DESC, updated_at DESC);
  `);

  // Team booking pages — multi-host support.
  //   host_user_ids:        JSON array of user ids (host_user_ids INCLUDES the
  //                         page owner unless explicitly overridden). When
  //                         present, slot computation considers all listed
  //                         users' availability; bookings are assigned by
  //                         assignment_strategy.
  //   assignment_strategy:  'single' (default, original behavior),
  //                         'round_robin' (rotate the host across bookings),
  //                         'collective' (slot must be free for all hosts).
  ensureColumn(database, 'booking_pages', 'host_user_ids',       'TEXT');
  ensureColumn(database, 'booking_pages', 'assignment_strategy', "TEXT NOT NULL DEFAULT 'single'");
  // Track the *assigned* host for each booking so round-robin can rotate.
  ensureColumn(database, 'bookings',      'assigned_user_id',    'INTEGER');

  // ICS subscription feeds — opaque token per user; rotateable from Settings.
  ensureColumn(database, 'users', 'ics_feed_token', 'TEXT');
  ensureColumn(database, 'users', 'todoist_token',  'TEXT');
  // Email-to-task: per-user secret embedded in the receive address.
  // Address shape will be u<userId>+<token>@<inbox-domain> once the mail
  // receiver is provisioned. Token here is the credential — anyone who can
  // forge mail to it can create tasks, so rotate by regenerate.
  ensureColumn(database, 'users', 'inbox_token',    'TEXT');
  ensureColumn(database, 'users', 'last_digest_at', 'TEXT');
  // Profile & soft-delete fields (added 2026-05-01).
  ensureColumn(database, 'users', 'avatar_path',    'TEXT');                 // server-relative path; null = use Gravatar
  ensureColumn(database, 'users', 'pending_email',  'TEXT');                 // new email awaiting confirmation
  ensureColumn(database, 'users', 'pending_email_token', 'TEXT');            // token sent to the new address
  ensureColumn(database, 'users', 'pending_email_sent_at', 'TEXT');
  ensureColumn(database, 'users', 'deleted_at',     'TEXT');                 // soft-delete timestamp; NULL = active
  ensureColumn(database, 'users', 'permanently_purge_at', 'TEXT');           // when the soft-deleted row gets purged

  // Booking analytics: per-page view counter + no-show flag on bookings.
  ensureColumn(database, 'bookings', 'no_show', 'INTEGER NOT NULL DEFAULT 0');
  database.exec(`
    CREATE TABLE IF NOT EXISTS booking_page_views (
      page_id TEXT NOT NULL,
      day TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (page_id, day)
    );
    CREATE INDEX IF NOT EXISTS idx_booking_page_views_day ON booking_page_views(day);
  `);

  // Persisted rate-limit bucket for /api/v1. Survives PM2 restarts so a
  // misbehaving client can't burst again immediately after a deploy.
  database.exec(`
    CREATE TABLE IF NOT EXISTS api_v1_rate_buckets (
      ratekey TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_rate_buckets_window ON api_v1_rate_buckets(window_start);
  `);

  // ---- Event templates (Fantastical-style reusable events) ----
  database.exec(`
    CREATE TABLE IF NOT EXISTS event_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      summary TEXT,
      description TEXT,
      location TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      calendar_id TEXT,
      add_meet INTEGER NOT NULL DEFAULT 0,
      attendees_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_event_templates_user ON event_templates(user_id);
  `);

  // ---- Inbound ICS calendar subscriptions ----
  database.exec(`
    CREATE TABLE IF NOT EXISTS subscribed_calendars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      color TEXT,
      visible INTEGER NOT NULL DEFAULT 1,
      last_fetched_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_subscribed_cal_user ON subscribed_calendars(user_id);

    CREATE TABLE IF NOT EXISTS subscribed_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL REFERENCES subscribed_calendars(id) ON DELETE CASCADE,
      uid TEXT NOT NULL,
      summary TEXT,
      description TEXT,
      location TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT,
      all_day INTEGER NOT NULL DEFAULT 0,
      UNIQUE (subscription_id, uid)
    );
    CREATE INDEX IF NOT EXISTS idx_sub_events_time ON subscribed_events(subscription_id, start_time);
  `);

  // ---- Hidden events (soft-hide without deleting from source calendar) ----
  database.exec(`
    CREATE TABLE IF NOT EXISTS hidden_events (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      calendar_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      hidden_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, calendar_id, event_id)
    );
  `);

  // ---- Per-calendar default reminder + custom color ----
  ensureColumn(database, 'calendars', 'default_reminder_minutes', 'INTEGER');
  // Google's accessRole — 'owner' / 'writer' / 'reader' / 'freeBusyReader'.
  // Used to split sidebar/settings into "My calendars" (owner|writer) and
  // "Other calendars" (reader|freeBusyReader), mirroring Google's grouping.
  ensureColumn(database, 'calendars', 'access_role', 'TEXT');

  // ---- RSVP events: stored as a booking_pages variant via existing table ----
  ensureColumn(database, 'booking_pages', 'is_rsvp', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'booking_pages', 'rsvp_capacity', 'INTEGER');
  ensureColumn(database, 'booking_pages', 'rsvp_deadline', 'TEXT');

  // ---- One-off appointment slots: separate from booking pages ----
  database.exec(`
    CREATE TABLE IF NOT EXISTS quick_slots (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Meeting',
      duration_min INTEGER NOT NULL DEFAULT 30,
      slots_json TEXT NOT NULL,
      timezone TEXT NOT NULL,
      booked_by_email TEXT,
      booked_at TEXT,
      booked_slot_iso TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_quick_slots_user ON quick_slots(user_id);
  `);

  // ---- Tasks board (kanban): per-user customizable columns + local status ----
  // See docs/internal/tasks-board.md for the full design rationale.
  //   tasks_cache.local_status: 'todo' | 'in_progress' | NULL.
  //                             Done is NOT stored — derived from Todoist
  //                             completion. Other statuses are local-only;
  //                             Todoist never sees them.
  //   tasks_cache.local_position: manual sort within a column. Per-column
  //                               ordering, not global. NULL = end of column.
  ensureColumn(database, 'tasks_cache', 'local_status',   'TEXT');
  ensureColumn(database, 'tasks_cache', 'local_position', 'INTEGER');

  database.exec(`
    CREATE TABLE IF NOT EXISTS task_columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      status_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, status_key)
    );
    CREATE INDEX IF NOT EXISTS idx_task_columns_user ON task_columns(user_id, position);
  `);

  // ---- Per-note color tag ----
  // Lightweight visual classification — stored as a CSS-ish hex string OR
  // one of the named slot tokens ('rose','sky',…) so it can route through
  // the active color scheme via var(--color-{slot}). Null = no color.
  ensureColumn(database, 'notes', 'color', 'TEXT');

  // ---- Integrations / sources abstraction ----
  // The "source" model: instead of hardcoding Google Calendar as the only
  // event source and Todoist as the only task source, every event/task
  // carries a `provider` column. 'native' means the user created it inside
  // productivity.do. Other providers come through registered integration
  // adapters (see backend/integrations/).
  //
  // The `integrations` table holds OAuth tokens / PATs / config per
  // (user, provider). One row per user-provider pair (UNIQUE constraint).
  // metadata_json carries provider-specific config: CalDAV url, Notion
  // database ids, Linear team ids, Trello board id list, etc.
  database.exec(`
    CREATE TABLE IF NOT EXISTS integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'connected',
      access_token TEXT,
      refresh_token TEXT,
      expires_at TEXT,
      account_email TEXT,
      metadata_json TEXT,
      last_synced_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, provider)
    );
    CREATE INDEX IF NOT EXISTS idx_integrations_user ON integrations(user_id);
  `);

  // Add provider columns to existing event/calendar/task tables. Default
  // existing rows: events_cache + calendars → 'google_calendar' (the only
  // source they could have come from); tasks_cache → 'todoist'.
  ensureColumn(database, 'events_cache', 'provider', "TEXT NOT NULL DEFAULT 'google_calendar'");
  ensureColumn(database, 'calendars',    'provider', "TEXT NOT NULL DEFAULT 'google_calendar'");
  ensureColumn(database, 'tasks_cache',  'provider', "TEXT NOT NULL DEFAULT 'todoist'");

  // Native event/task storage. We could overload events_cache/tasks_cache,
  // but a separate table for native rows keeps the cache invalidation /
  // sync tokens / Google-specific fields cleanly partitioned. The unified
  // /api/events and /api/tasks routes UNION ALL across the cache tables
  // and these.
  database.exec(`
    CREATE TABLE IF NOT EXISTS events_native (
      id TEXT PRIMARY KEY,                           -- uuid we own
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      calendar_id TEXT NOT NULL DEFAULT 'native',    -- native is a single virtual calendar per user
      summary TEXT NOT NULL DEFAULT '',
      description TEXT,
      location TEXT,
      start_at TEXT NOT NULL,    -- ISO; allDay rows use YYYY-MM-DD
      end_at TEXT NOT NULL,
      all_day INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      recurrence_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_native_user ON events_native(user_id, start_at, end_at);

    CREATE TABLE IF NOT EXISTS tasks_native (
      id TEXT PRIMARY KEY,                           -- uuid we own
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      description TEXT,
      project_id TEXT,                               -- nullable; native tasks can be project-less
      priority INTEGER NOT NULL DEFAULT 1,
      due_date TEXT,                                 -- YYYY-MM-DD or null
      due_datetime TEXT,                             -- ISO or null
      labels_json TEXT,                              -- JSON array
      estimated_minutes INTEGER,
      local_status TEXT,                             -- todo|in_progress|custom_*
      local_position INTEGER,
      parent_id TEXT,
      is_completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_native_user ON tasks_native(user_id, is_completed, due_date);

    -- Native projects (so tasks can be grouped without a Todoist account).
    -- Mirrors the shape Todoist returns so the same client code handles both.
    CREATE TABLE IF NOT EXISTS projects_native (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_projects_native_user ON projects_native(user_id, position);

    -- User sessions — one row per active sign-in. Lets the user see and
    -- revoke individual devices without nuking everyone with a token rotation.
    -- Note: cookie-session itself is stateless; this table is a parallel
    -- record we update on login/logout/heartbeat. Kept short with a TTL purge
    -- so it doesn't grow unbounded.
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,                                                    -- UUID, also stored in the cookie payload
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_agent TEXT,
      ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, revoked_at);

    -- AI support chat — daily message budget tracking + transcripts.
    -- Daily counter resets at user-local midnight (server uses UTC for now).
    CREATE TABLE IF NOT EXISTS support_chat_usage (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,                                                      -- YYYY-MM-DD UTC
      msg_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );

    -- Stored conversations — for escalation transcripts and your own audit.
    -- Kept for 90 days then auto-purged.
    CREATE TABLE IF NOT EXISTS support_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,                                               -- groups messages within a single chat
      role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_support_chat_messages_session ON support_chat_messages(session_id, created_at);

    -- Slack app: per-workspace install tokens.
    CREATE TABLE IF NOT EXISTS slack_workspaces (
      team_id TEXT PRIMARY KEY,
      team_name TEXT,
      access_token TEXT NOT NULL,                 -- bot token
      installed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Slack ↔ productivity.do user mapping. One row per (team, slack_user).
    CREATE TABLE IF NOT EXISTS slack_user_links (
      slack_team_id TEXT NOT NULL,
      slack_user_id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      linked_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (slack_team_id, slack_user_id)
    );

    -- Short-lived tokens for the slash-command-initiated linking flow.
    CREATE TABLE IF NOT EXISTS slack_link_tokens (
      token TEXT PRIMARY KEY,
      slack_team_id TEXT NOT NULL,
      slack_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
