/**
 * Observations framework — synthesis #3.
 *
 * An observation is a pure function: (context) → Observation | null.
 *
 * Context contains:
 *   - userId
 *   - timezone (validated IANA string)
 *   - now (Date — passed in so tests can pin it)
 *   - q (better-sqlite3 prepared-statement helper)
 *
 * Each observation:
 *   - Decides whether it has anything to say (returns null if not).
 *   - Returns a {message, action, confidence, kind} when it does.
 *   - Carries a unique `id` so we can suppress dismissed observations.
 *
 * Confidence is 0..1. Used as a tiebreaker when multiple observations fire on
 * the same day. Tune with a hard upper bound: an observation can be wrong
 * (the user's data is genuinely surprising) — we want to surface, not assert.
 *
 * The action shape is intentionally narrow:
 *   { kind: 'navigate'|'task'|'pref', payload: ... }
 * The frontend renders a single button per observation. More than one
 * action button per observation breaks the "quiet" tone.
 *
 * Anti-pattern guard: every observation must include a *primary fact* the
 * user can verify themselves. "You moved this task forward 6 times" is
 * verifiable; "you procrastinate" is not.
 */

/**
 * @typedef {Object} Observation
 * @property {string}  id           — stable id, e.g. 'pushed_tasks:abc123'
 * @property {string}  kind         — observation family, e.g. 'pushed_tasks'
 * @property {string}  message      — the sentence the user reads
 * @property {{kind: string, payload: any, label: string}|null} action
 * @property {number}  confidence   — 0..1
 * @property {string[]} [evidenceIds] — task/event ids the obs draws on, for "Why am I seeing this?"
 */

/** Run all observers and return the strongest one (or null). */
export async function pickObservation(context, observers, suppressed = new Set()) {
  const all = [];
  for (const o of observers) {
    try {
      const result = await o(context);
      if (!result) continue;
      // Suppression is by id and by kind. If a user dismissed an entire
      // observation kind 3 times, we never surface it again — that's
      // the trust contract.
      if (suppressed.has(result.id)) continue;
      if (suppressed.has(`kind:${result.kind}`)) continue;
      all.push(result);
    } catch (err) {
      // One bad observer shouldn't kill the rest.
      console.warn('[observations] observer threw:', err.message);
    }
  }
  all.sort((a, b) => b.confidence - a.confidence);
  return all[0] || null;
}

/**
 * Helper: turn a list of observer modules into observer functions.
 * Each module must export `default` as a function (context) → Observation.
 */
export function asObservers(modules) {
  return modules.map(m => (typeof m === 'function' ? m : m.default));
}
