<script>
  import { api } from '../api.js';

  let me = $state(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let period = $state('annual');

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api('/api/billing/me');
      if (res?.ok) me = res.user;
      else error = res?.error || 'Could not load billing.';
    } catch (e) {
      error = e.message || 'Could not load billing.';
    } finally {
      loading = false;
    }
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
        window.location.href = res.url;
      } else {
        error = res?.error || 'Checkout failed.';
      }
    } catch (e) {
      error = e.message || 'Checkout failed.';
    } finally {
      busy = false;
    }
  }

  function manage() {
    window.location.href = '/api/billing/portal';
  }

  $effect(() => { load(); });

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  const PLAN_LABELS = { free: 'Free', pro: 'Pro', team: 'Team' };

  // Per-plan perk lists used in both the current-plan summary and the
  // upgrade cards. Pro perks are echoed in the current-plan card so the
  // user can SEE what they're getting today.
  const PRO_PERKS = [
    'Unlimited booking pages',
    'Custom branding & logo',
    'Outbound webhooks',
    'API keys (read/write)',
    'Stripe-paid bookings',
  ];
  const TEAM_PERKS = [
    'Round-robin & collective scheduling',
    'Shared availability across teammates',
    'Higher API rate limits (10× Pro)',
    'Centralized billing & member roles',
    'Priority support',
  ];
</script>

