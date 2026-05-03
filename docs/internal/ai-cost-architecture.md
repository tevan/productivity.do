# AI cost & architecture — when we use LLMs and when we don't

**Date:** 2026-05-02
**Status:** Reflects current architecture; review when adding any new AI-powered feature.

This doc captures *where AI is on the critical path* in productivity.do,
where it deliberately isn't, and the cost math at various scales. The
purpose is two-fold:

1. **Anti-temptation lens.** Resist the urge to "just add an LLM" to a
   feature when deterministic logic suffices. Every LLM call is a place
   a cheaper-model competitor can undercut us.
2. **Confidence at scale.** Know that AI cost won't balloon as users
   grow. The architecture was designed to keep AI off the daily-grind
   critical path.

## The principle

> The moat is the ranker, not the LLM call.

If we had an LLM rank tasks, anyone could clone it by piping their data
into Claude. Our ranker is a specific weighted formula tuned to our
data model — copy-able in shape, not in fit. This same logic applies
to project momentum, the cross-pillar timeline, time-to-close, and
every other "compress structured state into a decision" surface.

Use AI only where it's clearly the best tool: transcription,
classification, single-shot synthesis. Not where deterministic logic
suffices: ranking, sorting, filtering, aggregating, scheduling.

## Where AI is on the path today

Three narrow surfaces, each cached or rate-limited:

### 1. Voice routing — `/api/voice/route`

User speaks 5-10 seconds → Claude Haiku 4.5 classifies into
task/event/note/comment + extracts fields → preview card → user
confirms.

