// Marquee selection action — drag a rectangle from outside any item to
// select multiple items. Used by Tasks list/board for bulk-action workflows.
//
// Usage:
//   <div use:marquee={{ itemSelector: '.task-row, .board-card', getId: el => el.dataset.taskId, onSelect: (ids, append) => ... }}>
//
// Behavior:
//   - Mousedown on the container (NOT on an item or other interactive el)
//     starts marquee. We bail if the target is or sits inside an element
//     matching itemSelector or any [data-marquee-skip] zone.
//   - As the user drags, an absolutely-positioned overlay <div> traces the
//     selection rect.
//   - On mouseup, every item whose bounding rect intersects the marquee
//     rect is collected; onSelect(ids, append) fires.
//   - Shift / Cmd / Ctrl on mousedown sets append=true (caller decides
//     whether to merge with existing selection or replace).
//   - Drag must move >3px to count — guards against accidental marquee
//     when the user just clicks empty space.

const SKIP_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL']);

export function marquee(node, opts) {
  let {
    itemSelector = '[data-marquee-item]',
    getId = (el) => el.dataset.id || el.id,
    onSelect = () => {},
  } = opts || {};

  let startX = 0, startY = 0;
  let active = false;
  let appendMode = false;
  let overlay = null;

  function onMousedown(e) {
    // Left button only. Right/middle would be unexpected and conflicts with
    // browser context menus.
    if (e.button !== 0) return;
    // Bail if the target is or sits inside an item or a skip-zone.
    if (e.target.closest(itemSelector)) return;
    if (e.target.closest('[data-marquee-skip]')) return;
    // Also bail on inherently-interactive native elements.
    let el = e.target;
    while (el && el !== node) {
      if (SKIP_TAGS.has(el.tagName)) return;
      if (el.getAttribute && el.getAttribute('role') === 'button') return;
      el = el.parentElement;
    }
    appendMode = e.shiftKey || e.metaKey || e.ctrlKey;
    startX = e.clientX;
    startY = e.clientY;
    active = false; // turns true once we've moved >3px
    window.addEventListener('mousemove', onMousemove);
    window.addEventListener('mouseup', onMouseup, { once: true });
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; pointer-events: none; z-index: 9999;
      background: rgba(60, 130, 255, 0.12);
      border: 1px solid rgba(60, 130, 255, 0.6);
      border-radius: 2px;
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function onMousemove(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!active && Math.abs(dx) + Math.abs(dy) < 3) return;
    active = true;
    const el = ensureOverlay();
    const left = Math.min(e.clientX, startX);
    const top = Math.min(e.clientY, startY);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.width = Math.abs(dx) + 'px';
    el.style.height = Math.abs(dy) + 'px';
    // Prevent text selection while dragging.
    e.preventDefault();
  }

  function onMouseup(e) {
    window.removeEventListener('mousemove', onMousemove);
    if (!active) {
      cleanup();
      return;
    }
    const rect = {
      left: Math.min(e.clientX, startX),
      top: Math.min(e.clientY, startY),
      right: Math.max(e.clientX, startX),
      bottom: Math.max(e.clientY, startY),
    };
    const ids = [];
    for (const item of node.querySelectorAll(itemSelector)) {
      const r = item.getBoundingClientRect();
      const intersects =
        r.right >= rect.left && r.left <= rect.right &&
        r.bottom >= rect.top && r.top <= rect.bottom;
      if (intersects) {
        const id = getId(item);
        if (id != null) ids.push(id);
      }
    }
    onSelect(ids, appendMode);
    cleanup();
  }

  function cleanup() {
    if (overlay) { overlay.remove(); overlay = null; }
    active = false;
  }

  node.addEventListener('mousedown', onMousedown);

  return {
    update(next) {
      if (next.itemSelector) itemSelector = next.itemSelector;
      if (next.getId) getId = next.getId;
      if (next.onSelect) onSelect = next.onSelect;
    },
    destroy() {
      node.removeEventListener('mousedown', onMousedown);
      window.removeEventListener('mousemove', onMousemove);
      cleanup();
    },
  };
}
