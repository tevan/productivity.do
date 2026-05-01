import { api } from '../api.js';

let blocks = $state([]);
let loaded = false;

export function getFocusBlocks() {
  return {
    get items() { return blocks; },
  };
}

export async function fetchFocusBlocks() {
  try {
    const res = await api('/api/focus-blocks');
    if (res?.ok) blocks = res.blocks;
  } catch {}
  loaded = true;
}

/**
 * Return the focus blocks that overlap a given Date (any time of day).
 * Filtered to that date's weekday.
 */
export function focusBlocksForDate(date) {
  const wk = date.getDay();
  return blocks.filter(b => b.weekday === wk);
}
