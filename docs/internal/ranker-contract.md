# Ranker contract

Single source of truth for the "what to do right now" surface. Cite this
doc when wiring new signals into the ranker, designing UI for the
recommendations block, or reasoning about why disagreement is healthy.

## Output shape

`rankTasks(inputs, opts) → Recommendation[]`

```ts
type Recommendation = {
  task: Task;                  // the original record, untouched
  score: number;               // 0..100, monotonic — higher = more confident
  factors: ScoringFactor[];    // ordered, highest-impact first
  reasons: {
    whyThis: string;           // one sentence, derived from `factors`
    whyNow: string;            // one sentence, derived from current context
    whatWouldChange: string;   // one sentence, what input flip would dethrone it
  };
};

type ScoringFactor = {
  key: string;                 // stable identifier, snake_case
  label: string;               // human-readable, sentence-case
  delta: number;               // signed contribution to score
};
```

## The three reasons

**Why this** — which captured signals contributed. Synthesized from `factors`
top-to-bottom. Avoid filler like "this looks important." Cite the actual
signal: *"Pinned by you, due tomorrow, no events on the calendar."*

**Why now** — current-time/context factors only. Calendar gap length, focus
block proximity, working-hours window, time-of-day. Avoid restating what's
already in *whyThis*.

**What would change the answer** — transparency about the ranker's mind.
*"If you complete it, the next item up is X."* or *"If you push due-date out
a day, this drops below your pinned project."*

The third reason is the trust killer: users who see the system's reasoning
in the open stay engaged when the ranker is wrong. Disagreement becomes
healthy signal (pin override, dismiss, re-rank) rather than silent
disengagement.

## Factor catalog (initial)

Every factor key is stable — UIs and downstream stores can branch on it.
Add new factors here when adding new signals; never repurpose a key.

| key                 | label                            | source                                    |
|---------------------|----------------------------------|-------------------------------------------|
| `pinned`            | Pinned by you                    | `task_pins` table (manual override)       |
| `overdue`           | Overdue                          | `tasks_cache.due_date` < today            |
| `due_today`         | Due today                        | `tasks_cache.due_date` = today            |
| `due_tomorrow`      | Due tomorrow                     | `tasks_cache.due_date` = today + 1        |
| `priority_high`     | High priority                    | `tasks_cache.priority` ∈ {3, 4}           |
| `priority_low`      | Low priority                     | `tasks_cache.priority` = 1                |
| `in_progress`       | Already started                  | `tasks_cache.local_status` = in_progress  |
| `fits_window`       | Fits the next free window        | `estimated_minutes` ≤ free gap            |
| `recent_attention`  | Recently edited                  | `tasks_cache.updated_at` < 24h            |
| `stale`             | Untouched for 30+ days           | `tasks_cache.updated_at` > 30d            |
| `blocked_until`     | Blocked until later today        | upcoming event/focus-block locks the slot |
| `outside_hours`     | Outside working hours            | now ∉ `prefs.workHours`                   |

## Scoring weights (v0)

The weights are tuned for *first-principle defensibility*, not ML. Charter
users will tell us where they're wrong. Unit-tested in `ranker.spec.js`.

```
pinned             +60   // overrides everything; manual signal trumps inferred
overdue            +25
due_today          +20
due_tomorrow       +10
priority_high      +15
priority_low        -8
in_progress        +12   // continuity > task-switch
fits_window         +8
recent_attention    +4
stale              -10   // user has implicitly deprioritized
blocked_until      -50   // hard veto: can't do it right now
outside_hours      -15   // soft veto: respect user-defined work hours
```

Score = clamp(50 + Σ deltas, 0, 100). Anchor at 50 so an ungated task with
no signals lands mid-pack instead of zero.

## Ranking output rules

1. **Cap at 3 recommendations.** Choice paralysis is a UX failure. The user
   can scroll the broader list to see more.
2. **Hard floors:** `score >= 30`. Below that, return fewer than 3 rather
   than pad with weak suggestions. A short list is honest.
3. **Tiebreakers:** higher pinned > earlier `due_date` > smaller `estimated_minutes`
   > earlier `created_at`. Document tiebreaker order in the spec.
4. **No LLM in the path.** This module is pure SQL+arithmetic. Anyone could
   clone us if we let an LLM rank. The moat is the explainable scoring
   itself, not a black box.

## Cold start

If user has zero captured signals (new account, no pins, no work hours,
empty Todoist), return an empty recommendation array AND surface the
onboarding nudge instead. *"Pin a project to teach me what matters to you."*
The ranker should not try to fake confidence on no data.

## Pin override

A pinned task forces top-of-list. Pin is per-task per-user, with optional
`expires_at` so a pin can auto-expire (default: end of day). Stored in
`task_pins(user_id, task_id, pinned_at, expires_at)`. The pinning act IS
the recommendation system — letting users disagree visibly is the loop.

## Trust signals (for charter validation, not user-visible)

When a recommendation is shown, log at minimum:
- `served` — when shown
- `started` — user clicked Start
- `completed` — task closed within N minutes of being recommended
- `dismissed` — user explicitly hid it
- `overridden` — user pinned a different task instead

These get stored in `recommendation_events`, are NOT surfaced back to the
user (no streak counters, no completion badges per `social_media_shape_distinction`
memory), and inform v1 weight tuning. Phase-2 work — out of scope for v0.

## Anti-features (reject these)

Per `time_to_close_metric.md` and `social_media_shape_distinction.md`:

- Streak counters or "you ranked X tasks this week"
- Completion percentages displayed back to user
- Engagement notifications ("Come finish your 2 remaining recommendations!")
- Reranking based on dwell time on a recommendation card
- LLM-generated explanations (defeats the explainability moat; deterministic
  templates only)

The recommendation block should *help the user leave the app with the right
decision made*. Anything that nudges them to stay is wrong-shaped.
