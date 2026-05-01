<script>
  import { getCalendars, switchSet, createSet, deleteSet } from '../stores/calendars.svelte.js';
  import { tooltip } from '../actions/tooltip.js';

  const cals = getCalendars();

  let showCreate = $state(false);
  let newName = $state('');

  async function handleCreate() {
    if (!newName.trim()) return;
    const ids = cals.items.filter(c => c.visible).map(c => c.id);
    await createSet(newName.trim(), ids);
    newName = '';
    showCreate = false;
  }

  async function handleDelete(id) {
    await deleteSet(id);
  }
</script>

<div class="cal-sets-section">
  <div class="sets-header">
    <button class="add-btn" onclick={() => showCreate = !showCreate} use:tooltip={'New set'}>+ New set</button>
  </div>

  {#if showCreate}
    <div class="create-form">
      <input
        type="text"
        bind:value={newName}
        placeholder="Set name"
        onkeydown={(e) => e.key === 'Enter' && handleCreate()}
      />
      <button class="create-btn" onclick={handleCreate}>Save</button>
    </div>
  {/if}

  <div class="sets-list">
    {#each cals.sets as s (s.id)}
      <div class="set-item" class:active={cals.activeSetId === s.id}>
        <button class="set-btn" onclick={() => switchSet(s.id)}>
          {s.name}
        </button>
        <button class="set-delete" onclick={() => handleDelete(s.id)} use:tooltip={'Delete set'}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    {/each}
    {#if cals.sets.length === 0 && !showCreate}
      <p class="empty-text">No sets yet</p>
    {/if}
  </div>
</div>

<style>
  .cal-sets-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sets-header {
    display: flex;
    align-items: center;
    padding: 0 4px;
  }

  .add-btn {
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 2px 6px;
  }
  .add-btn:hover { background: var(--surface-hover); color: var(--text-primary); }

  .create-form {
    display: flex;
    gap: 4px;
    padding: 0 4px;
  }
  .create-form input {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 12px;
    background: var(--surface);
    outline: none;
    color: var(--text-primary);
  }
  .create-form input:focus { border-color: var(--accent); }
  .create-btn {
    padding: 4px 8px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
  }

  .sets-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .set-item {
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
  }
  .set-item:hover .set-delete { opacity: 1; }

  .set-btn {
    flex: 1;
    padding: 4px 8px;
    border: none;
    background: none;
    text-align: left;
    font-size: 13px;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .set-btn:hover { background: var(--surface-hover); }
  .set-item.active .set-btn { color: var(--accent); font-weight: 500; }

  .set-delete {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    opacity: 0;
    border-radius: var(--radius-sm);
  }
  .set-delete:hover { background: var(--surface-hover); color: var(--error); }

  .empty-text {
    font-size: 12px;
    color: var(--text-tertiary);
    padding: 4px;
  }
</style>
