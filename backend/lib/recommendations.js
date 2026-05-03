/**
 * Recommendations — contract layer on top of the existing ranker.
 *
 * The decision-ranker (`backend/lib/ranker.js#rankTasks`) does all the
 * scoring. This module:
 *
 *   1. Wraps a ranked-task list with the three-part explanation contract
 *      (whyThis / whyNow / whatWouldChange) per `docs/internal/ranker-contract.md`.
 *   2. Applies the per-task pin override — pinned tasks always sort first,
 *      with a `pinned` factor visible in the explanation.
 *   3. Caps to MAX_RECOMMENDATIONS with a SCORE_FLOOR so empty/weak inputs
 *      return a short, honest list.
 *
 * Pure: no DB, no fetch, no Date.now(). Caller passes everything in,
 * including the pinned-task set and `now`. Testable in isolation; reusable
 * by the MCP `plan_today` workflow.
 */

export const SCORE_FLOOR = 0;            // ranker scores can be modest; we
                                         // accept anything > 0. Cold-start
                                         // (empty inputs) returns []
                                         // without padding.
export const MAX_RECOMMENDATIONS = 3;
export const PIN_BOOST = 1000;           // larger than any composite score
                                         // so a pinned task always wins

/**
 * @param {object}      args
 * @param {Array}       args.rankedTasks   — output of rankTasks().tasks; each
 *                                            element has {id, content, score,
 *                                            scoreReasons[[label, delta]…], …}.
 * @param {Set<string>} args.pinnedTaskIds — tasks the user pinned via
 *                                            /api/task-pins.
 * @param {object}      args.context       — { freeMinutes, insideFocusBlock,
 *                                            withinHours, hero? }
 * @param {Date}        args.now           — required.
 * @returns {Array<Recommendation>}
 */
export function buildRecommendations({
  rankedTasks = [],
  pinnedTaskIds = new Set(),
  context = {},
  now,
} = {}) {
  if (!(now instanceof Date)) {
    throw new Error('buildRecommendations: `now` is required and must be a Date');
  }
  if (!Array.isArray(rankedTasks)) return [];

  const pinned = pinnedTaskIds instanceof Set ? pinnedTaskIds : new Set(pinnedTaskIds || []);

  // Re-rank: pinned tasks first (in order), then ranker order. Don't mutate
  // the ranker's output.
  const withPinBoost = rankedTasks.map(t => {
    const isPinned = pinned.has(String(t.id));
    return {
      ...t,
      effectiveScore: (t.score || 0) + (isPinned ? PIN_BOOST : 0),
      isPinned,
    };
  }).sort((a, b) => b.effectiveScore - a.effectiveScore);

  const above = withPinBoost.filter(t => t.effectiveScore > SCORE_FLOOR);
  const top = above.slice(0, MAX_RECOMMENDATIONS);

  return top.map((t, i) => {
    const runnerUp = top[i + 1] || withPinBoost[MAX_RECOMMENDATIONS] || null;
    return {
      task: stripInternals(t),
      score: t.score || 0,
      isPinned: t.isPinned,
      factors: normalizeFactors(t.scoreReasons, t.isPinned),
      reasons: buildReasons(t, context, runnerUp),
    };
  });
}

// ---------------------------------------------------------------------------
// Factor normalization. The existing ranker returns reasons as
// [label, delta] tuples; the contract wants {key, label, delta}. We
// derive a snake_case `key` from the label so downstream code (UI, MCP)
// can branch on stable identifiers.
// ---------------------------------------------------------------------------
function normalizeFactors(scoreReasons, isPinned) {
  const out = [];
  if (isPinned) {
    out.push({ key: 'pinned', label: 'Pinned by you', delta: PIN_BOOST });
  }
  if (Array.isArray(scoreReasons)) {
    for (const r of scoreReasons) {
      if (!Array.isArray(r) || r.length < 2) continue;
      const label = String(r[0]);
      const delta = Number(r[1]) || 0;
      out.push({ key: keyFromLabel(label), label, delta });
    }
  }
  // Sort by absolute impact desc — the UI shows top reasons first.
  out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return out;
}

function keyFromLabel(label) {
  return String(label).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// ---------------------------------------------------------------------------
// Three-part explanation. Deterministic templates (no LLM).
// ---------------------------------------------------------------------------
function buildReasons(task, ctx, runnerUp) {
  const factors = normalizeFactors(task.scoreReasons, task.isPinned);
  const positives = factors.filter(f => f.delta > 0);
  const negatives = factors.filter(f => f.delta < 0);

  // Why this — top 2-3 positive labels as a clause list.
  const whyThis = positives.length === 0
    ? 'Highest-scoring task with no overriding signals.'
    : `${capitalize(positives.slice(0, 3).map(f => f.label).join(', '))}.`;

  // Why now — current context only. Skip if nothing to say.
  const whyNowParts = [];
  if (Number.isFinite(ctx.freeMinutes) && ctx.freeMinutes > 0) {
    whyNowParts.push(`${ctx.freeMinutes} min free until your next event`);
  }
  if (ctx.insideFocusBlock) whyNowParts.push('focus block in progress');
  if (ctx.withinHours === false) whyNowParts.push('outside your working hours');
  const whyNow = whyNowParts.length === 0
    ? 'Right now is a good moment.'
    : `${capitalize(whyNowParts.join('; '))}.`;

  // What would change.
  let whatWouldChange;
  if (task.isPinned) {
    whatWouldChange = 'Unpin this task to let other recommendations rise.';
  } else if (runnerUp) {
    whatWouldChange = `Closing this would surface "${truncate(runnerUp.content || runnerUp.task?.content, 50)}" next.`;
  } else if (negatives.length > 0) {
    whatWouldChange = `Resolving "${negatives[0].label.toLowerCase()}" would raise its score.`;
  } else {
    whatWouldChange = 'Completing it surfaces the next item in your queue.';
  }

  return { whyThis, whyNow, whatWouldChange };
}

function stripInternals(t) {
  // Strip our calculation-only fields before returning to the client.
  const { effectiveScore, isPinned, ...rest } = t;
  return rest;
}

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function truncate(s, n) {
  if (!s) return '';
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
