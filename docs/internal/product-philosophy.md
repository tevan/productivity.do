# Product philosophy: the day surface

> Authored 2026-05-02. Captures the framing decisions made during a long session about what productivity.do is and isn't, so future-us doesn't have to reinvent the answer when we're tempted to bolt on email/storage/chat.

## What productivity.do is

**A day surface.** Not "a productivity suite," not "an everything app," not
"a Notion competitor" — the place a user goes to plan the day, see what's
on it, decide what's next, and capture what they don't want to forget.

Three primary verbs:
- **Plan** — committing future-you to something (calendar event, task with
  a due date, booking page slot, focus block).
- **Capture** — writing down a thought, idea, or context without
  committing to action yet (note, untimed task, comment).
- **Schedule** — making yourself available to others on your terms
  (booking pages, time polls, routing forms, single-use invites).

Every shipped feature must answer "yes" to: *does this help the user
plan, capture, or schedule their day?*

## What it isn't

Three things people will reasonably ask us to add — that we should
politely decline:

| Surface | Why people ask | Why we don't |
|---|---|---|
| **Email inbox** | "I live in email; put it in productivity.do" | Email is an inbox for *other people's* intentions. The day surface exists so the user has a place where email *isn't*. |
| **File storage** | "I should be able to attach Drive files" | A 200GB Drive is somebody else's archive of decisions. Linking to a Drive URL inside a task's description is fine; replicating Drive is noise. |
| **Chat/messaging** | "Slack threads inside tasks" | Same as email. We do receive Slack slash-commands (push *into* the day surface) but never replace the chat tool. |

The defensible position: **we plug in the systems users already use, but
we don't replace them.** Integrations exist to reduce duplicate input,
not to consolidate everyone's stack into ours.

## Where it gets fuzzy

**Integrations.** Notion / Linear / Trello / Todoist / Asana / Jira are
all "plan, capture, schedule" tools — they fit the philosophy. Importing
39 of them dilutes the focus when we should be sharpening it. Keep the
direction ("we sync with what you already use") but be willing to mark
half the marketplace "Coming soon — vote with a click" and only build
the ones actual users vote for.

**AI features.** AI prep, auto-schedule, AI support chat — these all
service "decide what's next" / "see what's on the day," so they pass.
*AI that writes content for you* (rephrase emails, summarize meeting
notes you didn't take) starts to drift. Test it against the verbs.

**Notebooks / docs.** A long-form writing surface (Notion-style) is the
biggest temptation because it sells well. Hold the line: notes are for
*capture*, not for *publishing*. If a user wants a CMS or a wiki, that's
not us.

## Marketing copy implications

The criticism "this looks arbitrary / lacks features" only sticks when
the negative space is unstated. Apple's "what's a computer" ads work
because they're *opinionated*. The website should say what we don't do
as loudly as what we do.

Draft taglines that lead with the negative space:

- **Plan, capture, schedule. Nothing else.**
- **Your day, in one place. Not your inbox.**
- **The opinionated calendar.**
- **Productivity, without the sprawl.**

The worst marketing copy is "everything you need." It's both untrue and
unappealing.

## Decision filter for new features

When considering whether to build feature X, ask in order:

1. **Does X help the user plan, capture, or schedule the day?** If no,
   stop. Put it on a "wouldn't it be cool" list and move on.
2. **Does X belong in the day surface or in a tool the user already
   has?** If they already have a great tool for X (email client, file
   storage, chat), default to integrating, not replacing.
3. **What does X displace?** Every feature added crowds the others. If
   X means moving something else off the page, what is it?
4. **Could one good integration with someone else's tool deliver the
   same value?** If yes, integrate.
5. **Does X harden the philosophy or weaken it?** Features that make
   the brand more recognizable beat features that broaden the surface.

## Cited inspirations

- 37signals/Basecamp's "It's the opposite of all-you-can-eat" ethos
- Cal Newport's "deep work" framing (the day surface as a focus tool,
  not a notification firehose)
- Apple's negative-space marketing (saying what something *isn't*)
- The decision to NOT clone Notion or Asana, pre-empted by 1Password's
  decision to NOT add a generic notes feature

## When to revisit this doc

- Every quarter as a sanity check
- Whenever the backlog has more than 3 items that aren't "plan, capture,
  schedule"
- Before shipping an integration that sits in a category we don't yet
  serve (chat, storage, email, CRM)
- After every product-strategy book reading lands in the reference
  library — the doc should evolve as the thinking sharpens
