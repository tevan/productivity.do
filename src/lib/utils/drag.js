import { addDays, startOfDay } from './dates.js';

const SLOT_HEIGHT = 48; // pixels per hour
const SNAP_MINUTES = 15;

export function createDragHandler(options = {}) {
  const {
    onDragStart,
    onDragMove,
    onDragEnd,
    slotHeight = SLOT_HEIGHT,
    snapMinutes = SNAP_MINUTES,
    minDurationMinutes = SNAP_MINUTES,
  } = options;

  let dragging = false;
  let startY = 0;
  let startX = 0;
  let startDate = null;
  let startHour = 0;
  let currentData = null;

  function snapToGrid(minutes, shiftKey) {
    if (shiftKey) return minutes;
    return Math.round(minutes / snapMinutes) * snapMinutes;
  }

  function yToMinutes(y, containerTop) {
    const relY = y - containerTop;
    return (relY / slotHeight) * 60;
  }

  function handleMouseDown(e, date, containerEl) {
    if (e.button !== 0) return;
    dragging = true;
    startY = e.clientY;
    startX = e.clientX;
    startDate = date;
    const rect = containerEl.getBoundingClientRect();
    startHour = yToMinutes(e.clientY, rect.top);

    // Initial click snaps to 30-min boundaries (:00 or :30) — clicking near
    // :15 or :45 feels arbitrary. Subsequent drag movements still snap at
    // 15-min granularity for fine duration control.
    const startSnap = e.shiftKey ? startHour : Math.round(startHour / 30) * 30;
    currentData = {
      startMinutes: startSnap,
      endMinutes: startSnap + minDurationMinutes,
      date: date,
      shiftKey: e.shiftKey,
    };

    if (onDragStart) onDragStart(currentData);

    function handleMouseMove(moveE) {
      if (!dragging) return;
      const rect = containerEl.getBoundingClientRect();
      const currentMinutes = yToMinutes(moveE.clientY, rect.top);
      const snappedEnd = snapToGrid(currentMinutes, moveE.shiftKey);

      currentData = {
        ...currentData,
        endMinutes: Math.max(snappedEnd, currentData.startMinutes + minDurationMinutes),
        shiftKey: moveE.shiftKey,
      };

      if (onDragMove) onDragMove(currentData);
    }

    function handleMouseUp(upE) {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      if (currentData && onDragEnd) {
        const d = new Date(currentData.date);
        const startH = Math.floor(currentData.startMinutes / 60);
        const startM = currentData.startMinutes % 60;
        const endH = Math.floor(currentData.endMinutes / 60);
        const endM = currentData.endMinutes % 60;

        const start = new Date(d);
        start.setHours(startH, startM, 0, 0);
        const end = new Date(d);
        end.setHours(endH, endM, 0, 0);

        // Only emit a real drag if the user moved a meaningful distance.
        // Short clicks still fire onDragEnd with `cancelled: true` so the
        // caller can clear any preview state it was tracking.
        const distancePx = Math.abs(upE.clientY - startY) + Math.abs(upE.clientX - startX);
        if (distancePx >= 4) {
          onDragEnd({ start, end });
        } else {
          onDragEnd({ start, end, cancelled: true });
        }
      }
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }

  return { handleMouseDown };
}

/**
 * Drag an existing event:
 *   - mode 'move'   : shift event up/down (time) and left/right (day) preserving duration
 *   - mode 'resize' : adjust event end time only
 *
 * Caller provides `getDayAtX(clientX)` to map cursor x to a Date (one of the
 * visible day columns). For resize, day mapping isn't used.
 *
 * onPreview({ start, end })  is called continuously during drag (for ghost UI)
 * onCommit({ start, end })   is called on mouseup if anything actually changed
 */
export function createEventDragHandler(options = {}) {
  const {
    slotHeight = SLOT_HEIGHT,
    snapMinutes = SNAP_MINUTES,
    onPreview,
    onCommit,
    onCancel,
  } = options;

  function startDrag(e, event, mode, helpers) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const initStart = new Date(event.start);
    const initEnd = new Date(event.end);
    const durationMs = initEnd - initStart;

    const startClientY = e.clientY;
    const startClientX = e.clientX;

    let lastPreview = { start: initStart, end: initEnd };
    let moved = false;

    function snap(min, shift) {
      return shift ? min : Math.round(min / snapMinutes) * snapMinutes;
    }

    function compute(moveE) {
      const dy = moveE.clientY - startClientY;
      const deltaMinutes = snap((dy / slotHeight) * 60, moveE.shiftKey);

      if (mode === 'resize') {
        const newEnd = new Date(initEnd.getTime() + deltaMinutes * 60000);
        // Don't allow end before start + snap
        const minEnd = new Date(initStart.getTime() + snapMinutes * 60000);
        return {
          start: initStart,
          end: newEnd < minEnd ? minEnd : newEnd,
        };
      }

      // mode === 'move'
      let newStart = new Date(initStart.getTime() + deltaMinutes * 60000);
      // Day shift via x-axis: map cursor to visible day column
      if (helpers && typeof helpers.getDayAtX === 'function') {
        const targetDay = helpers.getDayAtX(moveE.clientX);
        if (targetDay) {
          // Preserve hour/minute, replace date
          const td = startOfDay(targetDay);
          const merged = new Date(td);
          merged.setHours(newStart.getHours(), newStart.getMinutes(), 0, 0);
          newStart = merged;
        }
      }
      const newEnd = new Date(newStart.getTime() + durationMs);
      return { start: newStart, end: newEnd };
    }

    function handleMove(moveE) {
      const dx = moveE.clientX - startClientX;
      const dy = moveE.clientY - startClientY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      lastPreview = compute(moveE);
      if (onPreview) onPreview({ event, ...lastPreview, mode });
    }

    function handleUp(upE) {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('keydown', handleKey);
      if (!moved) {
        if (onCancel) onCancel();
        return;
      }
      lastPreview = compute(upE);
      if (onCommit) onCommit({ event, ...lastPreview, mode });
    }

    function handleKey(keyE) {
      if (keyE.key === 'Escape') {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        document.removeEventListener('keydown', handleKey);
        if (onCancel) onCancel();
      }
    }

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.addEventListener('keydown', handleKey);
  }

  return { startDrag };
}
