// Pure helpers for recurring-event scope semantics. Both the PUT-edit
// and DELETE-with-scope flows need to terminate a parent series at a
// specific instance, so the math lives here for testability and reuse.

/**
 * Compute the RFC-5545 UNTIL value for "following" splits — i.e., the
 * latest moment the parent series should still produce instances. We
 * subtract one second from the instance start so the split-off instance
 * itself is no longer covered by the parent series, and format the
 * result as `YYYYMMDDTHHMMSSZ` per RFC-5545 §3.3.5.
 *
 * @param {string} instanceStart  ISO-8601 timestamp (e.g. '2026-05-15T14:00:00-04:00').
 * @returns {string|null}         UTC basic-format string, or null on bad input.
 */
export function computeUntilForFollowing(instanceStart) {
  if (!instanceStart) return null;
  const t = new Date(instanceStart).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t - 1000).toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
}

/**
 * Apply an UNTIL terminator to every RRULE line in a Google-Calendar
 * `recurrence[]` array. EXDATE / RDATE / DTSTART lines pass through.
 * Existing UNTIL or COUNT clauses are stripped (only one terminator
 * is allowed per RFC-5545 §3.3.10).
 *
 * @param {string[]} lines       The current recurrence[] from Google.
 * @param {string} untilDt       UTC basic-format produced by
 *                               computeUntilForFollowing().
 * @returns {string[]}           Mutated copy with UNTIL applied.
 */
export function applyUntilToRecurrenceLines(lines, untilDt) {
  if (!Array.isArray(lines)) return [];
  if (!untilDt) return [...lines];
  return lines.map((r) => {
    if (typeof r !== 'string') return r;
    if (!/^RRULE:/i.test(r)) return r;
    const body = r
      .replace(/^RRULE:/, '')
      .split(';')
      .filter((p) => p && !/^(UNTIL|COUNT)=/i.test(p));
    body.push(`UNTIL=${untilDt}`);
    return `RRULE:${body.join(';')}`;
  });
}

/**
 * Validate a delete/edit scope value. The three legal values mirror
 * Google Calendar's recurring-event semantics:
 *   - 'instance'   : just this occurrence (default).
 *   - 'series'     : the entire parent series.
 *   - 'following'  : this instance and every future one.
 *
 * @param {string} value
 * @returns {'instance' | 'series' | 'following'}
 */
export function normalizeScope(value) {
  if (value === 'series' || value === 'following') return value;
  return 'instance';
}
