// JS-rendered tooltip. Single shared element mounted lazily on
// document.body — every consumer reuses it, so we never have N tooltips
// fighting over z-index. Shows on mouseenter/focus, hides on mouseleave/blur,
// flips above/below the trigger based on viewport room.
//
// Usage:
//   <button use:tooltip={'Show sidebar'}>…</button>          // instant
//   <button use:tooltip={{ text: 'Hint', delay: 600 }}>…</button>  // delayed
//   <button use:tooltip={{ title: 'Bold', sub: 'dimmed' }}>  // two-line
// Pass null/undefined/empty to disable the tooltip on a specific element.

let tipEl = null;

function ensureEl() {
  if (tipEl) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'app-tooltip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.style.cssText = [
    'position: fixed',
    'z-index: 9999',
    // Softer than --text-primary (which is near-black) — pure black reads as
    // alarm-state on a clean UI. A medium-dark gray feels like a UI label.
    'background: #2a2e3a',
    'color: #f3f4f6',
    'font-size: 12px',
    'font-weight: 500',
    'line-height: 1.35',
    'padding: 5px 9px',
    'border-radius: 6px',
    'max-width: 280px',
    'text-align: left',
    'pointer-events: none',
    'opacity: 0',
    'transform: translateY(2px)',
    'transition: opacity 0.1s, transform 0.1s',
    'box-shadow: 0 2px 8px rgba(0,0,0,0.18)',
    'white-space: pre-line',
  ].join(';');
  document.body.appendChild(tipEl);
  return tipEl;
}

function clearEl(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function show(target, text) {
  if (!text) return;
  const el = ensureEl();
  // Support objects {title, sub} OR plain strings (with optional \n
  // separator — first line bold, rest dimmed). textContent everywhere; no
  // innerHTML so consumer-supplied strings can't inject markup.
  if (typeof text === 'object' && text !== null) {
    clearEl(el);
    const t = document.createElement('div');
    t.textContent = text.title || '';
    t.style.fontWeight = '600';
    el.appendChild(t);
    if (text.sub) {
      const s = document.createElement('div');
      s.textContent = text.sub;
      s.style.opacity = '0.7';
      s.style.fontSize = '11px';
      s.style.marginTop = '2px';
      el.appendChild(s);
    }
  } else if (typeof text === 'string' && text.includes('\n')) {
    clearEl(el);
    const lines = text.split('\n');
    const t = document.createElement('div');
    t.textContent = lines[0];
    t.style.fontWeight = '600';
    el.appendChild(t);
    for (let i = 1; i < lines.length; i++) {
      const s = document.createElement('div');
      s.textContent = lines[i];
      s.style.opacity = '0.7';
      s.style.fontSize = '11px';
      s.style.marginTop = '2px';
      el.appendChild(s);
    }
  } else {
    el.textContent = text;
  }
  // Render hidden first to measure
  el.style.opacity = '0';
  el.style.left = '0px';
  el.style.top = '0px';
  // Force layout
  const rect = target.getBoundingClientRect();
  const tipRect = el.getBoundingClientRect();
  const margin = 6;
  // Prefer above; fall back to below if no room.
  let top = rect.top - tipRect.height - margin;
  if (top < 4) top = rect.bottom + margin;
  let left = rect.left + (rect.width - tipRect.width) / 2;
  // Clamp horizontally to viewport
  const maxLeft = window.innerWidth - tipRect.width - 4;
  if (left < 4) left = 4;
  if (left > maxLeft) left = maxLeft;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.style.opacity = '1';
  el.style.transform = 'translateY(0)';
}

function hide() {
  if (!tipEl) return;
  tipEl.style.opacity = '0';
  tipEl.style.transform = 'translateY(2px)';
}

// Default hover delay. Quicker than browser native ~600ms so it still feels
// responsive, but not instant — instant tooltips on every hover create
// flickering visual noise when the user is just scanning.
const DEFAULT_DELAY_MS = 200;

// Resolve `text` into `{content, delay}` — content is what `show()` accepts
// (string OR {title,sub}); delay is ms to wait on hover before showing.
function unpack(text) {
  if (text && typeof text === 'object' && 'text' in text) {
    return { content: text.text, delay: text.delay ?? DEFAULT_DELAY_MS };
  }
  return { content: text, delay: DEFAULT_DELAY_MS };
}

export function tooltip(node, text) {
  let current = text;
  let showTimer = null;

  function clearTimer() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  }
  function scheduleShow(immediate = false) {
    clearTimer();
    const { content, delay } = unpack(current);
    if (!content) return;
    if (immediate || !delay) { show(node, content); return; }
    showTimer = setTimeout(() => { showTimer = null; show(node, content); }, delay);
  }

  function onEnter() { scheduleShow(false); }
  function onLeave() { clearTimer(); hide(); }
  function onFocus() { scheduleShow(true); } // keyboard focus: instant for a11y
  function onBlur() { clearTimer(); hide(); }
  function onMouseDown() { clearTimer(); hide(); }

  // Strip native title to avoid double-tooltip; preserve as data attr for
  // accessibility tools that scrape it.
  if (node.getAttribute('title')) {
    node.setAttribute('data-orig-title', node.getAttribute('title'));
    node.removeAttribute('title');
  }

  node.addEventListener('mouseenter', onEnter);
  node.addEventListener('mouseleave', onLeave);
  node.addEventListener('focus', onFocus);
  node.addEventListener('blur', onBlur);
  node.addEventListener('mousedown', onMouseDown);

  return {
    update(newText) {
      current = newText;
      // If currently visible (this node hovered/focused), refresh in place.
      if (tipEl && tipEl.style.opacity === '1' && document.activeElement === node) {
        const { content } = unpack(current);
        if (content) show(node, content);
      }
    },
    destroy() {
      clearTimer();
      node.removeEventListener('mouseenter', onEnter);
      node.removeEventListener('mouseleave', onLeave);
      node.removeEventListener('focus', onFocus);
      node.removeEventListener('blur', onBlur);
      node.removeEventListener('mousedown', onMouseDown);
      hide();
    },
  };
}
