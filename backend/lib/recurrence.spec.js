/**
 * Tests for recurrence.js — runnable under vitest if/when we add it.
 * Until then, this file documents the contract via examples — read alongside
 * the implementation to understand the scope semantics.
 *
 * To run (after `npm i -D vitest`):
 *   npx vitest backend/lib/recurrence.spec.js
 */

import { describe, it, expect } from 'vitest';
import {
  computeUntilForFollowing,
  applyUntilToRecurrenceLines,
  normalizeScope,
} from './recurrence.js';

describe('computeUntilForFollowing', () => {
  it('returns null on empty / missing input', () => {
    expect(computeUntilForFollowing(null)).toBe(null);
    expect(computeUntilForFollowing(undefined)).toBe(null);
    expect(computeUntilForFollowing('')).toBe(null);
  });

  it('returns null on malformed input', () => {
    expect(computeUntilForFollowing('not a date')).toBe(null);
    expect(computeUntilForFollowing('2026-13-99T99:99:99Z')).toBe(null);
  });

  it('emits RFC-5545 basic UTC format (YYYYMMDDTHHMMSSZ)', () => {
    // 14:00:00Z minus one second → 13:59:59Z.
    expect(computeUntilForFollowing('2026-05-15T14:00:00Z')).toBe('20260515T135959Z');
  });

  it('subtracts exactly one second so the instance itself is excluded', () => {
    // The instance start should NOT satisfy UNTIL; the second before should.
    expect(computeUntilForFollowing('2026-01-01T00:00:01Z')).toBe('20260101T000000Z');
  });

  it('converts non-UTC offsets to UTC', () => {
    // 10:00 EDT (-04:00) is 14:00 UTC; minus one second is 13:59:59 UTC.
    expect(computeUntilForFollowing('2026-05-15T10:00:00-04:00')).toBe('20260515T135959Z');
  });

  it('handles midnight rollover across day/month/year boundaries', () => {
    expect(computeUntilForFollowing('2026-06-01T00:00:00Z')).toBe('20260531T235959Z');
    expect(computeUntilForFollowing('2027-01-01T00:00:00Z')).toBe('20261231T235959Z');
  });
});

describe('applyUntilToRecurrenceLines', () => {
  const UNTIL = '20260515T135959Z';

  it('returns [] when input is not an array', () => {
    expect(applyUntilToRecurrenceLines(null, UNTIL)).toEqual([]);
    expect(applyUntilToRecurrenceLines(undefined, UNTIL)).toEqual([]);
    expect(applyUntilToRecurrenceLines('RRULE:FREQ=DAILY', UNTIL)).toEqual([]);
  });

  it('returns a copy unchanged when untilDt is falsy', () => {
    const lines = ['RRULE:FREQ=DAILY', 'EXDATE:20260101T000000Z'];
    const out = applyUntilToRecurrenceLines(lines, null);
    expect(out).toEqual(lines);
    expect(out).not.toBe(lines); // copy, not same reference
  });

  it('appends UNTIL to a plain RRULE', () => {
    expect(applyUntilToRecurrenceLines(['RRULE:FREQ=DAILY'], UNTIL))
      .toEqual([`RRULE:FREQ=DAILY;UNTIL=${UNTIL}`]);
  });

  it('strips an existing UNTIL clause before appending', () => {
    expect(applyUntilToRecurrenceLines(['RRULE:FREQ=DAILY;UNTIL=20270101T000000Z'], UNTIL))
      .toEqual([`RRULE:FREQ=DAILY;UNTIL=${UNTIL}`]);
  });

  it('strips an existing COUNT clause (mutually exclusive with UNTIL per RFC-5545 §3.3.10)', () => {
    expect(applyUntilToRecurrenceLines(['RRULE:FREQ=WEEKLY;COUNT=10'], UNTIL))
      .toEqual([`RRULE:FREQ=WEEKLY;UNTIL=${UNTIL}`]);
  });

  it('preserves non-RRULE lines (EXDATE, RDATE, DTSTART)', () => {
    const lines = [
      'RRULE:FREQ=DAILY',
      'EXDATE:20260101T000000Z',
      'RDATE:20260201T000000Z',
    ];
    expect(applyUntilToRecurrenceLines(lines, UNTIL)).toEqual([
      `RRULE:FREQ=DAILY;UNTIL=${UNTIL}`,
      'EXDATE:20260101T000000Z',
      'RDATE:20260201T000000Z',
    ]);
  });

  it('preserves other RRULE parts (BYDAY, INTERVAL)', () => {
    expect(applyUntilToRecurrenceLines(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=2'], UNTIL))
      .toEqual([`RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=2;UNTIL=${UNTIL}`]);
  });

  it('handles multiple RRULE lines', () => {
    expect(applyUntilToRecurrenceLines(
      ['RRULE:FREQ=DAILY', 'RRULE:FREQ=WEEKLY;BYDAY=SA'], UNTIL
    )).toEqual([
      `RRULE:FREQ=DAILY;UNTIL=${UNTIL}`,
      `RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=${UNTIL}`,
    ]);
  });

  it('passes through non-string entries unchanged', () => {
    const lines = ['RRULE:FREQ=DAILY', null, 42, { foo: 'bar' }];
    expect(applyUntilToRecurrenceLines(lines, UNTIL)).toEqual([
      `RRULE:FREQ=DAILY;UNTIL=${UNTIL}`,
      null,
      42,
      { foo: 'bar' },
    ]);
  });
});

describe('normalizeScope', () => {
  it('passes through "series" and "following"', () => {
    expect(normalizeScope('series')).toBe('series');
    expect(normalizeScope('following')).toBe('following');
  });

  it('defaults to "instance" for everything else (safest scope)', () => {
    expect(normalizeScope('instance')).toBe('instance');
    expect(normalizeScope(undefined)).toBe('instance');
    expect(normalizeScope(null)).toBe('instance');
    expect(normalizeScope('')).toBe('instance');
    expect(normalizeScope('all')).toBe('instance');         // not legal
    expect(normalizeScope('SERIES')).toBe('instance');      // case-sensitive
    expect(normalizeScope(' series ')).toBe('instance');    // no trim
  });
});
