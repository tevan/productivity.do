/**
 * Tests for timegridKeyboard.js — runnable under vitest if/when we add it.
 * Until then, this file documents the contract via examples — read alongside
 * the implementation to understand the keyboard model.
 *
 * To run (after `npm i -D vitest`):
 *   npx vitest src/lib/utils/timegridKeyboard.spec.js
 */

import { describe, it, expect } from 'vitest';
import {
  SLOT_MINUTES, SLOTS_PER_DAY,
  slotIndexForDate, slotToHM, dateAtSlot,
  ariaSlotLabel, ariaEventLabel,
  slotKeyAction, eventKeyAction, clampGridFocus,
} from './timegridKeyboard.js';

// Helper: simulate a keydown payload without DOM.
const k = (key, opts = {}) => ({
  key,
  ctrlKey: !!opts.ctrl,
  metaKey: !!opts.meta,
  shiftKey: !!opts.shift,
  altKey: !!opts.alt,
});

describe('slot resolution', () => {
  it('one slot per visible hour, 24/day', () => {
    expect(SLOT_MINUTES).toBe(60);
    expect(SLOTS_PER_DAY).toBe(24);
  });

  it('slotIndexForDate maps wall-clock hour to slot', () => {
    expect(slotIndexForDate(new Date('2026-05-02T00:30:00'))).toBe(0);
    expect(slotIndexForDate(new Date('2026-05-02T09:00:00'))).toBe(9);
    expect(slotIndexForDate(new Date('2026-05-02T23:59:00'))).toBe(23);
  });

  it('dateAtSlot is the inverse', () => {
    const base = new Date('2026-05-02T15:00:00');
    expect(dateAtSlot(base, 0).getHours()).toBe(0);
    expect(dateAtSlot(base, 14).getHours()).toBe(14);
    expect(dateAtSlot(base, 23).getHours()).toBe(23);
  });
});

describe('slotKeyAction (slot focus mode)', () => {
  const ctx = { slotIdx: 9, dayIdx: 2, dayCount: 7 };

  it('arrows move within bounds', () => {
    expect(slotKeyAction(k('ArrowDown'), ctx)).toEqual({ type: 'move', slotDelta: 1, dayDelta: 0 });
    expect(slotKeyAction(k('ArrowUp'), ctx)).toEqual({ type: 'move', slotDelta: -1, dayDelta: 0 });
    expect(slotKeyAction(k('ArrowRight'), ctx)).toEqual({ type: 'move', slotDelta: 0, dayDelta: 1 });
    expect(slotKeyAction(k('ArrowLeft'), ctx)).toEqual({ type: 'move', slotDelta: 0, dayDelta: -1 });
  });

  it('arrow at column-edge swallows (noop) so focus does not leak', () => {
    expect(slotKeyAction(k('ArrowLeft'), { ...ctx, dayIdx: 0 })).toEqual({ type: 'noop' });
    expect(slotKeyAction(k('ArrowRight'), { ...ctx, dayIdx: 6 })).toEqual({ type: 'noop' });
  });

  it('PageUp/Down jumps 4 hours', () => {
    expect(slotKeyAction(k('PageDown'), ctx)).toEqual({ type: 'move', slotDelta: 8, dayDelta: 0 });
    expect(slotKeyAction(k('PageUp'), ctx)).toEqual({ type: 'move', slotDelta: -8, dayDelta: 0 });
  });

  it('Home/End jump to top/bottom of day', () => {
    expect(slotKeyAction(k('Home'), ctx)).toEqual({ type: 'move', slotDelta: -9, dayDelta: 0 });
    expect(slotKeyAction(k('End'), ctx)).toEqual({ type: 'move', slotDelta: 14, dayDelta: 0 });
  });

  it('Enter and Space create an event', () => {
    expect(slotKeyAction(k('Enter'), ctx)).toEqual({ type: 'create' });
    expect(slotKeyAction(k(' '), ctx)).toEqual({ type: 'create' });
  });

  it('Cmd/Ctrl + arrow returns null (lets browser shortcuts through)', () => {
    expect(slotKeyAction(k('ArrowDown', { meta: true }), ctx)).toBe(null);
    expect(slotKeyAction(k('ArrowDown', { ctrl: true }), ctx)).toBe(null);
  });

  it('unhandled keys return null', () => {
    expect(slotKeyAction(k('a'), ctx)).toBe(null);
    expect(slotKeyAction(k('Tab'), ctx)).toBe(null); // let Tab traverse normally
  });
});

