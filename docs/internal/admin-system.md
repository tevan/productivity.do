# Admin system

**Date:** 2026-04-30
**Status:** Brainstorm — not yet implemented

## Two distinct concepts

This will confuse us if we conflate them, so spell it out:

1. **Operator admin (you)** — global access to all users, billing,
   support tools. Routes: `/admin/*`. Auth: `users.role = 'admin'`.
2. **Team admin (Team-plan customers)** — manages members within their
   own team. Routes: scoped to `/teams/:teamId/admin/*`. Auth:
   `team_members.role = 'owner' | 'admin'`.

Operator admin ships first. Team admin waits until Team-plan billing
goes live.

## Operator admin: features

### MVP (ship first)

- **User list** — email, plan, signup date, last seen, MRR contribution.
  Filter by plan, sort by signup date / last seen.
- **Per-user detail** — plan history, billing portal link, raw
  preferences JSON, integration connection status (Google, Todoist),
  delete-account button.
- **Impersonate** — log in *as* the user (read-only by default), with
  a non-dismissable banner saying "Viewing as user@email · Stop". Strict
  audit logging: every action under impersonation is tagged.
- **Audit log** — append-only `admin_actions` table. Every admin write
  gets a row: `(admin_id, action, target_user_id, payload_json, ip, ts)`.
  Never deletable.

### Phase 2

- **Revenue dashboard** — MRR, ARR, new vs churned this period, plan
  distribution, trial-to-paid conversion. Source: Stripe webhook events
  already flowing into our DB.
- **Cohort retention** — % of users still active 30/60/90 days post
  signup. Activity = any API hit, not just login.
- **Feature flags** — per-user or % rollout. The `prefs` table already
  has the shape (key/value); we just need a UI.
- **Health/ops** — error rate (last 24h), webhook retry queue depth,
  API rate-limit hit count, integration auth failure count.

### Phase 3

- **Content moderation** — booking pages reported as spam, abuse
  reports, manual ban/suspend.
- **Refund tool** — issue Stripe refund without leaving the admin UI.
- **Email broadcaster** — send tx-style emails to user segments
  ("everyone on Pro who signed up in the last 7 days").

## Auth model

### Schema

```sql
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';
-- 'user' | 'admin'  (operator admin only — team roles live in team_members)

CREATE TABLE admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,                 -- 'impersonate.start' | 'user.delete' | etc.
  target_user_id INTEGER,
  payload_json TEXT,                    -- before/after diff or other context
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_admin_actions_admin ON admin_actions(admin_id, created_at DESC);
CREATE INDEX idx_admin_actions_target ON admin_actions(target_user_id, created_at DESC);
```

### Middleware

```js
// requireAdmin — gates /admin/* routes.
// Requires role='admin' AND a fresh sudo session (re-auth within 15min).
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(404).end();
  // 404 not 403: don't leak existence of admin routes to non-admins.

  const sudoUntil = req.session?.sudoUntil || 0;
  if (Date.now() > sudoUntil) {
    return res.status(401).json({ ok: false, error: 'Re-auth required', code: 'sudo_required' });
  }
  next();
}
```

The frontend catches `code: 'sudo_required'` and prompts for password
before retrying the request — same pattern we use for plan-required.

### Sudo mode

Like GitHub: any sensitive action requires re-entering the password if
the last successful auth was >15min ago. Implementation: `sudoUntil`
timestamp on the session, reset whenever the user POSTs `/api/auth/sudo`
with their current password.

### Impersonation

**Two-cookie pattern**, never a single-cookie swap:

- `productivity` cookie = the admin's own session
- `productivity_impersonate` cookie = `{adminId, targetUserId, startedAt}`,
  signed separately

When `productivity_impersonate` is present, the backend treats `req.user`
as the target user, but `req.adminUser` exposes the admin. "Stop
impersonating" deletes only the impersonate cookie — admin session
survives intact.

### IP allowlist (optional, recommended early)

While you're solo operator, you can lock `/admin/*` to your home IP via
nginx. One-line rule. Defense in depth — even if `users.role` got
clobbered, a non-allowed IP still can't reach the routes.

## Team admin (later)

Skip until Team-plan billing is live. Schema sketch:

```sql
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  stripe_subscription_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'admin' | 'member'
  invited_at TEXT,
  joined_at TEXT,
  PRIMARY KEY (team_id, user_id)
);
```

Team admin features mirror operator admin but scoped:
- Member list (invite/remove)
- Role per member
- Billing (only the owner)
- Shared booking pages and round-robin pools

## Decisions deferred

- **Operator-admin UI** — separate route prefix in same SPA, or a fully
  separate app at `admin.productivity.do`? Lean toward same SPA for now;
  split later if it justifies its own bundle.
- **Audit-log retention** — 90 days vs forever? Forever feels right (small
  table, useful for forensics). Revisit if it grows unreasonably.
- **Read-only vs read-write impersonation** — start read-only. If
  customer support requires write access, add a "request write
  permission" flow with stronger logging.
