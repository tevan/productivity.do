# Notes feature roadmap

**Date:** 2026-04-30
**Status:** Tier 1 + Tier 2 (selective) — implementation in progress

This is the master reference for what the Notes editor in productivity.do
does, what it deliberately doesn't, and what we considered from the
broader notes-app landscape.

## Philosophy

- **Fast markdown text editor**, not a block-based document app.
- **Local-first** — notes live in our SQLite, with future Obsidian sync as
  an opt-in (deferred).
- **Don't become Notion** — see `holistic-views.md` for the bloat
  antidote. Hard limits on what notes do.

## Tier 1 — ship now

### 1. Edit / Preview toggle (Joplin, Obsidian)

Markdown source on one side or with a toggle button. Default opens in a
hybrid mode (Edit by default, with a Preview button that swaps the pane
to rendered markdown). Optional split-pane for wide screens.

**Why:** the body is already markdown; rendering it is table stakes.

### 2. Slash commands (Notion, Evernote)

Type `/` at the start of a line to get a popup menu with quick inserts:

- `/h1`, `/h2`, `/h3` — headings
- `/checklist` — `- [ ] `
- `/list` — `- `
- `/numbered` — `1. `
- `/quote` — `> `
- `/code` — fenced code block
- `/divider` — `---`
- `/table` — small markdown table skeleton
- `/today` — insert today's date

**Why:** fastest way to insert structure without leaving the keyboard.
Text-only insertion means no fragile menu UI to maintain.

### 3. Markdown shortcuts (Bear, Logseq)

While typing, auto-format common patterns the moment the trigger
character is typed:

| You type | It becomes |
|---|---|
| `# ` (at line start) | H1 |
| `## ` | H2 |
| `### ` | H3 |
| `- [ ] ` | checkbox |
| `- ` | bulleted list item |
| `1. ` | numbered list |
| `> ` | blockquote |
| ` ``` ` (three backticks + space) | code block |
| `---` (then Enter) | horizontal rule |

These work in BOTH edit and preview modes — preview just renders the
already-formatted markdown.

### 4. (DEFERRED) Wiki-links `[[Note name]]`

**Considered, not building yet.** Would let users link notes to other
notes by name with autocomplete. Strong feature for power users (Obsidian,
Roam, Bear). Skipped this round to keep scope tight; revisit when notes
graph density justifies it.

### 5. (DEFERRED) Backlinks panel

**Considered, not building yet.** "Notes linking to this note" panel at
the bottom of each note. Cheap to compute (one SQL scan), high mental-
model value. Pairs with wiki-links — defer both together.

### 6. (DEFERRED) Tags via `#tag`

**Considered, not building yet.** Inline hashtag becomes filterable. Bear
and Logseq use this as their primary organization. Folders + tags is
overkill for our use; skip until users ask.

## Tier 2 — ship after Tier 1 lands

### 7. Tables (Notion, Joplin, Apple Notes)

Markdown table syntax already renders in preview. Add a `/table`
slash-command that drops in a 2×2 skeleton, plus Tab/Shift+Tab cell
navigation in edit mode. Optional `+` row/col buttons next to a focused
table.

### 8. Code blocks with syntax highlighting (Joplin)

Triple-backtick already produces `<pre><code>` in preview. Wire up Shiki
(~30KB) or highlight.js for syntax colors. Auto-detect language from the
fence (` ```js `).

### 9. (PER-USER OPT-IN) Daily notes (Obsidian, Logseq, Roam)

A pref toggle (`prefs.dailyNotes`) that, when on, surfaces today's note
in the sidebar's Notes tab as a pinned "Today — May 1" entry. Note key
is the date string. Opens with a simple `## ${date}` template.

**Why opt-in:** journalers love this; many users won't use it. Off by
default.

### 10. Linked-to events/tasks (our differentiator)

Already half-built via cross-resource links (`docs/internal/cross-
resource-links.md`). Surface a "Linked" header at the top of the editor
listing the events/tasks this note is attached to. Click to open.

## Tier 3 — deferred or rejected

### Defer (might revisit later)

- **AI assistance** (Notion AI, Craft AI, OneNote Copilot) — the moment
  users tell us what they actually want from AI in notes, we can wire
  Anthropic. Today, "summarize this" and "rewrite this" are speculative.
- **Web clipper** (Evernote, Joplin, Craft) — browser extension is
  effectively a separate product. Defer indefinitely; revisit when notes
  retention justifies the engineering cost.
- **Real-time collaboration** (Notion) — only if Team-plan demand
  surfaces. Today every user owns their notes; no shared editing.
- **OCR / audio / handwriting** (Evernote, Apple Notes, OneNote) — out
  of scope for a SaaS calendar+tasks+notes app. Apple's strengths here
  rely on iOS frameworks we don't have.
- **Templates** (Evernote, Notion) — useful but not until we have
  enough users to know which templates matter. Trivial to add later
  (just a `templates` table mirroring the existing `event_templates`
  pattern).
- **Document scanning / PDF annotation** (Evernote, Logseq) — niche.

### Reject (does not fit our philosophy)

- **Block-based editor** (Notion, Craft) — fundamental architecture
  change away from markdown text. Huge engineering investment, hostile
  to local-first storage, hostile to Obsidian sync. **Hard pass.**
- **Databases / Bases / Dataview** (Notion, Obsidian Bases, Logseq
  queries) — this is the slope to Notion bloat. Notes are notes, not
  spreadsheets. **Hard pass.**
- **Graph view** (Obsidian, Roam) — beautiful demo, low ROI. The 1% of
  users who care can use Obsidian directly via our future sync.
- **Plugin system** (Obsidian, Logseq, Joplin) — power-user catnip;
  every plugin is a perpetual maintenance burden, security risk, and
  source of bug reports. **Hard pass.**
- **Spaces / shared workspaces** (Evernote) — out of scope until Team
  plan demand surfaces; even then, our Team plan is for booking, not
  notes collaboration.
- **Inline calculations** (Evernote) — niche; users wanting this should
  reach for a spreadsheet.
- **Apple Pencil / handwriting** (Apple Notes, OneNote) — requires
  native iOS/Mac code we don't have.

## Where this fits our differentiation

We're not trying to beat Obsidian at being Obsidian, or Bear at being
Bear. The differentiator is:

> Notes that link cleanly to your calendar and tasks, in the same fast
> app where you live.

Everything else is supporting cast. If a note feature doesn't help with
that core differentiator OR isn't table-stakes-text-editor (markdown
render, syntax highlight, code blocks), it doesn't belong.

## What competitors do well that we should learn from

- **Bear**: typography. Make notes feel pleasant to read. Use a real
  reading-line-length, balanced font sizing.
- **Obsidian**: keyboard shortcuts everywhere. Every action has a
  binding.
- **Craft**: fast, gorgeous. Snappy interactions, no loading skeletons.
- **Logseq**: instant capture (Daily Note as default surface). Lower
  the friction to "I just want to write down this thing."
- **Joplin**: cross-platform, no lock-in. Our equivalent: future
  Obsidian-sync option.
