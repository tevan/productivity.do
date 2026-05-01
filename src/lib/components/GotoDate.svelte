<script>
  let {
    currentDate = new Date(),
    onclose = () => {},
    ongo = () => {},
    // When set, the panel anchors directly under this trigger element's
    // position instead of as a centered modal. Lets the user click the
    // date label and see the date picker pop down right there — no need
    // to drag the cursor across the screen. Pass either a DOMRect-like
    // object {top, left, bottom, right} or an element ref. On mobile we
    // still fall back to the centered sheet because there's no horizontal
    // room to anchor.
    anchor = null,
  } = $props();

  let inputEl = $state(null);

  function fmt(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  let value = $state(fmt(currentDate));
  let nlInput = $state('');
  let nlError = $state('');

  function parseFreeform(input) {
    if (!input.trim()) return null;
    const lower = input.trim().toLowerCase();

    // Today / tomorrow / yesterday
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (lower === 'today') return today;
    if (lower === 'tomorrow') {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      return d;
    }
    if (lower === 'yesterday') {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return d;
    }

    // "next monday", "this friday", etc
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayMatch = lower.match(/^(next|this|last)\s+(\w+)$/);
    if (dayMatch) {
      const idx = days.indexOf(dayMatch[2]);
      if (idx >= 0) {
        const d = new Date(today);
        const cur = d.getDay();
        let diff = (idx - cur + 7) % 7;
        if (dayMatch[1] === 'next' && diff === 0) diff = 7;
        if (dayMatch[1] === 'last') diff = diff === 0 ? -7 : diff - 7;
        d.setDate(d.getDate() + diff);
        return d;
      }
    }

    // ISO yyyy-mm-dd
    const iso = lower.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) {
      return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
    }

    // mm/dd or mm/dd/yyyy
    const slash = lower.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (slash) {
      const m = parseInt(slash[1]);
      const d = parseInt(slash[2]);
      let y = slash[3] ? parseInt(slash[3]) : today.getFullYear();
      if (y < 100) y += 2000;
      return new Date(y, m - 1, d);
    }

    // Generic Date parsing fallback
    const t = Date.parse(input);
    if (!isNaN(t)) return new Date(t);

    return null;
  }

  function go() {
    nlError = '';
    let target = null;
    if (nlInput.trim()) {
      target = parseFreeform(nlInput);
      if (!target) {
        nlError = 'Could not understand that date.';
        return;
      }
    } else if (value) {
      const m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (m) target = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    }
    if (target && !isNaN(target.getTime())) {
      ongo(target);
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      go();
    }
    if (e.key === 'Escape') {
      onclose();
    }
  }

  $effect(() => {
    inputEl?.focus();
  });

  // Anchor the panel under the trigger when one is provided AND we have
  // enough horizontal room. On mobile (<=768px) we always use the centered
  // sheet — there's no good "under the trigger" position when the trigger
  // sits in a 375px-wide toolbar.
  const anchorStyle = $derived.by(() => {
    if (!anchor) return null;
    if (typeof window !== 'undefined' && window.innerWidth <= 768) return null;
    const rect = typeof anchor.getBoundingClientRect === 'function'
      ? anchor.getBoundingClientRect()
      : anchor;
    if (!rect) return null;
    const top = Math.round(rect.bottom + 6);
    const PANEL_W = 420;
    let left = Math.round(rect.left);
    // Clamp to viewport so the panel doesn't get cut off on narrow desktops.
    if (typeof window !== 'undefined') {
      left = Math.min(left, window.innerWidth - PANEL_W - 16);
      left = Math.max(8, left);
    }
    return `top: ${top}px; left: ${left}px; transform: none;`;
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="goto-backdrop" onclick={onclose} class:transparent={!!anchorStyle}></div>
<div class="goto-modal" class:anchored={!!anchorStyle} style={anchorStyle || ''} role="dialog" aria-label="Go to date">
  <div class="goto-header">
    <h2>Go to date</h2>
    <button class="close-btn" onclick={onclose} aria-label="Close">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M13.5 4.5L4.5 13.5M4.5 4.5L13.5 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>
  <div class="goto-body">
    <!-- Pick a date first — most common path. The freeform "Type a date"
         input is below for power-user shortcuts (today, next monday, …). -->
    <div class="field">
      <label class="field-label" for="goto-date">Pick a date</label>
      <input id="goto-date" type="date" bind:value={value} />
    </div>
    <div class="or">or</div>
    <div class="field">
      <label class="field-label" for="goto-nl">Type a date</label>
      <input
        id="goto-nl"
        type="text"
        bind:this={inputEl}
        bind:value={nlInput}
        placeholder="today, next monday, 2026-05-12, 5/12…"
      />
      {#if nlError}
        <span class="error">{nlError}</span>
      {/if}
    </div>
    <div class="quick">
      <button class="quick-btn" onclick={() => { nlInput = 'today'; go(); }}>Today</button>
      <button class="quick-btn" onclick={() => { nlInput = 'tomorrow'; go(); }}>Tomorrow</button>
      <button class="quick-btn" onclick={() => { nlInput = 'next monday'; go(); }}>Next Monday</button>
    </div>
  </div>
  <div class="goto-footer">
    <button class="footer-btn cancel-btn" onclick={onclose}>Cancel</button>
    <button class="footer-btn save-btn" onclick={go}>Go</button>
  </div>
</div>

<style>
  .goto-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 1000;
  }
  /* When anchored to a trigger the panel feels like a dropdown — fading
     out the dim backdrop avoids a heavy "modal" overlay over the rest of
     the calendar. The backdrop is still there so click-outside dismisses. */
  .goto-backdrop.transparent { background: transparent; }
  .goto-modal {
    position: fixed;
    top: 30%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1001;
    width: 420px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
  }
  .goto-modal.anchored {
    /* When anchored, the inline style sets top/left explicitly. The header
       drops the close-button since clicking outside dismisses naturally. */
    transform: none;
  }
  .goto-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border-light);
  }
  .goto-header h2 { font-size: 15px; font-weight: 600; }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    cursor: pointer;
  }
  .close-btn:hover { background: var(--surface-hover); color: var(--text-primary); }

  .goto-body {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }
  input[type="text"], input[type="date"] {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    font-size: 14px;
    color: var(--text-primary);
    outline: none;
    width: 100%;
  }
  input[type="text"]:focus, input[type="date"]:focus { border-color: var(--accent); }
  .or {
    text-align: center;
    color: var(--text-tertiary);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .quick {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .quick-btn {
    padding: 4px 10px;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .quick-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
  .error {
    font-size: 12px;
    color: var(--error);
  }

  .goto-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--border-light);
    background: var(--bg-secondary);
  }
  .footer-btn {
    padding: 6px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    background: var(--surface);
    color: var(--text-primary);
  }
  .footer-btn:hover { background: var(--surface-hover); }
  .save-btn {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  .save-btn:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: white; }
  .cancel-btn { color: var(--text-secondary); }
</style>
