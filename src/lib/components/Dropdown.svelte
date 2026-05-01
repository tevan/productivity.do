<script>
  import { tooltip } from '../actions/tooltip.js';
  /**
   * Styled dropdown — replaces native <select> so the panel matches the rest
   * of the app. Per CLAUDE.md UI rules, no browser-default form controls.
   *
   * Props:
   *   - value: bound current value
   *   - options: [{ value, label, color?, disabled? }]
   *   - placeholder: string shown when no option matches the current value
   *   - onchange: (newValue) => void  (optional; bind:value usually enough)
   *   - disabled: bool
   *
   * Keyboard:
   *   - Space/Enter: open
   *   - Esc: close
   *   - ArrowDown/Up: navigate
   *   - Enter on highlighted: select
   */
  let {
    value = $bindable(null),
    options = [],
    placeholder = 'Select…',
    onchange = null,
    disabled = false,
    ariaLabel = 'Dropdown',
    iconOnly = false,    // when true, trigger renders as a small icon button
    triggerIcon = null,  // SVG markup string for the icon-only trigger
  } = $props();

  let open = $state(false);
  let highlightIdx = $state(-1);
  let triggerEl;
  let panelEl;

  const current = $derived(options.find(o => o.value === value) || null);
  const displayLabel = $derived(current?.label ?? placeholder);

  function toggle() {
    if (disabled) return;
    open = !open;
    if (open) {
      highlightIdx = options.findIndex(o => o.value === value);
      // Focus panel after mount so keyboard nav works.
      queueMicrotask(() => panelEl?.focus());
    }
  }

  function close() {
    open = false;
    highlightIdx = -1;
  }

  function pick(opt) {
    if (opt.disabled) return;
    value = opt.value;
    onchange?.(opt.value);
    close();
    triggerEl?.focus();
  }

  function handleTriggerKey(e) {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      toggle();
    }
  }

  function handlePanelKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      triggerEl?.focus();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      for (let i = highlightIdx + 1; i < options.length; i++) {
        const o = options[i];
        if (!o.disabled && !o.divider && !o.heading) { highlightIdx = i; return; }
      }
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      for (let i = highlightIdx - 1; i >= 0; i--) {
        const o = options[i];
        if (!o.disabled && !o.divider && !o.heading) { highlightIdx = i; return; }
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIdx >= 0 && options[highlightIdx]) pick(options[highlightIdx]);
    }
  }

  function handleDocClick(e) {
    if (!open) return;
    if (triggerEl?.contains(e.target) || panelEl?.contains(e.target)) return;
    close();
  }

  $effect(() => {
    if (open) {
      document.addEventListener('mousedown', handleDocClick);
      return () => document.removeEventListener('mousedown', handleDocClick);
    }
  });
</script>

<div class="dropdown" class:open class:disabled class:icon-only={iconOnly}>
  <button
    type="button"
    class="trigger"
    class:trigger-icon={iconOnly}
    bind:this={triggerEl}
    onclick={toggle}
    onkeydown={handleTriggerKey}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={ariaLabel}
    use:tooltip={iconOnly ? `${ariaLabel}: ${displayLabel}` : null}
    {disabled}
  >
    {#if iconOnly && triggerIcon}
      {@html triggerIcon}
    {:else}
      {#if current?.color}
        <span class="swatch" style="background: {current.color}"></span>
      {/if}
      <span class="label" class:placeholder={!current}>{displayLabel}</span>
      <svg class="chev" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
        <path d="M1 1l4 4 4-4" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    {/if}
  </button>

  {#if open}
    <div
      class="panel"
      role="listbox"
      tabindex="-1"
      bind:this={panelEl}
      onkeydown={handlePanelKey}
    >
      {#each options as opt, i (i + ':' + (opt.value ?? ''))}
        {#if opt.divider}
          <div class="dd-divider" role="separator"></div>
        {:else if opt.heading}
          <div class="dd-heading">{opt.heading}</div>
        {:else if opt.toggle}
          <button
            type="button"
            class="opt opt-toggle"
            class:highlighted={i === highlightIdx}
            class:selected={opt.checked}
            role="menuitemcheckbox"
            aria-checked={opt.checked}
            onclick={(e) => { e.stopPropagation(); opt.onclick?.(); }}
            onmouseenter={() => highlightIdx = i}
          >
            <svg class="check check-toggle" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" style:visibility={opt.checked ? 'visible' : 'hidden'}>
              <path d="M2 6l3 3 5-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="opt-label">{opt.label}</span>
          </button>
        {:else}
          <button
            type="button"
            class="opt"
            class:highlighted={i === highlightIdx}
            class:selected={opt.value === value}
            class:opt-disabled={opt.disabled}
            disabled={opt.disabled}
            role="option"
            aria-selected={opt.value === value}
            onclick={() => pick(opt)}
            onmouseenter={() => { if (!opt.disabled) highlightIdx = i; }}
          >
            {#if opt.color}
              <span class="swatch" style="background: {opt.color}"></span>
            {/if}
            <span class="opt-label">{opt.label}</span>
            {#if opt.kbd}
              <span class="opt-kbd">{opt.kbd}</span>
            {/if}
            {#if opt.value === value && !opt.kbd}
              <svg class="check" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2 6l3 3 5-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            {/if}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .dropdown { position: relative; width: 100%; }
  .trigger {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 6px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .trigger:hover { border-color: var(--accent); }
  .trigger:focus { outline: none; border-color: var(--accent); }
  .dropdown.open .trigger { border-color: var(--accent); }
  .dropdown.disabled .trigger { opacity: 0.5; cursor: not-allowed; }
  /* Icon-only trigger: matches .icon-btn dimensions in Toolbar */
  .dropdown.icon-only { width: auto; }
  .trigger.trigger-icon {
    width: 32px; height: 32px;
    padding: 0;
    display: inline-flex;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
  }
  .trigger.trigger-icon:hover { background: var(--surface-hover); color: var(--text-primary); border: none; }
  .dropdown.icon-only.open .trigger.trigger-icon { background: var(--surface-hover); color: var(--text-primary); border: none; }
  .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .label.placeholder { color: var(--text-tertiary); }
  .chev { color: var(--text-tertiary); flex-shrink: 0; transition: transform 0.15s; }
  .dropdown.open .chev { transform: rotate(180deg); }
  .swatch {
    width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0;
  }

  .panel {
    position: absolute; top: calc(100% + 4px); right: 0;
    min-width: 100%;
    z-index: 1100;
    background: var(--surface-elevated, var(--bg-secondary));
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
    box-shadow: var(--shadow-lg);
    padding: 4px;
    max-height: 280px; overflow-y: auto;
    outline: none;
    white-space: nowrap;
  }
  .opt {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 6px 10px;
    background: transparent;
    border: none; border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .opt-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .opt.highlighted { background: var(--surface-hover); }
  .opt.selected { color: var(--accent); font-weight: 500; }
  .opt.opt-disabled { opacity: 0.5; cursor: not-allowed; }
  .check { color: var(--accent); flex-shrink: 0; }
  .opt-kbd {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    flex-shrink: 0;
  }
  .dd-heading {
    padding: 6px 10px 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
    pointer-events: none;
  }
  .dd-divider {
    height: 1px;
    background: color-mix(in srgb, var(--border-light) 60%, transparent);
    margin: 6px 8px;
    pointer-events: none;
  }
  .opt-toggle {
    color: var(--text-secondary);
  }
  .opt-toggle.selected { color: var(--text-primary); }
  .check-toggle { color: var(--accent); flex-shrink: 0; }
</style>
