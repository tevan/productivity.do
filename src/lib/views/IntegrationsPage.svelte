<script>
  // Full-page Integrations directory at /integrations.
  //
  // Wraps the existing IntegrationsTab component (which is also still
  // mountable from Settings) in a full-screen page chrome. Routing is
  // handled by stores/routeStore.svelte.js — back button takes the user
  // to the SPA at `/`.

  import IntegrationsTab from '../components/IntegrationsTab.svelte';
  import { navigate, getRoute } from '../stores/routeStore.svelte.js';

  const route = getRoute();
  function back() { navigate('/'); }
</script>

<div class="page">
  <header class="page-head">
    <button class="back-btn" onclick={back} aria-label="Back to app">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
      <span>Back</span>
    </button>
    <div class="title-block">
      <h1>Integrations</h1>
      <p class="subtitle">Connect external tools to bring tasks, events, and notes into productivity.do.</p>
    </div>
  </header>

  <div class="page-body">
    <IntegrationsTab focusProvider={route.integrationsProvider} />
  </div>
</div>

<style>
  .page {
    min-height: 100vh;
    background: var(--bg-primary);
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
  }
  .page-head {
    padding: 20px 32px 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--surface);
  }
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
    padding: 4px 0;
    align-self: flex-start;
  }
  .back-btn:hover { color: var(--text-primary); }
  .title-block h1 {
    font-size: 28px;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary);
  }
  .subtitle {
    font-size: 14px;
    color: var(--text-secondary);
    margin: 4px 0 0;
    max-width: 640px;
    line-height: 1.5;
  }
  .page-body {
    flex: 1;
    padding: 24px 32px 64px;
    max-width: 1280px;
    width: 100%;
    margin: 0 auto;
  }
  @media (max-width: 640px) {
    .page-head { padding: 14px 18px 10px; }
    .title-block h1 { font-size: 22px; }
    .subtitle { font-size: 13px; }
    .page-body { padding: 16px 18px 48px; }
  }
</style>