{#if loading}
  <p class="hint">Loading…</p>
{:else if error}
  <div class="err">{error}</div>
{:else if me}
  <!-- CURRENT PLAN — celebratory, not "sad and empty". Shows what the user is
       getting today (perks list) plus renewal date and a manage button. -->
  <div class="current-plan plan-{me.plan}">
    <div class="plan-header">
      <div class="plan-badge">
        {#if me.plan === 'pro'}<span class="badge-icon">★</span>{:else if me.plan === 'team'}<span class="badge-icon">⌘</span>{:else}<span class="badge-icon">·</span>{/if}
        <span class="badge-label">{PLAN_LABELS[me.plan] || me.plan}</span>
      </div>
      <div class="plan-status">
        {#if me.hasSubscription}
          <span class="active-pill"><span class="status-dot"></span>Active</span>
          <span class="renews-on">renews {fmtDate(me.currentPeriodEnd)}</span>
        {:else if me.plan === 'free'}
          <span class="active-pill"><span class="status-dot"></span>Active</span>
          <span class="renews-on">Free forever — no card on file</span>
        {:else}
          <span class="active-pill"><span class="status-dot"></span>Active</span>
        {/if}
      </div>
    </div>

    {#if me.plan !== 'free'}
      <ul class="perk-grid">
        {#each (me.plan === 'team' ? [...PRO_PERKS, ...TEAM_PERKS] : PRO_PERKS) as perk}
          <li>{perk}</li>
        {/each}
      </ul>
    {/if}

    {#if me.hasSubscription}
      <div class="plan-actions">
        <button class="btn-secondary" onclick={manage} disabled={busy}>Manage subscription</button>
      </div>
    {/if}
  </div>

  {#if me.plan === 'free' || me.plan === 'pro'}
    <div class="upgrade-section">
      <div class="upgrade-h">
        <h3>{me.plan === 'pro' ? 'Scale up with Team' : 'Get more out of Productivity'}</h3>
        <div class="period-toggle" role="tablist">
          <button class:active={period === 'monthly'} onclick={() => period = 'monthly'} role="tab" aria-selected={period === 'monthly'}>Monthly</button>
          <button class:active={period === 'annual'} onclick={() => period = 'annual'} role="tab" aria-selected={period === 'annual'}>
            Annual
            <span class="save-pill">Save 17%</span>
          </button>
        </div>
      </div>

      <div class="plans-grid">
        {#if me.plan === 'free'}
          <div class="plan-card pro-card">
            <div class="plan-card-tag">Most popular</div>
            <div class="plan-card-name">Pro</div>
            <div class="plan-card-price">
              <span class="dollar">$</span>{period === 'annual' ? '10' : '12'}<span class="suffix">/month</span>
            </div>
            {#if period === 'annual'}<div class="billed-as">Billed $120/year</div>{/if}
            <p class="plan-card-tagline">Everything you need to take bookings and run scheduling like a pro.</p>
            <ul>
              {#each PRO_PERKS as perk}<li>{perk}</li>{/each}
            </ul>
            <button class="btn-primary" onclick={() => checkout('pro')} disabled={busy}>
              {busy ? '…' : 'Upgrade to Pro'}
            </button>
            <div class="card-footer">14-day money-back guarantee</div>
          </div>
        {/if}

        <div class="plan-card team-card">
          <div class="plan-card-tag tag-team">For teams of 2+</div>
          <div class="plan-card-name">Team</div>
          <div class="plan-card-price">
            <span class="dollar">$</span>{period === 'annual' ? '17' : '20'}<span class="suffix">/user/month</span>
          </div>
          {#if period === 'annual'}<div class="billed-as">Billed annually per user</div>{/if}
          <p class="plan-card-tagline">Stop juggling solo calendars. Share availability, route the right teammate, and bill it once.</p>
          <ul>
            {#if me.plan === 'free'}<li class="li-bold">Everything in Pro, plus:</li>{/if}
            {#each TEAM_PERKS as perk}<li>{perk}</li>{/each}
          </ul>
          <button class="btn-primary btn-team" onclick={() => checkout('team')} disabled={busy}>
            {busy ? '…' : me.plan === 'pro' ? 'Upgrade to Team' : 'Try Team free for 14 days'}
          </button>
          <div class="card-footer">Cancel anytime · Per-seat pricing</div>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  .hint { color: var(--text-tertiary); font-size: 13px; }
  .err { color: var(--error); font-size: 13px; padding: 8px 12px; background: color-mix(in srgb, var(--error) 12%, transparent); border-radius: var(--radius-sm); }

  /* Current plan — gradient accent, badge, perk list. Not a sad rectangle. */
  .current-plan {
    position: relative;
    padding: 18px 20px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg, 12px);
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, transparent), transparent 60%),
      var(--surface);
    margin-bottom: 24px;
    overflow: hidden;
  }
  .current-plan.plan-pro,
  .current-plan.plan-team {
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
    box-shadow: 0 1px 3px color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .plan-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .plan-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px 4px 8px;
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .badge-icon { font-size: 13px; line-height: 1; }
  .plan-free .plan-badge { background: var(--text-tertiary); }
  .plan-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-secondary);
    flex-wrap: wrap;
  }
  /* "Active" deserves to feel cheerful, not utilitarian — emerald pill
     with a soft glow on the dot. Subtle but readable in both light/dark. */
  .active-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 9px 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: #047857;
    background: color-mix(in srgb, #10b981 14%, transparent);
    border: 1px solid color-mix(in srgb, #10b981 28%, transparent);
  }
  :global(html.dark) .active-pill {
    color: #6ee7b7;
    background: color-mix(in srgb, #10b981 22%, transparent);
    border-color: color-mix(in srgb, #10b981 40%, transparent);
  }
  .status-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: #10b981;
    box-shadow: 0 0 0 2px color-mix(in srgb, #10b981 30%, transparent);
  }
  .renews-on { color: var(--text-tertiary); font-size: 12px; }
  .perk-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 4px 16px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .perk-grid li {
    padding-left: 18px;
    position: relative;
  }
  .perk-grid li::before {
    content: '';
    position: absolute;
    left: 0; top: 50%;
    width: 12px; height: 12px;
    background: var(--accent);
    -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2 6l3 3 5-6' stroke='black' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>") center/contain no-repeat;
            mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2 6l3 3 5-6' stroke='black' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>") center/contain no-repeat;
    transform: translateY(-50%);
  }
  .plan-actions {
    margin-top: 14px;
    display: flex;
    gap: 8px;
  }

  .upgrade-section { margin-top: 8px; }
  .upgrade-h {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    flex-wrap: wrap;
    gap: 12px;
  }
  h3 { font-size: 15px; font-weight: 600; margin: 0; }

  /* Period toggle: real segmented control with rounded pill highlight. */
  .period-toggle {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-secondary);
    padding: 3px;
    gap: 0;
  }
  .period-toggle button {
    padding: 6px 14px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: background 0.12s, color 0.12s;
  }
  .period-toggle button:hover:not(.active) { color: var(--text-primary); }
  .period-toggle button.active {
    background: var(--surface);
    color: var(--text-primary);
    box-shadow: var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.06));
  }
  .save-pill {
    font-size: 10px;
    font-weight: 600;
    background: color-mix(in srgb, var(--success, #16a34a) 18%, transparent);
    color: var(--success, #16a34a);
    padding: 2px 6px;
    border-radius: 999px;
  }

  .plans-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 14px;
  }
  .plan-card {
    position: relative;
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg, 12px);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pro-card {
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  }
  /* Team card: the upsell. Stronger visual treatment so it actually catches
     the eye. Subtle gradient backplate + colored border. */
  .team-card {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    background:
      linear-gradient(160deg, color-mix(in srgb, var(--accent) 8%, transparent), transparent 50%),
      var(--surface);
    box-shadow: 0 4px 16px color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .plan-card-tag {
    position: absolute;
    top: -10px; left: 16px;
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .tag-team {
    background: color-mix(in srgb, var(--accent) 80%, black);
  }
  .plan-card-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }
  .plan-card-price {
    display: flex;
    align-items: baseline;
    font-size: 36px;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.02em;
    line-height: 1;
    margin-top: 2px;
  }
  .plan-card-price .dollar {
    font-size: 18px;
    font-weight: 600;
    margin-right: 2px;
    align-self: flex-start;
    margin-top: 4px;
  }
  .plan-card-price .suffix {
    font-size: 13px;
    font-weight: 400;
    color: var(--text-tertiary);
    margin-left: 4px;
  }
  .billed-as {
    font-size: 11px;
    color: var(--text-tertiary);
    margin-top: -4px;
  }
  .plan-card-tagline {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 6px 0 4px;
    line-height: 1.4;
  }
  .plan-card ul {
    list-style: none;
    padding: 0;
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--text-secondary);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .plan-card li {
    padding-left: 20px;
    position: relative;
    line-height: 1.4;
  }
  .plan-card li.li-bold {
    padding-left: 0;
    color: var(--text-primary);
    font-weight: 500;
    margin-bottom: 2px;
  }
  .plan-card li:not(.li-bold)::before {
    content: '';
    position: absolute;
    left: 0; top: 4px;
    width: 14px; height: 14px;
    background: var(--accent);
    -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14'><circle cx='7' cy='7' r='6' fill='black' opacity='0.15'/><path d='M3.5 7.5l2 2 5-6' stroke='white' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>") center/contain no-repeat;
            mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14'><circle cx='7' cy='7' r='6' fill='black' opacity='0.15'/><path d='M3.5 7.5l2 2 5-6' stroke='white' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>") center/contain no-repeat;
  }

  .btn-primary {
    margin-top: 12px;
    padding: 10px 14px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    transition: filter 0.12s, transform 0.06s;
  }
  .btn-primary:hover:not(:disabled) { filter: brightness(0.95); }
  .btn-primary:active:not(:disabled) { transform: translateY(1px); }
  .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-team {
    background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, black));
    box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .card-footer {
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-tertiary);
    text-align: center;
  }
  .btn-secondary {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-primary);
    font-size: 12px;
    cursor: pointer;
  }
  .btn-secondary:hover:not(:disabled) { background: var(--surface-hover); }
</style>
