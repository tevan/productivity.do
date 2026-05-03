/**
 * Tests for recommendations.js — runnable under vitest if/when we add it.
 * Until then this file documents the contract and the load-bearing
 * invariants of the explanation layer.
 *
 * To run (after `npm i -D vitest`):
 *   npx vitest backend/lib/recommendations.spec.js
 */

import { describe, it, expect } from 'vitest';
import {
  buildRecommendations,
  MAX_RECOMMENDATIONS,
  PIN_BOOST,
} from './recommendations.js';

const NOW = new Date('2026-05-02T14:30:00Z');

const baseCtx = { freeMinutes: 45, withinHours: true, insideFocusBlock: false };

function task({ id, content = `Task ${id}`, score = 10, scoreReasons = [], dueDate = null, priority = 1, estimatedMinutes = null }) {
  return { id: String(id), content, score, scoreReasons, dueDate, priority, estimatedMinutes };
}

describe('buildRecommendations — required inputs', () => {
  it('throws if `now` is missing', () => {
    expect(() => buildRecommendations({ rankedTasks: [] })).toThrow(/now/);
  });

  it('returns [] for empty input', () => {
    expect(buildRecommendations({ rankedTasks: [], now: NOW })).toEqual([]);
  });
});

describe('cap + floor', () => {
  it(`caps at ${MAX_RECOMMENDATIONS} recommendations`, () => {
    const tasks = [10, 9, 8, 7, 6, 5].map(s => task({ id: s, score: s }));
    const out = buildRecommendations({ rankedTasks: tasks, now: NOW });
    expect(out.length).toBe(MAX_RECOMMENDATIONS);
  });

  it('returns shorter list when fewer items above floor', () => {
    const tasks = [task({ id: 1, score: 5 })];
    const out = buildRecommendations({ rankedTasks: tasks, now: NOW });
    expect(out.length).toBe(1);
  });

  it('drops zero/negative scores so empty queues stay empty (cold start)', () => {
    const tasks = [task({ id: 1, score: 0 }), task({ id: 2, score: -5 })];
    const out = buildRecommendations({ rankedTasks: tasks, now: NOW });
    expect(out).toEqual([]);
  });
});

describe('pinned-task override', () => {
  it('pinned task always wins, regardless of ranker score', () => {
    const tasks = [
      task({ id: 'A', score: 100, scoreReasons: [['priority P1', 8]] }),
      task({ id: 'B', score: 5 }),
    ];
    const out = buildRecommendations({
      rankedTasks: tasks,
      pinnedTaskIds: new Set(['B']),
      now: NOW,
    });
    expect(out[0].task.id).toBe('B');
    expect(out[0].isPinned).toBe(true);
    expect(out[0].factors[0].key).toBe('pinned');
  });

  it('pinned task ordering is stable when multiple pins exist', () => {
    const tasks = [
      task({ id: 'A', score: 50 }),
      task({ id: 'B', score: 30 }),
      task({ id: 'C', score: 80 }),
    ];
    const out = buildRecommendations({
      rankedTasks: tasks,
      pinnedTaskIds: new Set(['A', 'B']),
      now: NOW,
    });
    expect(out.map(r => r.task.id)).toEqual(['A', 'B', 'C']);
  });

  it('PIN_BOOST is large enough to overcome any realistic score', () => {
    expect(PIN_BOOST).toBeGreaterThan(500);
  });

  it('whatWouldChange tells pinned users how to demote', () => {
    const tasks = [task({ id: 'A', score: 5 })];
    const out = buildRecommendations({
      rankedTasks: tasks,
      pinnedTaskIds: new Set(['A']),
      now: NOW,
    });
    expect(out[0].reasons.whatWouldChange).toMatch(/unpin/i);
  });
});