- **Model:** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`).
- **Tokens per call:** ~150 in, ~80 out.
- **Cost per call:** ~$0.0001.
- **Latency:** ~800ms-1.5s (acceptable for voice with confirmation).
- **Cache:** None — voice utterance is single-shot.
- **Failure mode:** 503 if `ANTHROPIC_API_KEY` unset; preview card
  becomes manual-edit fallback.

### 2. Meeting prep — `/api/events/:calId/:eventId/prep`

User clicks "Prep with AI" on an event → Haiku synthesizes a ~350-token
brief from title + description + attendees + linked notes.

- **Model:** Claude Haiku 4.5.
- **Tokens per call:** ~600 in, ~350 out.
- **Cost per uncached call:** ~$0.0005.
- **Latency:** ~1-2s.
- **Cache:** Hashed by `inputHash` (sha256 over title/desc/start/
  location/attendees → first 16 hex). Re-renders for the same input
  are free. Stored on `events_cache.prep_summary` /
  `prep_generated_at` / `prep_input_hash`.
- **Failure mode:** 503 if `ANTHROPIC_API_KEY` unset; UI shows
  "configure key" hint.

### 3. AI support chat — `/api/support-chat`

User opens Settings → Help → AI assistant, asks a question. We
retrieve relevant KB articles + send Haiku a constrained prompt
(no tools, no DB access, no env access).

- **Model:** Claude Haiku 4.5.
- **Tokens per call:** ~1500 in (KB context + history), ~250 out.
- **Cost per turn:** ~$0.001-0.003.
- **Latency:** ~1.5-3s.
- **Rate limit:** 25 messages/UTC-day per user, soft warning at 20.
  Tracked in `support_chat_usage(user_id, day, msg_count)`.
- **Cache:** None per-call, but the KB articles are loaded once via
  `getArticles()` in `lib/kb.js`.
- **Failure mode:** 503 if key unset; assistant shows "AI assistant
  is not configured" message.
- **Trigger words** (refund/cancel/legal/breach/etc.) short-circuit
  the LLM call entirely and email the transcript to `SUPPORT_EMAIL`.

## Where AI is NOT on the path (and shouldn't be)

These surfaces use deterministic logic — pure SQL, arithmetic, or
simple algorithms. They handle the daily-grind interactions and run
free + fast forever.

| Surface | What it does | Implementation |
|---|---|---|
| Decision ranker | Compresses calendar + tasks + projects → ranked next-action list | `backend/lib/ranker.js` — composite weighted score in pure JS |
| `/api/today` | Returns the synthesis payload for TodayPanel | SQL aggregations + ranker |
| Project momentum | Classifies project as moving/stalled/idle | SQL over `completed_at` in `tasks_cache` |
| Cross-pillar timeline | Per-day / per-project chronological view | SQL JOIN over `revisions` + `links` |
| Estimation Intelligence | Compares estimated vs actual minutes | SQL aggregation over `tasks_cache.estimated_minutes` and time-block durations |
| Time Ledger | Where hours went, by category | SQL aggregation over events |
| `findFreeSlots` | Finds free slots across calendars | Interval arithmetic over busy intervals |
| Auto-schedule | Places a task on the calendar at the next free slot | `findNextFreeSlot` + work-hours filter |
| Voice classification fallback | If LLM fails, regex + keyword routing | Simple rules in `lib/voice/fallback.js` |
| Search | Cmd+F event/task/note search | LIKE queries; no embeddings, no semantic layer |
| Booking slot computation | Available slots for `/book/:slug` | `computeSlots` in `lib/booking.js` |
| Webhook event matching | Routes `task.created`, `event.created`, etc. | Subscription table lookup |

This is the architectural moat. The decision-moment surfaces — the
TodayPanel, the ranker, the timeline — are all deterministic. They
respond in 30-200ms, work offline, and can be audited in one
sentence per ranked item.

## Cost math

### Per active user per day

| Feature | Calls/day | $/call | $/day |
|---|---|---|---|
| Voice routing | 5 | $0.0001 | $0.0005 |
| Meeting prep (uncached) | 3 | $0.0005 | $0.0015 |
| Support chat | 0.5 (median) | $0.002 | $0.001 |
| **Total realistic** | | | **~$0.003** |
| **Total worst-case** | (heavy voice + many meetings + support) | | **~$0.10** |

Realistic average: **~$0.01-0.03/active user/day.**
Worst case (rare): **~$0.10/active user/day.**

### At 10K DAU (serious-business scenario)

| Feature | Daily volume | $/day | $/year |
|---|---|---|---|
| Voice routing | 5,000 calls | $0.50 | $180 |
| Meeting prep | 30,000 uncached calls | $15 | $5,475 |
| Support chat | 3,000 sessions | $15 | $5,475 |
| **Total** | | **~$30/day** | **~$11,000/year** |

Revenue at 10K DAU on Pro ($12/mo): **$1.44M ARR.**
AI cost as % of revenue: **~0.8%.**

The dominant infrastructure cost at that scale isn't AI — it's
**storage** (file uploads, attachments, revisions) and **bandwidth**
(sync traffic, image hosting). Both scale linearly with user count,
not with AI usage.

### Why MCP calls don't add cost

When ChatGPT/Claude/Gemini call our `plan_today` MCP tool:
1. They invoke our endpoint.
2. We run the deterministic ranker (SQL).
3. We return the structured response.
4. The calling agent wraps it in conversation on their side, paying
   their own LLM cost.

**We pay $0 per MCP call.** The more agents call us, the more
distribution we get without AI cost scaling on us. This is the
inverse of an LLM-wrapper product — we're the structured backend
the agent reaches into; the agent eats the LLM bill.

## What would balloon costs (and how we avoid each)

| Anti-pattern | Why it's bad | How we avoid it |
|---|---|---|
| Letting LLMs see whole inboxes | Granola-shape; high token cost per active user | We don't ingest inboxes by design |
| LLM-generated summaries on every list-load | N×LLM calls per page render | Aggressive caching: 5-min SWR for events, hash-keyed cache for AI prep |
| Long context windows for "personal AI" | Token cost balloons with user history | We architecturally don't have a "Claude knows your whole life" feature; the synthesis layer compresses first, sends a small payload |
| Unbounded retries on LLM calls | Cascading cost on flaky network days | Every AI call has a 15s timeout, 1 retry max, falls back to a useful response |
| LLM in the decision-moment loop | 1-3s latency per request, $0.001-$0.01 per request, non-deterministic | Decision ranker is pure SQL+arithmetic; LLM never on the critical path |
| Per-keystroke AI suggestions | Every keystroke = LLM call = unbounded cost | Not a feature; we don't ship inline AI typing |

## Architectural rule

When evaluating any new feature that involves "and an AI helps with X":

1. **Can the decision be made deterministically?** If yes, do that. Pure
   SQL > arithmetic > simple rules. Every level up is a step toward
   commodity-LLM-wrapper territory.
2. **If AI is genuinely required, can the result be cached?** Cache
   keyed on a content hash, with a clear invalidation rule.
3. **If caching doesn't help, can it be rate-limited?** Per-user daily
   budget, soft warning before hard limit.
4. **If none of the above, is the cost <$0.01/active user/day?** If
   yes, ship it. If no, redesign.

## When to revisit this doc

- New AI-powered feature in design → walk through the rule above.
- New foundation model with materially different cost profile (e.g.,
  Haiku 5 if it ships at half the per-token cost) → re-baseline the
  numbers.
- AI cost as % of revenue exceeds 5% in any monthly bill → the
  architecture has drifted; find the offender.
- Adding voice features that aren't push-to-talk + confirm → the
  always-on / multi-step orchestration cost profile is very
  different (continuous transcription + multiple LLM turns per
  utterance) and the failure modes are documented in the strategy
  doc as a non-starter.

## Customer-facing implication

When pitching to security-conscious or finance-conscious customers,
the right framing is:

> "AI is in three narrow places: voice classification, single-shot
> meeting briefs, and our help-desk assistant. Every other surface —
> ranking your day, scheduling, notifications, search, your timeline
> — runs on deterministic logic. Your data is processed by AI only
> at moments you explicitly trigger, and even then with cached,
> rate-limited, structured prompts. We don't ingest your inbox or
> your screen. The AI cost of running this product for you is
> roughly 1% of your subscription."

That's a real differentiator vs. "AI-first" tools that quietly send
your entire workspace to a model on every interaction.
