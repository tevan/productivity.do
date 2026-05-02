<script>
  // /admin/metrics — owner / team-admin-only product-health dashboard.
  // Six numbers we'd actually act on (Cagan, Inspired):
  //   signups, activation, WAU, plan distribution, retention, booking conv.
  // Computed server-side from existing tables — no analytics-events
  // collection. If a metric needs new instrumentation, add it sparingly.

  import { api } from '../api.js';

  let metrics = $state(null);
  let loading = $state(true);
  let err = $state('');

  async function load() {
    loading = true; err = '';
    const r = await api('/api/admin/metrics');
    if (r?.ok) metrics = r.metrics;
    else err = r?.error || 'Could not load metrics';
    loading = false;
  }
  $effect(() => { load(); });

  function pct(v) {
    if (v == null) return '—';
    return `${v.toFixed(1)}%`;
  }
  function delta(v) {
    if (v == null) return '';
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(1)}%`;
  }

  // Tiny inline sparkline. SVG, no deps. Builds a polyline from a numeric
  // series. Falls back to "—" for empty.
  function sparklinePath(series, w = 120, h = 28) {
    if (!series || series.length < 2) return null;
    const max = Math.max(...series, 1);
    const stepX = w / (series.length - 1);
    const pts = series.map((v, i) => {
      const x = i * stepX;
      const y = h - (v / max) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return pts.join(' ');
  }
</script>

<div class="admin-page">
  <header class="admin-head">
    <a href="/" class="back-link">← App</a>
    <h1>Product metrics</h1>
    {#if metrics?.generatedAt}
      <span class="generated">As of {new Date(metrics.generatedAt).toLocaleString()}</span>
    {/if}
    <button class="reload-btn" onclick={load} disabled={loading}>↻ Reload</button>
  </header>

  {#if loading}
    <div class="empty">Loading…</div>
  {:else if err}
    <div class="empty err">{err}</div>
  {:else if metrics}
    <div class="grid">
      <!-- Signups -->
      <div class="card">
        <h3>Signups <span class="window">last 30d</span></h3>
        <div class="big">{metrics.signups.last30}</div>
        {#if metrics.signups.delta != null}
          <div class="delta" class:up={metrics.signups.delta > 0} class:down={metrics.signups.delta < 0}>
            {delta(metrics.signups.delta)} vs prior 30d ({metrics.signups.prior30})
          </div>
        {:else}
          <div class="delta muted">No prior-period data</div>
        {/if}
        {#if metrics.signups.byDay && metrics.signups.byDay.length > 1}
          <svg class="spark" width="120" height="28" viewBox="0 0 120 28" xmlns="http://www.w3.org/2000/svg">
            <polyline
              fill="none" stroke="var(--accent)" stroke-width="1.5"
              points={sparklinePath(metrics.signups.byDay.map(d => d.n))}
            />
          </svg>
        {/if}
      </div>

      <!-- Activation -->
      <div class="card">
        <h3>Activation <span class="window">7d window</span></h3>
        <div class="big">{pct(metrics.activation.ratePct)}</div>
        <div class="delta muted">
          {metrics.activation.activated} of {metrics.activation.cohortSize} signups
        </div>
        <div class="defn">{metrics.activation.definition}</div>
      </div>

      <!-- WAU -->
      <div class="card">
        <h3>Weekly active <span class="window">last 4w</span></h3>
        <div class="big">{metrics.wau.current}</div>
        <div class="delta" class:up={metrics.wau.current > metrics.wau.previous} class:down={metrics.wau.current < metrics.wau.previous}>
          {metrics.wau.current - metrics.wau.previous >= 0 ? '+' : ''}{metrics.wau.current - metrics.wau.previous} vs prior week ({metrics.wau.previous})
        </div>
        {#if metrics.wau.buckets && metrics.wau.buckets.length > 1}
          <svg class="spark" width="120" height="28" viewBox="0 0 120 28" xmlns="http://www.w3.org/2000/svg">
            <polyline
              fill="none" stroke="var(--accent)" stroke-width="1.5"
              points={sparklinePath(metrics.wau.buckets.map(b => b.n))}
            />
          </svg>
        {/if}
      </div>

      <!-- Plan distribution -->
      <div class="card">
        <h3>Plan mix</h3>
        <div class="plans">
          <div class="plan-row"><span>Free</span><span>{metrics.plans.free || 0}</span></div>
          <div class="plan-row"><span>Pro</span><span>{metrics.plans.pro || 0}</span></div>
          <div class="plan-row"><span>Team</span><span>{metrics.plans.team || 0}</span></div>
        </div>
      </div>

      <!-- Retention -->
      <div class="card">
        <h3>Retention <span class="window">cohort 30-60d ago</span></h3>
        {#if metrics.retention}
          <div class="ret-row"><span class="ret-label">D1</span><span class="ret-bar"><span class="ret-fill" style:width="{metrics.retention.d1}%"></span></span><span class="ret-val">{pct(metrics.retention.d1)}</span></div>
          <div class="ret-row"><span class="ret-label">D7</span><span class="ret-bar"><span class="ret-fill" style:width="{metrics.retention.d7}%"></span></span><span class="ret-val">{pct(metrics.retention.d7)}</span></div>
          <div class="ret-row"><span class="ret-label">D30</span><span class="ret-bar"><span class="ret-fill" style:width="{metrics.retention.d30}%"></span></span><span class="ret-val">{pct(metrics.retention.d30)}</span></div>
          <div class="defn">Cohort: {metrics.retention.cohortSize} users</div>
        {:else}
          <div class="empty muted">No cohort data yet</div>
        {/if}
      </div>

      <!-- Booking conversion -->
      <div class="card">
        <h3>Booking conv <span class="window">{metrics.bookings.window}</span></h3>
        <div class="big">{pct(metrics.bookings.conversionPct)}</div>
        <div class="delta muted">
          {metrics.bookings.confirmed} confirmed / {metrics.bookings.views} views
        </div>
      </div>
    </div>

    <div class="footnote">
      Computed in real-time from the live database. No analytics-events
      pipeline; numbers are derived from <code>users</code>,
      <code>user_sessions</code>, <code>booking_page_views</code>, and
      <code>bookings</code>. New metrics live in
      <code>backend/routes/admin-metrics.js</code>.
    </div>
  {/if}
</div>

<style>
  .admin-page {
    padding: 32px 40px;
    max-width: 1100px;
    margin: 0 auto;
    color: var(--text-primary);
  }
  .admin-head {
    display: flex; align-items: baseline; gap: 16px;
    margin-bottom: 28px;
  }
  .admin-head h1 {
    font-size: 22px; font-weight: 700; margin: 0;
  }
  .back-link { color: var(--text-tertiary); font-size: 13px; text-decoration: none; }
  .back-link:hover { color: var(--text-primary); }
  .generated { color: var(--text-tertiary); font-size: 12px; margin-left: auto; }
  .reload-btn {
    background: none; border: 1px solid var(--border);
    padding: 4px 10px; border-radius: 6px;
    color: var(--text-secondary); font-size: 12px; cursor: pointer;
  }
  .reload-btn:hover { color: var(--text-primary); }
  .reload-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
  @media (max-width: 880px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 18px;
    min-height: 132px;
  }
  .card h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
    font-weight: 600;
    margin: 0 0 8px;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .card h3 .window {
    font-size: 11px;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-tertiary);
    font-weight: 400;
  }
  .big {
    font-size: 32px;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.1;
  }
  .delta {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .delta.up { color: var(--success, #15803d); }
  .delta.down { color: var(--error, #c62828); }
  .delta.muted { color: var(--text-tertiary); }
  .defn {
    margin-top: 8px;
    font-size: 11px;
    color: var(--text-tertiary);
    font-style: italic;
    line-height: 1.4;
  }
  .spark { display: block; margin-top: 10px; }

  .plans { font-size: 13px; }
  .plan-row {
    display: flex; justify-content: space-between;
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
  }
  .plan-row:last-child { border-bottom: none; }

  .ret-row {
    display: grid;
    grid-template-columns: 32px 1fr 48px;
    gap: 6px;
    align-items: center;
    margin-bottom: 4px;
    font-size: 12px;
  }
  .ret-label { color: var(--text-tertiary); font-weight: 600; }
  .ret-bar {
    height: 6px;
    background: var(--bg-secondary);
    border-radius: 3px;
    overflow: hidden;
  }
  .ret-fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .ret-val { text-align: right; color: var(--text-primary); font-variant-numeric: tabular-nums; }

  .empty { padding: 40px 0; text-align: center; color: var(--text-tertiary); }
  .empty.err { color: var(--error, #c62828); }
  .empty.muted { color: var(--text-tertiary); padding: 0; }

  .footnote {
    margin-top: 28px;
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.6;
    border-top: 1px solid var(--border);
    padding-top: 16px;
  }
  .footnote code {
    background: var(--bg-secondary);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 11px;
  }
</style>
