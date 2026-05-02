# Collaboration on tasks + notes — design thinking

> Authored 2026-05-02 in response to the user's question: "allow users
> to collaborate on notes and tasks with other logged in users? and to
> leave comments on tasks, maybe notes?". **Not yet implemented; this
> is the thinking-out-loud doc to revisit before building.**

## What "collaboration" could mean

Three different scopes. Important to pick one and not blur them.

### Scope A: Comments only (lightweight)

User posts a comment on their own task or note. Nobody else sees it
unless explicitly shared. Just a thread of discussion the user can
leave for future-self. Examples:
- "tried this approach, didn't work because X"
- "ask Tina about this on Monday"
- "context dump from the call"

**Effort:** small. We already have `task_comments` (Todoist-backed).
Adding `note_comments` is a thin table + 4 routes. Maybe 1 day.

**Value:** real but bounded. Mostly an upgrade to the "capture" verb.

### Scope B: Sharing with read access (medium)

User can share a single note or task with another user (or a public
URL). Receiver sees the content read-only. No live edit.

**Effort:** medium. Needs `shares(resource, id, owner_id, recipient_id, role, token)`,
share UI on each resource, share-link viewer page, public-URL widget
(like booking pages but for notes). Maybe 3-5 days.

**Value:** medium. Useful for sending one note to a colleague, but
"I'll send a Loom / Notion link / Google Doc" already covers this and
is what most people reach for. We'd be re-creating Google Docs sharing
poorly.

### Scope C: Multi-user editing (large)

Two or more users edit the same note/task with live cursors / OT or CRDT
conflict resolution.

**Effort:** large. Needs a real-time backend (WebSocket or Yjs
provider), CRDT library (Yjs/Automerge) integrated into the editor,
presence indicators, permissioning UI. Maybe 2-4 weeks for a
stable v1.

**Value:** real but conflicts with the day surface philosophy. If
someone wants live-collab on a doc, they want Notion or Google Docs;
those tools are great at that. We'd be 80%-clone-of-Notion territory.

## What I'd recommend

**Build A. Maybe build a tiny slice of B. Definitely don't build C.**

Specifically:

1. **Note comments** (scope A). Mirror task comments. Each note can
   accumulate a thread of timestamped, markdown-supported comments.
   Useful for the user themselves; later useful when (B) ships and
   recipients can comment on shared notes.
2. **Task comments via the SPA** (already exists at the Todoist
   layer; surface in our task editor). The data is there; it just
   isn't always in the UI.
3. **Mention support inside comments** — `@user` autocomplete that
   resolves against the team's user list. Sends an in-app notification
   to the mentioned user. This is the smallest piece of multi-user
   functionality that doesn't require sharing infrastructure.

**Defer scope B/C until users actually ask.** A founder's product
intuition is famously unreliable on collaboration features — every
solo-built product has the temptation to add "team mode," and
half of them never get used. Wait for 5 paying users to ask for
sharing before building it.

## Why deferring sharing fits the philosophy

The day surface is *yours*. Multi-user editing surfaces inherit a
different mental model: the "shared workspace." Once a workspace is
shared, the user's mental model shifts from "this is my day" to "this
is our work." That's a different product, sold differently, priced
differently, supported differently. Don't accidentally become that.

If sharing ships, it should:
- Be a **light overlay** on the existing data (a note has owners +
  recipients; the recipient sees a *copy* in their day surface)
- **Never** put two users' data in the same workspace
- Always preserve "this is my day" as the primary frame

## Where comments fit in the schema

Existing: `task_comments` (proxy to Todoist).

New (when we build A):

```sql
CREATE TABLE note_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,        -- author
  note_id INTEGER NOT NULL,        -- FK to notes
  body TEXT NOT NULL,              -- markdown
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT                  -- soft-delete to play with revisions
);
CREATE INDEX idx_note_comments_note ON note_comments(note_id, created_at);
```

Keep symmetric with `task_comments` so a future "comments anywhere"
generalization is straightforward.

## When to build

**Note comments:** anytime in the next 2-3 weeks; cheap and adds depth
to the capture verb.

**Sharing (scope B):** wait for the third user request. Then design
properly — the share-token pattern from booking pages is the prior art.

**Live multi-user editing (scope C):** probably never, unless we
explicitly pivot to "team workspace" positioning. That'd be a
different company.

## Pre-emptive concerns to flag at build time

- **Privacy:** comments on a soft-deleted note — do they survive
  restore? Probably yes; they're part of the note's history.
- **Notifications:** a comment on a shared resource pings the recipient.
  Use the existing `notifications` table. Don't email by default
  (annoying); offer an opt-in.
- **Spam vector:** if sharing ships with public URLs that accept
  comments from non-users, we have a moderation problem. Either:
  (a) require the commenter to be logged in, or (b) ship sharing
  read-only and never let anonymous users comment.
- **Compliance:** comments on a soft-deleted-then-purged note get
  hard-deleted with the note. Foreign key cascade.

## Where this fits in the philosophy

Comments serve **capture** and (later) **share** verbs. Both pass the
day-surface test as long as the comment is *yours* about your work
or a colleague's note about something you both care about. Avoid
comments evolving into "discussion threads" that compete with chat
tools — keep them artifact-attached and async.
