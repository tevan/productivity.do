<!--
  Recurring-event scope picker. Mirrors ConfirmRoot: mounted once in
  App.svelte, listens for pendingScope, renders the dialog when set.
  Returns one of 'instance' | 'series' | 'following' | null (cancel).
-->
<script>
  import { getPendingScope } from '../utils/chooseScopeModal.svelte.js';

  const store = getPendingScope();
  const c = $derived(store.value);

  // Local selection — defaults to the safest scope.
  let selected = $state('instance');

  // Reset whenever a new request arrives.
  $effect(() => {
    if (c) selected = 'instance';
  });

  function handleKeydown(e) {
    if (!c) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      c.resolve(null);
    }
    if (e.key === 'Enter') {
      // Ignore Enter when the user is interacting with a radio (it'd
      // double-fire). Only treat Enter as confirm when focus isn't on
      // the radios.
      const tag = document.activeElement?.tagName;
      if (tag !== 'INPUT') {
        e.preventDefault();
        c.resolve(selected);
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if c}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="backdrop" onclick={() => c.resolve(null)}></div>
  <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="scope-title">
    <h2 id="scope-title">{c.title}</h2>
    {#if c.body}<p class="body">{c.body}</p>{/if}

    <fieldset class="options">
      <label class="option" class:active={selected === 'instance'}>
        <input
          type="radio"
          name="scope"
          value="instance"
          checked={selected === 'instance'}
          onchange={() => (selected = 'instance')}
        />
        <span class="title">{c.verb} just this event</span>
        <span class="hint">Only this occurrence will be affected.</span>
      </label>

      <label class="option" class:active={selected === 'following'}>
        <input
          type="radio"
          name="scope"
          value="following"
          checked={selected === 'following'}
          onchange={() => (selected = 'following')}
        />
        <span class="title">{c.verb} this and following events</span>
        <span class="hint">This event and every future one in the series.</span>
      </label>

      <label class="option" class:active={selected === 'series'}>
        <input
          type="radio"
          name="scope"
          value="series"
          checked={selected === 'series'}
          onchange={() => (selected = 'series')}
        />
        <span class="title">{c.verb} all events in the series</span>
        <span class="hint">Past and future occurrences will be affected.</span>
      </label>
    </fieldset>

    <div class="actions">
      <button class="btn ghost" onclick={() => c.resolve(null)}>Cancel</button>
      <button
        class="btn"
        class:danger={c.danger}
        onclick={() => c.resolve(selected)}
        autofocus
      >{c.verb}</button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 2000;
  }
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 2001;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: 22px 24px;
    width: min(480px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h2 { font-size: 16px; font-weight: 600; margin: 0; color: var(--text-primary); }
  p.body {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.5;
  }
  fieldset.options {
    border: none;
    padding: 0;
    margin: 4px 0 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  label.option {
    display: grid;
    grid-template-columns: 18px 1fr;
    grid-template-rows: auto auto;
    gap: 2px 12px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 120ms, border-color 120ms;
  }
  label.option:hover {
    background: var(--surface-hover);
  }
  label.option.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  label.option input[type='radio'] {
    grid-column: 1;
    grid-row: 1 / span 2;
    align-self: center;
    cursor: pointer;
    margin: 0;
    accent-color: var(--accent);
  }
  label.option .title {
    grid-column: 2;
    grid-row: 1;
    font-size: 13.5px;
    font-weight: 500;
    color: var(--text-primary);
  }
  label.option .hint {
    grid-column: 2;
    grid-row: 2;
    font-size: 12px;
    color: var(--text-tertiary, var(--text-secondary));
    line-height: 1.4;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
  .btn {
    padding: 6px 14px;
    border: 1px solid var(--border);
    background: var(--accent);
    color: white;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .btn.danger {
    background: var(--danger, #ef4444);
    border-color: var(--danger, #ef4444);
  }
  .btn.ghost {
    background: var(--surface);
    color: var(--text-primary);
  }
  .btn.ghost:hover { background: var(--surface-hover); }
</style>