describe('factor normalization', () => {
  it('translates [label, delta] tuples into {key, label, delta}', () => {
    const t = task({
      id: 'A',
      score: 12,
      scoreReasons: [['Priority P1', 8], ['due today', 12]],
    });
    const out = buildRecommendations({ rankedTasks: [t], now: NOW, context: baseCtx });
    const factors = out[0].factors;
    // Sorted by abs(delta) desc → due_today (12) before priority_p1 (8)
    expect(factors[0]).toEqual({ key: 'due_today', label: 'due today', delta: 12 });
    expect(factors[1]).toEqual({ key: 'priority_p1', label: 'Priority P1', delta: 8 });
  });

  it('strips non-array entries from scoreReasons defensively', () => {
    const t = task({ id: 'A', score: 5, scoreReasons: ['oops', null, ['valid', 3]] });
    const out = buildRecommendations({ rankedTasks: [t], now: NOW, context: baseCtx });
    expect(out[0].factors).toEqual([{ key: 'valid', label: 'valid', delta: 3 }]);
  });
});

describe('explanation contract', () => {
  it('produces all three reason parts as non-empty strings', () => {
    const t = task({ id: 'A', score: 20, scoreReasons: [['overdue', 20]] });
    const out = buildRecommendations({ rankedTasks: [t], now: NOW, context: baseCtx });
    const r = out[0].reasons;
    expect(typeof r.whyThis).toBe('string');
    expect(typeof r.whyNow).toBe('string');
    expect(typeof r.whatWouldChange).toBe('string');
    expect(r.whyThis.length).toBeGreaterThan(0);
    expect(r.whyNow.length).toBeGreaterThan(0);
    expect(r.whatWouldChange.length).toBeGreaterThan(0);
  });

  it('whyThis cites top positive factors', () => {
    const t = task({
      id: 'A',
      score: 25,
      scoreReasons: [['overdue', 20], ['priority P1', 8]],
    });
    const out = buildRecommendations({ rankedTasks: [t], now: NOW, context: baseCtx });
    expect(out[0].reasons.whyThis.toLowerCase()).toContain('overdue');
  });

  it('whyNow surfaces freeMinutes + focus-block + working-hours context', () => {
    const t = task({ id: 'A', score: 10, scoreReasons: [['priority P1', 8]] });
    const insideFocus = buildRecommendations({
      rankedTasks: [t], now: NOW,
      context: { freeMinutes: 45, withinHours: true, insideFocusBlock: true },
    });
    expect(insideFocus[0].reasons.whyNow.toLowerCase()).toContain('focus block');

    const outsideHours = buildRecommendations({
      rankedTasks: [t], now: NOW,
      context: { freeMinutes: 45, withinHours: false, insideFocusBlock: false },
    });
    expect(outsideHours[0].reasons.whyNow.toLowerCase()).toContain('outside your working hours');

    const noEvents = buildRecommendations({
      rankedTasks: [t], now: NOW,
      context: { freeMinutes: 240, withinHours: true, insideFocusBlock: false },
    });
    expect(noEvents[0].reasons.whyNow).toContain('240');
  });

  it('whatWouldChange names the runner-up by content', () => {
    const tasks = [
      task({ id: 'A', score: 50, scoreReasons: [['overdue', 20]] }),
      task({ id: 'B', content: 'File expense report', score: 30 }),
    ];
    const out = buildRecommendations({ rankedTasks: tasks, now: NOW, context: baseCtx });
    expect(out[0].reasons.whatWouldChange).toContain('File expense report');
  });

  it('whatWouldChange falls back to a generic phrase when no runner-up exists', () => {
    const tasks = [task({ id: 'A', score: 50, scoreReasons: [['overdue', 20]] })];
    const out = buildRecommendations({ rankedTasks: tasks, now: NOW, context: baseCtx });
    expect(out[0].reasons.whatWouldChange).toMatch(/next item/i);
  });
});

describe('output shape', () => {
  it('does not leak internal fields', () => {
    const t = task({ id: 'A', score: 5 });
    const out = buildRecommendations({
      rankedTasks: [t],
      pinnedTaskIds: new Set(['A']),
      now: NOW,
    });
    expect(out[0].task).not.toHaveProperty('effectiveScore');
    expect(out[0].task).not.toHaveProperty('isPinned');
    // isPinned IS exposed on the recommendation envelope (UI needs it)
    expect(out[0].isPinned).toBe(true);
  });
});
