-- Google OAuth tokens
CREATE TABLE IF NOT EXISTS google_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expiry TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cached calendar list
CREATE TABLE IF NOT EXISTS calendars (
  id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  color TEXT,
  primary_cal INTEGER DEFAULT 0,
  visible INTEGER DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cached events
CREATE TABLE IF NOT EXISTS events_cache (
  google_event_id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  location TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  all_day INTEGER DEFAULT 0,
  color_id TEXT,
  recurrence TEXT,
  conference_url TEXT,
  status TEXT DEFAULT 'confirmed',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cached Todoist tasks
CREATE TABLE IF NOT EXISTS tasks_cache (
  todoist_id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  description TEXT,
  project_id TEXT,
  project_name TEXT,
  priority INTEGER DEFAULT 1,
  due_date TEXT,
  due_datetime TEXT,
  is_completed INTEGER DEFAULT 0,
  color TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Google sync state
CREATE TABLE IF NOT EXISTS sync_state (
  id TEXT PRIMARY KEY,
  sync_token TEXT,
  last_sync TEXT
);

-- Calendar sets
CREATE TABLE IF NOT EXISTS calendar_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calendar_set_members (
  set_id TEXT NOT NULL REFERENCES calendar_sets(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  PRIMARY KEY (set_id, calendar_id)
);

-- Weather cache
CREATE TABLE IF NOT EXISTS weather_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  location_lat REAL,
  location_lon REAL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User preferences
CREATE TABLE IF NOT EXISTS preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Booking pages (public scheduling links)
CREATE TABLE IF NOT EXISTS booking_pages (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  duration_min INTEGER NOT NULL DEFAULT 30,
  buffer_before_min INTEGER NOT NULL DEFAULT 0,
  buffer_after_min INTEGER NOT NULL DEFAULT 0,
  location_type TEXT NOT NULL DEFAULT 'video',  -- 'inperson' | 'phone' | 'video' | 'custom'
  location_value TEXT,
  color TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  calendar_id TEXT,             -- Google calendar to write new events to
  check_calendar_ids TEXT,      -- JSON array of calendar IDs to check for conflicts
  min_notice_min INTEGER NOT NULL DEFAULT 60,
  max_advance_days INTEGER NOT NULL DEFAULT 60,
  daily_max INTEGER,            -- nullable = unlimited
  slot_step_min INTEGER NOT NULL DEFAULT 30,
  availability_json TEXT NOT NULL DEFAULT '{}',  -- { mon: [{start:"09:00", end:"17:00"}], ..., overrides: { "2026-05-01": null|[{start,end}] } }
  timezone TEXT,                -- host timezone (defaults to user's primary)
  require_phone INTEGER NOT NULL DEFAULT 0,
  custom_question TEXT,         -- optional extra freeform question shown to invitee
  redirect_url TEXT,            -- where to send invitee after booking
  host_name TEXT,
  host_email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_booking_pages_slug ON booking_pages(slug);

-- Bookings (confirmed reservations)
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  invitee_name TEXT NOT NULL,
  invitee_email TEXT NOT NULL,
  invitee_phone TEXT,
  message TEXT,
  custom_answer TEXT,
  start_iso TEXT NOT NULL,
  end_iso TEXT NOT NULL,
  timezone TEXT,                -- invitee's tz at booking time
  google_event_id TEXT,
  google_calendar_id TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',  -- 'confirmed' | 'cancelled' | 'rescheduled'
  cancellation_reason TEXT,
  cancel_token TEXT UNIQUE,
  reschedule_token TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_page ON bookings(page_id);
CREATE INDEX IF NOT EXISTS idx_bookings_start ON bookings(start_iso);
CREATE INDEX IF NOT EXISTS idx_bookings_cancel_token ON bookings(cancel_token);
CREATE INDEX IF NOT EXISTS idx_bookings_resched_token ON bookings(reschedule_token);

-- Event types (multiple meeting types per booking page).
-- A page with no event types behaves the way it always has (single duration on the page row).
CREATE TABLE IF NOT EXISTS event_types (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,             -- url segment after /book/:pageSlug/:typeSlug
  description TEXT,
  duration_min INTEGER NOT NULL DEFAULT 30,
  buffer_before_min INTEGER NOT NULL DEFAULT 0,
  buffer_after_min INTEGER NOT NULL DEFAULT 0,
  location_type TEXT,             -- inherits from page if NULL
  location_value TEXT,
  color TEXT,
  capacity INTEGER NOT NULL DEFAULT 1,  -- group events: >1 invitees per slot
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER,                  -- nullable; only set if pay-to-book
  price_currency TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (page_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_event_types_page ON event_types(page_id);

-- Custom invitee questions per page (or per event type when type_id is set).
CREATE TABLE IF NOT EXISTS custom_questions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  type_id TEXT REFERENCES event_types(id) ON DELETE CASCADE, -- NULL = page-wide
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',  -- text | textarea | select | checkbox
  required INTEGER NOT NULL DEFAULT 0,
  options_json TEXT,                        -- JSON array for select/checkbox
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_custom_questions_page ON custom_questions(page_id);

-- Workflows / outbound webhooks per page.
CREATE TABLE IF NOT EXISTS booking_workflows (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,            -- on_booked | on_cancelled | on_reminder_24h
  webhook_url TEXT,                 -- POST a JSON body to this URL
  body_template TEXT,               -- optional JSON template (uses {{vars}})
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workflows_page ON booking_workflows(page_id);

-- Single-use private booking links.
CREATE TABLE IF NOT EXISTS booking_invites (
  token TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  type_id TEXT REFERENCES event_types(id) ON DELETE SET NULL,
  used_by_booking_id TEXT,                  -- once filled, the link is spent
  expires_at TEXT,                          -- nullable
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Routing forms (a top-level form that routes to specific pages/types).
CREATE TABLE IF NOT EXISTS routing_forms (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  questions_json TEXT NOT NULL DEFAULT '[]', -- [{id, label, type, options}]
  rules_json TEXT NOT NULL DEFAULT '[]',     -- [{when:[{q,op,value}], goto:{pageSlug,typeSlug?}}]
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_routing_forms_slug ON routing_forms(slug);

-- API keys for third-party developer access.
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  prefix TEXT NOT NULL,           -- visible identifier (e.g. "pk_live_aB3xT8")
  hash TEXT NOT NULL,             -- sha256 hex of the secret part
  name TEXT NOT NULL,             -- human-readable label
  scopes TEXT NOT NULL DEFAULT '[]',  -- JSON array of scope strings
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);

-- Outbound webhooks for third-party event subscriptions.
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,           -- shared secret used to sign payloads
  events TEXT NOT NULL DEFAULT '[]',  -- JSON array of event names
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_delivery_at TEXT,
  last_delivery_status INTEGER
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  status_code INTEGER,
  response_body TEXT,
  delivered_at TEXT,
  next_retry_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sub ON webhook_deliveries(subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry ON webhook_deliveries(next_retry_at);

-- Time-polls (Doodle-style multi-time proposals).
CREATE TABLE IF NOT EXISTS time_polls (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  invitee_email TEXT NOT NULL,
  proposed_iso_json TEXT NOT NULL,   -- JSON array of ISO strings the invitee picked
  selected_iso TEXT,                 -- the host's final pick
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | declined
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Optional columns on booking_pages (added via ALTER below for backward compat).
-- These are wrapped in a do-nothing-if-exists pattern handled in init.js.

-- Optional columns on bookings.
-- Same pattern.

-- Cross-resource links. Lets a user attach a task or note to an event without
-- mutating the source-of-truth records (Todoist task, Google event). The
-- link lives only here, so it survives renames/moves upstream.
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  from_type TEXT NOT NULL,   -- 'task' | 'note' | 'event'
  from_id   TEXT NOT NULL,   -- task.id (Todoist) | note.id | "{calendarId}|{eventId}"
  to_type   TEXT NOT NULL,
  to_id     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, from_type, from_id, to_type, to_id)
);
CREATE INDEX IF NOT EXISTS idx_links_from ON links(user_id, from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_links_to   ON links(user_id, to_type, to_id);
