<script>
  import { getPendingUpgrade } from '../utils/upgradeModal.svelte.js';
  import { api } from '../api.js';

  const store = getPendingUpgrade();
  const u = $derived(store.value);

  let busy = $state(false);
  let period = $state('monthly');
  let error = $state('');

  function handleKeydown(e) {
    if (!u) return;
    if (e.key === 'Escape') u.resolve(false);
  }

  async function checkout(plan) {
    busy = true;
    error = '';
    try {
      const res = await api('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan, period }),
      });
      if (res?.ok && res.url) {
        u.resolve(true);
        window.location.href = res.url;
        return;
      }
      error = res?.error || 'Could not start checkout.';
    } catch (e) {
      error = e.message || 'Could not start checkout.';
    } finally {
      busy = false;
    }
  }

  const PLAN_LABELS = { pro: 'Pro', team: 'Team' };
</script>

<svelte:window onkeydown={handleKeydown} />

{#if u}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="backdrop" onclick={() => u.resolve(false)}></div>
  <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="upgrade-title">
    <h2 id="upgrade-title">{PLAN_LABELS[u.requiredPlan] || 'Pro'} plan required</h2>
    <p>
      {#if u.feature}
        <strong>{u.feature}</strong> is part of the {PLAN_LABELS[u.requiredPlan] || 'Pro'} plan.
      {:else}
        This feature is part of the {PLAN_LABELS[u.requiredPlan] || 'Pro'} plan.
      {/if}
      {#if u.detail} {u.detail}{/if}
    </p>

    <div class="period-toggle">
      <button class:active={period === 'monthly'} onclick={() => period = 'monthly'} type="button">Monthly</button>
      <button class:active={period === 'annual'} onclick={() => period = 'annual'} type="button">Annual <span class="save">save 17%</span></button>
    </div>

    {#if error}
      <div class="err">{error}</div>
    {/if}

    <div class="actions">
      <button class="btn ghost" onclick={() => u.resolve(false)} disabled={busy}>Maybe later</button>
      <button class="btn" onclick={() => checkout(u.requiredPlan)} disabled={busy}>
        {busy ? 'Loading…' : `Upgrade to ${PLAN_LABELS[u.requiredPlan] || 'Pro'}`}
      </button>
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
    padding: 20px 22px;
    width: min(460px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h2 { font-size: 15px; font-weight: 600; margin: 0; }
  p { font-size: 13px; color: var(--text-secondary); margin: 0; line-height: 1.5; }
  .period-toggle {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    align-self: flex-start;
  }
  .period-toggle button {
    padding: 5px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .period-toggle button.active { background: var(--accent); color: white; }
  .save { font-size: 10px; opacity: 0.85; margin-left: 4px; }
  .err {
    color: var(--error);
    font-size: 12px;
    background: color-mix(in srgb, var(--error) 12%, transparent);
    padding: 6px 10px;
    border-radius: var(--radius-sm);
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
  .btn.ghost {
    background: var(--surface);
    color: var(--text-primary);
  }
  .btn.ghost:hover { background: var(--surface-hover); }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
