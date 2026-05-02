/**
 * Keyboard navigation + accessibility helpers for the time-grid calendar view.
 *
 * Pure helpers only — no Svelte runtime. The component owns state; we own the
 * math. This split keeps the keyboard model testable in isolation and prevents
 * the component from accumulating ad-hoc keyboard branches over time.
 *
 * The keyboard model follows WAI-ARIA's grid pattern:
 *   https://www.w3.org/WAI/ARIA/apg/patterns/grid/
 *
 * There are two focus modes:
 *
 *   1. Slot focus  — a half-hour cell is focused. Arrows traverse the grid;
 *                    Enter/Space opens a create-event flow at that time.
 *   2. Event focus — an event chip is focused. Arrows nudge time/day;
 *                    Alt+arrows resize; Enter opens the editor.
 *
 * Mode is decided by which DOM element is focused. We don't track it as
 * separate state — DOM focus is the source of truth.
 */

// One slot per visible hour cell (24/day). The grid renders 24 hour rows;
// the keyboard model tracks one focusable cell per row to match. Finer
// resolution exists for *event* manipulation: Shift+Arrow nudges by
// `dragSnapMinutes` instead of an hour, and Alt+Arrow is the resize
// equivalent. Keeping slot resolution = visual resolution avoids
// off-by-one focus rings (focus drawing on a 30-min phantom slot that
// the user can't see).
export const SLOT_MINUTES = 60;
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;

/**
 * Compute the slot index (0..47) for a Date's wall-clock time.
 * Used by the component to decide which slot to focus on initial mount.
 */
export function slotIndexForDate(d) {
  return Math.min(SLOTS_PER_DAY - 1, Math.floor((d.getHours() * 60 + d.getMinutes()) / SLOT_MINUTES));
}

/**
 * Convert a slot index back to {hour, minute} for ARIA labels and create-event.
 */
export function slotToHM(slotIdx) {
  const minutes = slotIdx * SLOT_MINUTES;
  return { hour: Math.floor(minutes / 60), minute: minutes % 60 };
}

/**
 * Build a Date for a given (date, slotIndex).
 */
export function dateAtSlot(baseDate, slotIdx) {
  const { hour, minute } = slotToHM(slotIdx);
  const d = new Date(baseDate);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/**
 * Format a slot's time for screen readers. Avoids relying on locale defaults
 * which can be ambiguous (e.g., "01:00" — AM or PM?).
 */
export function ariaSlotLabel(date, slotIdx, is12h = true) {
  const d = dateAtSlot(date, slotIdx);
  const dayLabel = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit',
    hour12: is12h,
  }).format(d);
  return `${timeLabel}, ${dayLabel}`;
}

/**
 * Format an event chip's full descriptor for screen readers.
 */
export function ariaEventLabel(event, is12h = true) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    hour12: is12h,
  });
  const endFmt = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit', hour12: is12h,
  });
  const title = event.summary || 'Untitled event';
  const where = event.location ? `, at ${event.location}` : '';
  return `${title}, ${fmt.format(start)} until ${endFmt.format(end)}${where}`;
}

/**
 * Translate a keydown into a slot-navigation action. Returns an object
 * describing how the focused slot should change, or null if the key isn't
 * handled by the slot-focus mode.
 *
 * The component reads {dayDelta, slotDelta} and writes the new focus.
 * We don't mutate anything here — pure function, easy to test.
 */
export function slotKeyAction(e, { slotIdx, dayIdx, dayCount }) {
  const k = e.key;
  // Don't intercept when a modifier we don't use is pressed; this lets browser
  // shortcuts (Cmd+R, etc.) keep working.
  if (e.ctrlKey || e.metaKey) return null;

  if (k === 'ArrowDown') return { type: 'move', slotDelta: 1, dayDelta: 0 };
  if (k === 'ArrowUp')   return { type: 'move', slotDelta: -1, dayDelta: 0 };
  if (k === 'ArrowRight') {
    if (dayIdx < dayCount - 1) return { type: 'move', slotDelta: 0, dayDelta: 1 };
    return { type: 'noop' }; // swallow so focus doesn't leak to next focusable
  }
  if (k === 'ArrowLeft') {
    if (dayIdx > 0) return { type: 'move', slotDelta: 0, dayDelta: -1 };
    return { type: 'noop' };
  }
  if (k === 'PageDown') return { type: 'move', slotDelta: 8, dayDelta: 0 }; // 4 hours
  if (k === 'PageUp')   return { type: 'move', slotDelta: -8, dayDelta: 0 };
  if (k === 'Home') return { type: 'move', slotDelta: -slotIdx, dayDelta: 0 };
  if (k === 'End')  return { type: 'move', slotDelta: SLOTS_PER_DAY - 1 - slotIdx, dayDelta: 0 };
  if (k === 'Enter' || k === ' ' || k === 'Spacebar') return { type: 'create' };

  return null;
}

/**
 * Translate a keydown for an event-focused chip into an action. Returns:
 *   {type: 'move', minuteDelta, dayDelta}  — translate the event
 *   {type: 'resize', minuteDelta}          — change end time only
 *   {type: 'edit'}                          — open the editor
 *   {type: 'delete'}                        — delete (caller should confirm)
 *   {type: 'context', target}              — open the right-click menu
 *   {type: 'escape'}                        — return focus to the surrounding slot
 *   null                                    — not handled
 *
 * Default minute delta is the user's `dragSnapMinutes` pref (passed in).
 * Shift halves it for fine-grained control.
 */
export function eventKeyAction(e, { snapMinutes = 15 } = {}) {
  if (e.ctrlKey || e.metaKey) return null;
  const k = e.key;
  const fine = e.shiftKey ? Math.max(5, Math.floor(snapMinutes / 3)) : snapMinutes;

  // Alt+Arrow → resize (change end only)
  if (e.altKey) {
    if (k === 'ArrowDown') return { type: 'resize', minuteDelta: fine };
    if (k === 'ArrowUp')   return { type: 'resize', minuteDelta: -fine };
    return null;
  }

  if (k === 'ArrowDown')  return { type: 'move', minuteDelta: fine, dayDelta: 0 };
  if (k === 'ArrowUp')    return { type: 'move', minuteDelta: -fine, dayDelta: 0 };
  if (k === 'ArrowRight') return { type: 'move', minuteDelta: 0, dayDelta: 1 };
  if (k === 'ArrowLeft')  return { type: 'move', minuteDelta: 0, dayDelta: -1 };

  if (k === 'Enter' || k === 'e' || k === 'E') return { type: 'edit' };
  if (k === 'Delete' || k === 'Backspace') return { type: 'delete' };
  // Shift+F10 is the standard keyboard shortcut for "context menu" on Windows
  // and a long-pressed two-finger tap on Mac. The "ContextMenu" key is also
  // used by some keyboards.
  if ((e.shiftKey && k === 'F10') || k === 'ContextMenu') {
    return { type: 'context' };
  }
  if (k === 'Escape') return { type: 'escape' };

  return null;
}

/**
 * Clamp a {dayIdx, slotIdx} pair to valid bounds. Used after applying a
 * slotKeyAction so the component doesn't have to repeat the math.
 */
export function clampGridFocus({ dayIdx, slotIdx }, { dayCount }) {
  return {
    dayIdx: Math.max(0, Math.min(dayCount - 1, dayIdx)),
    slotIdx: Math.max(0, Math.min(SLOTS_PER_DAY - 1, slotIdx)),
  };
}
