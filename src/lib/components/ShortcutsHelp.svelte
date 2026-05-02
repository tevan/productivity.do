<script>
  let { onclose = () => {} } = $props();

  function handleKeydown(e) {
    if (e.key === 'Escape') onclose();
  }

  // Each row is [keys, desc, kind?]
  // - kind 'keys' (default): split on whitespace, render each token as <kbd>
  //   (with explicit separators "or", "/", "+", "-", "–" rendered plain).
  // - kind 'mouse': render the whole left column as a styled tag-like phrase
  //   (no per-word kbds), since "Drag event" isn't keyboard chording.
  const SECTIONS = [
    {
      title: 'Navigation',
      rows: [
        ['T', 'Jump to today'],
        ['J  /  →', 'Next range'],
        ['K  /  ←', 'Previous range'],
        ['G', 'Go to date…'],
      ],
    },
    {
      title: 'Views',
      rows: [
        ['D', 'Day'],
        ['X', 'Next-days'],
        ['W', 'Week'],
        ['M', 'Month'],
        ['1  –  4', 'Switch view (in tab order)'],
      ],
    },
    {
      title: 'Create & edit',
      rows: [
        ['N  or  C', 'New event'],
        ['Cmd/Ctrl  +  Shift  +  N', 'New note'],
        ['Cmd/Ctrl  +  F', 'Search events'],
        ['Drag an event', 'Move to a new time or day', 'mouse'],
        ['Drag bottom edge', 'Resize an event', 'mouse'],
        ['Shift while dragging', 'Disable 15-min snap', 'mouse'],
        ['Double-click a slot', 'Create event there', 'mouse'],
      ],
    },
    {
      title: 'Calendar grid (keyboard)',
      rows: [
        ['↑  ↓', 'Move focus by an hour'],
        ['←  →', 'Previous / next day'],
        ['Page Up  /  Page Down', 'Jump 4 hours'],
        ['Home  /  End', 'Top / bottom of day'],
        ['Enter  /  Space', 'Create event at focused time'],
      ],
    },
    {
      title: 'Focused event (keyboard)',
      rows: [
        ['↑  ↓', 'Nudge time by 15 min (Shift = 5 min)'],
        ['←  →', 'Move ± 1 day'],
        ['Alt  +  ↑↓', 'Resize end time'],
        ['Enter  /  E', 'Open editor'],
        ['Delete  /  Backspace', 'Delete event'],
        ['Shift  +  F10', 'Open right-click menu'],
        ['Esc', 'Return focus to surrounding hour'],
      ],
    },
    {
      title: 'Synthesis',
      rows: [
        ['Y', 'Today, honestly — what fits, what slips, what to drop'],
        ['F', 'Find a free time across calendars'],
      ],
    },
    {
      title: 'Other',
      rows: [
        ['Cmd/Ctrl  +  1-3', 'Switch calendar set'],
        ['?', 'Show this help'],
        ['Esc', 'Close popovers'],
      ],
    },
  ];
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="help-backdrop" onclick={onclose}></div>
<div class="help-modal" role="dialog">
  <div class="help-header">
    <h2>Keyboard Shortcuts</h2>
    <button class="close-btn" onclick={onclose} aria-label="Close">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M13.5 4.5L4.5 13.5M4.5 4.5L13.5 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>
  <div class="help-body">
    {#each SECTIONS as section}
      <div class="section">
        <h3>{section.title}</h3>
        <ul class="rows">
          {#each section.rows as row}
            {@const [keys, desc, kind = 'keys'] = row}
            <li>
              <span class="keys">
                {#if kind === 'mouse'}
                  <span class="action-tag">{keys}</span>
                {:else}
                  {#each keys.split(/\s+/).filter(Boolean) as part}
                    {#if part === 'or' || part === '/' || part === '+' || part === '–' || part === '-'}
                      <span class="sep">{part}</span>
                    {:else}
                      <kbd>{part}</kbd>
                    {/if}
                  {/each}
                {/if}
              </span>
              <span class="desc">{desc}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </div>
</div>

<style>
  .help-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
  }
  .help-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1001;
    width: 760px;
    max-width: calc(100vw - 32px);
    max-height: 85vh;
    overflow-y: auto;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }
  .help-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border-light);
  }
  .help-header h2 {
    font-size: 16px;
    font-weight: 600;
  }
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

  .help-body {
    padding: 18px 24px 24px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px 40px;
  }
  .section h3 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
    margin: 0 0 10px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rows li {
    display: grid;
    grid-template-columns: minmax(0, auto) 1fr;
    align-items: center;
    gap: 16px;
    font-size: 13px;
  }
  .keys {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    justify-self: start;
  }
  .desc {
    color: var(--text-primary);
    line-height: 1.4;
  }
  .sep {
    color: var(--text-tertiary);
    font-size: 12px;
    padding: 0 2px;
  }
  kbd {
    display: inline-block;
    min-width: 22px;
    padding: 2px 7px;
    text-align: center;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-primary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    line-height: 1.4;
  }
  .action-tag {
    display: inline-block;
    padding: 2px 8px;
    font-size: 12px;
    color: var(--text-secondary);
    background: var(--bg-secondary);
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    white-space: nowrap;
  }
  @media (max-width: 700px) {
    .help-body { grid-template-columns: 1fr; gap: 20px; }
  }
</style>
