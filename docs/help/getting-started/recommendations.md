---
title: What to do right now
description: How the recommendations panel works, why it picks what it picks, and how to teach it
---

# What to do right now

The synthesis side panel (press `Y`) opens with a "Right now" block at
the top — up to three tasks the app thinks you should pick up next.

Each recommendation has three sentences:

- **Why this** — which signals contributed (priority, due date, project pin, etc).
- **Why now** — what your current context says (free minutes, focus block, working hours).
- **What would change the answer** — what would happen if you closed this task or pinned a different one.

The third sentence is the most important one. It tells you what the
system is reasoning over, so when the recommendation is wrong, you know
exactly which signal to flip. Disagreement is part of how the system
learns what matters to you.

## Pinning a task

Click the ☆ next to any recommendation. That task gets pinned to the
top of the recommendations list — it overrides every other signal. The
pin auto-expires at end of day so you don't have to remember to unpin
later.

Use this when:

- You know what you want to work on, but the recommender disagrees.
- You're in a focus block and want one specific task held in front of you.
- You want to test the system: pin something, do it, and see what comes up next.

## Empty recommendations

If the panel says "Pin a project or capture a task to teach the
recommender what matters to you," that means we don't have enough
signal yet. The recommender refuses to fake confidence on no data.

Three quick ways to teach it:

1. Pin one of your most-used projects (Tasks → project → ⭐).
2. Set a working-hours window (Settings → Day → Work hours).
3. Add a due date to one or two tasks.

After that, the panel will start ranking.

## What the system never does

- Show you completion streaks or badges.
- Send notifications about unfinished recommendations.
- Re-rank based on how long you stared at a card.
- Use a black-box AI to make the decision.

The ranker is deterministic SQL + arithmetic over your captured signals.
Every recommendation can be traced back to the exact factors that
produced it.
