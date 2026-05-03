/**
 * Tests for timeline.js — runnable under vitest if/when we add it.
 * Documents the load-bearing invariants:
 *
 *   1. SQLite's `YYYY-MM-DD HH:MM:SS` (no tz) is treated as UTC, not local.
 *   2. Every source produces the same TimelineRow shape; `kind` lets the
 *      UI branch consistently.
 *   3. `future` flag is derived from `nowMs` — pure, deterministic.
 *   4. Sorting is stable: ties broken by id so re-renders don't reshuffle.
 *   5. groupByDay buckets in caller's tz, not server tz.
 *
 * To run (after `npm i -D vitest`):
 *   npx vitest backend/lib/timeline.spec.js
 */

import { describe, it, expect } from 'vitest';
import {
  buildTimelineRow,
  sortTimelineRows,
  groupByDay,
  isoFromSqliteUtc,
  extractLabelFromRevision,
  humanSize,
  humanWhen,
  TIMELINE_KINDS,
  ALL_KINDS,
} from './timeline.js';

const NOW_MS = Date.parse('2026-05-02T14:00:00Z');

// ---------------------------------------------------------------------------
// SQLite timestamp normalization
// ---------------------------------------------------------------------------
describe('isoFromSqliteUtc', () => {
  it('appends Z to SQLite no-tz timestamps', () => {
    expect(isoFromSqliteUtc('2026-05-02 14:00:00')).toBe('2026-05-02T14:00:00Z');
  });
  it('passes through ISO-8601 unchanged', () => {
    expect(isoFromSqliteUtc('2026-05-02T14:00:00Z')).toBe('2026-05-02T14:00:00Z');
    expect(isoFromSqliteUtc('2026-05-02T14:00:00-04:00')).toBe('2026-05-02T14:00:00-04:00');
  });
  it('returns null for empty / non-string', () => {
    expect(isoFromSqliteUtc(null)).toBe(null);
    expect(isoFromSqliteUtc('')).toBe(null);
    expect(isoFromSqliteUtc(123)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Per-source builders — verify uniform shape + correct field mapping
// ---------------------------------------------------------------------------
describe('buildTimelineRow — revisions', () => {
  it('produces a note_change row for resource=notes', () => {
    const row = buildTimelineRow('revision', {
      id: 7, resource: 'notes', resource_id: '42', op: 'update',
      created_at: '2026-05-02 13:55:00',
      after_json: JSON.stringify({ title: 'Q3 plan', body: 'lorem' }),
    }, NOW_MS);
    expect(row.kind).toBe(TIMELINE_KINDS.NOTE_CHANGE);
    expect(row.label).toBe('Q3 plan');
    expect(row.url).toBe('/notes/42');
    expect(row.icon).toBe('📝');
    expect(row.timestamp).toBe('2026-05-02T13:55:00Z');
    expect(row.future).toBe(false);
  });

  it('produces a task_change row for resource=tasks', () => {
    const row = buildTimelineRow('revision', {
      id: 8, resource: 'tasks', resource_id: 'tdt-100', op: 'create',
      created_at: '2026-05-02 13:00:00',
      after_json: JSON.stringify({ content: 'Buy milk' }),
    }, NOW_MS);
    expect(row.kind).toBe(TIMELINE_KINDS.TASK_CHANGE);
    expect(row.label).toBe('Buy milk');
    expect(row.url).toBe(null); // tasks open via context, not URL
    expect(row.icon).toBe('✓');
    expect(row.op).toBe('create');
  });

  it('falls back to placeholder labels when payload is missing', () => {
    const row = buildTimelineRow('revision', {
      id: 9, resource: 'notes', resource_id: '50', op: 'delete',
      created_at: '2026-05-02 12:00:00',
      after_json: null,
    }, NOW_MS);
    expect(row.label).toBe('(untitled note)');
  });

  it('returns null for unknown resource types', () => {
    const row = buildTimelineRow('revision', {
      id: 10, resource: 'unknown', resource_id: '1', op: 'update',
      created_at: '2026-05-02 12:00:00',
    }, NOW_MS);
    expect(row).toBe(null);
  });
});

describe('buildTimelineRow — events', () => {
  it('flags future events with `future: true`', () => {
    const row = buildTimelineRow('event', {
      google_event_id: 'g-1', summary: 'Standup', calendar_id: 'work',
      start_time: '2026-05-02T16:00:00Z', end_time: '2026-05-02T16:30:00Z',
      all_day: 0,
    }, NOW_MS);
    expect(row.kind).toBe(TIMELINE_KINDS.EVENT);
    expect(row.future).toBe(true);
    expect(row.label).toBe('Standup');
    expect(row.sublabel).toBe('work');
  });

  it('past event has future=false', () => {
    const row = buildTimelineRow('event', {
      google_event_id: 'g-2', summary: 'Breakfast', calendar_id: 'home',
      start_time: '2026-05-02T08:00:00Z', end_time: '2026-05-02T09:00:00Z',
    }, NOW_MS);
    expect(row.future).toBe(false);
  });
});

describe('buildTimelineRow — files', () => {
  it('image MIME gets the image icon', () => {
    const row = buildTimelineRow('file', {
      id: 1, original_name: 'photo.jpg', size: 524288, mime: 'image/jpeg',
      hash: 'abc', created_at: '2026-05-02 12:00:00',
    }, NOW_MS);
    expect(row.icon).toBe('🖼');
    expect(row.url).toBe('/api/files/1');
    expect(row.sublabel).toBe('512 KB');
  });

  it('non-image gets the paperclip icon', () => {
    const row = buildTimelineRow('file', {
      id: 2, original_name: 'doc.pdf', size: 100, mime: 'application/pdf',
      hash: 'def', created_at: '2026-05-02 12:00:00',
    }, NOW_MS);
    expect(row.icon).toBe('📎');
  });
});

describe('buildTimelineRow — bookings', () => {
  it('renders invitee name + start time as sublabel', () => {
    const row = buildTimelineRow('booking', {
      id: 5, invitee_name: 'Alex', page_id: 'p-1',
      start_iso: '2026-05-03T14:00:00Z', status: 'confirmed',
      created_at: '2026-05-02 11:00:00',
    }, NOW_MS);
    expect(row.kind).toBe(TIMELINE_KINDS.BOOKING);
    expect(row.label).toContain('Alex');
    expect(row.future).toBe(true);
    expect(row.op).toBe('created');
  });

  it('cancelled bookings show op=cancelled', () => {
    const row = buildTimelineRow('booking', {
      id: 6, invitee_name: 'Bob', page_id: 'p-1', status: 'cancelled',
      start_iso: '2026-05-01T14:00:00Z',
      created_at: '2026-04-30 11:00:00',
    }, NOW_MS);
    expect(row.op).toBe('cancelled');
  });
});

describe('buildTimelineRow — defensive', () => {
  it('returns null for unknown sourceType', () => {
    expect(buildTimelineRow('mystery', { id: 1 }, NOW_MS)).toBe(null);
  });
  it('returns null for null row', () => {
    expect(buildTimelineRow('event', null, NOW_MS)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Sorting + grouping
// ---------------------------------------------------------------------------
describe('sortTimelineRows', () => {
  it('newest first', () => {
    const rows = [
      { id: 'a', timestamp: '2026-05-02T10:00:00Z' },
      { id: 'b', timestamp: '2026-05-02T12:00:00Z' },
      { id: 'c', timestamp: '2026-05-02T08:00:00Z' },
    ];
    const sorted = sortTimelineRows(rows);
    expect(sorted.map(r => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('stable tiebreak by id (lexicographic desc)', () => {
    const rows = [
      { id: 'a', timestamp: '2026-05-02T10:00:00Z' },
      { id: 'b', timestamp: '2026-05-02T10:00:00Z' },
      { id: 'c', timestamp: '2026-05-02T10:00:00Z' },
    ];
    const sorted = sortTimelineRows(rows);
    expect(sorted.map(r => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('drops null/undefined entries defensively', () => {
    const rows = [null, { id: 'a', timestamp: '2026-05-02T10:00:00Z' }, undefined];
    expect(sortTimelineRows(rows)).toHaveLength(1);
  });
});

describe('groupByDay', () => {
  it('buckets rows by tz-rendered day', () => {
    const rows = [
      { id: 'a', timestamp: '2026-05-02T23:00:00Z' }, // 7 PM EDT (May 2)
      { id: 'b', timestamp: '2026-05-03T03:00:00Z' }, // 11 PM EDT (May 2)
      { id: 'c', timestamp: '2026-05-03T16:00:00Z' }, // noon EDT  (May 3)
    ];
    const groups = groupByDay(rows, 'America/New_York');
    expect(groups).toHaveLength(2);
    expect(groups[0].day).toBe('2026-05-02');
    expect(groups[0].items.map(r => r.id)).toEqual(['a', 'b']);
    expect(groups[1].day).toBe('2026-05-03');
  });

  it('falls back to UTC when tz omitted', () => {
    const rows = [{ id: 'a', timestamp: '2026-05-02T23:00:00Z' }];
    const groups = groupByDay(rows);
    expect(groups[0].day).toBe('2026-05-02');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
describe('humanSize', () => {
  it('B / KB / MB units', () => {
    expect(humanSize(512)).toBe('512 B');
    expect(humanSize(1024)).toBe('1 KB');
    expect(humanSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});

describe('humanWhen', () => {
  it('formats relative time both directions', () => {
    expect(humanWhen('2026-05-02T14:30:00Z', NOW_MS)).toBe('in 30m');
    expect(humanWhen('2026-05-02T13:30:00Z', NOW_MS)).toBe('30m ago');
    expect(humanWhen('2026-05-03T14:00:00Z', NOW_MS)).toBe('in 1d');
    expect(humanWhen('2026-05-02T14:00:00Z', NOW_MS)).toBe('just now');
  });
});

describe('extractLabelFromRevision', () => {
  it('uses pre-extracted label when present', () => {
    expect(extractLabelFromRevision({ label: 'Direct' })).toBe('Direct');
  });
  it('parses note title from after_json', () => {
    expect(extractLabelFromRevision({
      resource: 'notes',
      after_json: JSON.stringify({ title: 'Big idea' }),
    })).toBe('Big idea');
  });
});

describe('TIMELINE_KINDS catalog', () => {
  it('exposes all expected kinds', () => {
    expect(ALL_KINDS).toContain('note_change');
    expect(ALL_KINDS).toContain('task_change');
    expect(ALL_KINDS).toContain('event');
    expect(ALL_KINDS).toContain('file');
    expect(ALL_KINDS).toContain('booking');
  });
});