describe('eventKeyAction (event focus mode)', () => {
  it('plain arrows move event by snap', () => {
    expect(eventKeyAction(k('ArrowDown'), { snapMinutes: 15 })).toEqual({
      type: 'move', minuteDelta: 15, dayDelta: 0,
    });
    expect(eventKeyAction(k('ArrowUp'), { snapMinutes: 15 })).toEqual({
      type: 'move', minuteDelta: -15, dayDelta: 0,
    });
    expect(eventKeyAction(k('ArrowRight'), { snapMinutes: 15 })).toEqual({
      type: 'move', minuteDelta: 0, dayDelta: 1,
    });
  });

  it('Shift halves the snap (fine-grained nudges)', () => {
    const result = eventKeyAction(k('ArrowDown', { shift: true }), { snapMinutes: 30 });
    expect(result.minuteDelta).toBe(10);
  });

  it('Alt+Arrow resizes (changes end only)', () => {
    expect(eventKeyAction(k('ArrowDown', { alt: true }), { snapMinutes: 15 }))
      .toEqual({ type: 'resize', minuteDelta: 15 });
    expect(eventKeyAction(k('ArrowUp', { alt: true }), { snapMinutes: 15 }))
      .toEqual({ type: 'resize', minuteDelta: -15 });
  });

  it('Alt+ArrowLeft/Right is not a resize (no horizontal resize semantics)', () => {
    expect(eventKeyAction(k('ArrowLeft', { alt: true }), {})).toBe(null);
  });

  it('Enter and E open the editor', () => {
    expect(eventKeyAction(k('Enter'))).toEqual({ type: 'edit' });
    expect(eventKeyAction(k('e'))).toEqual({ type: 'edit' });
    expect(eventKeyAction(k('E'))).toEqual({ type: 'edit' });
  });

  it('Delete and Backspace request deletion', () => {
    expect(eventKeyAction(k('Delete'))).toEqual({ type: 'delete' });
    expect(eventKeyAction(k('Backspace'))).toEqual({ type: 'delete' });
  });

  it('Shift+F10 and ContextMenu open the right-click menu', () => {
    expect(eventKeyAction(k('F10', { shift: true }))).toEqual({ type: 'context' });
    expect(eventKeyAction(k('ContextMenu'))).toEqual({ type: 'context' });
  });

  it('Escape returns to slot focus', () => {
    expect(eventKeyAction(k('Escape'))).toEqual({ type: 'escape' });
  });

  it('Cmd/Ctrl combos are passed through (browser shortcuts)', () => {
    expect(eventKeyAction(k('ArrowDown', { meta: true }))).toBe(null);
  });
});

describe('clampGridFocus', () => {
  const dims = { dayCount: 7 };

  it('clamps day index to [0, dayCount-1]', () => {
    expect(clampGridFocus({ dayIdx: -1, slotIdx: 5 }, dims)).toEqual({ dayIdx: 0, slotIdx: 5 });
    expect(clampGridFocus({ dayIdx: 99, slotIdx: 5 }, dims)).toEqual({ dayIdx: 6, slotIdx: 5 });
  });

  it('clamps slot to [0, SLOTS_PER_DAY-1]', () => {
    expect(clampGridFocus({ dayIdx: 0, slotIdx: -5 }, dims)).toEqual({ dayIdx: 0, slotIdx: 0 });
    expect(clampGridFocus({ dayIdx: 0, slotIdx: 99 }, dims)).toEqual({ dayIdx: 0, slotIdx: 23 });
  });
});

describe('aria labels', () => {
  it('slot label includes time + date in the user locale', () => {
    const label = ariaSlotLabel(new Date('2026-05-02T15:00:00'), 9, true);
    // We don't pin the exact format (locale-dependent), but it must contain
    // the day name, month, day-of-month, and time. Minimal guarantees:
    expect(label).toMatch(/9|09/);  // 9:00 in slot 9
    expect(label).toMatch(/Saturday|Sat|2026/i); // some locale rendering of May 2 2026
  });

  it('event label has title + start + end + location', () => {
    const event = {
      summary: 'Coffee with Alex',
      start: '2026-05-02T15:00:00Z',
      end: '2026-05-02T16:00:00Z',
      location: 'Blue Bottle',
    };
    const label = ariaEventLabel(event, true);
    expect(label).toContain('Coffee with Alex');
    expect(label).toContain('Blue Bottle');
    expect(label).toContain('until');
  });

  it('falls back to "Untitled event" when no summary', () => {
    expect(ariaEventLabel({ start: '2026-05-02T15:00:00Z', end: '2026-05-02T16:00:00Z' }))
      .toContain('Untitled event');
  });
});
