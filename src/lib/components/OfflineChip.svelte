<script>
  // Compact toolbar chip — visible only when offline OR when the replay
  // queue has pending writes (briefly visible after reconnect while
  // draining). The chip is interactive only as a tooltip target; clicks
  // do nothing today (could open Settings → Activity to show what's
  // queued, once we ship that).

  import { subscribe } from '../offline/replayQueue.js';
  import { tooltip } from '../actions/tooltip.js';

  let online = $state(typeof navigator !== 'undefined' ? navigator.onLine : true);
  let pending = $state(0);

  $effect(() => {
    if (typeof window === 'undefined') return;
    const onOn = () => { online = true; };
    const onOff = () => { online = false; };
    window.addEventListener('online', onOn);
    window.addEventListener('offline', onOff);
    return () => {
      window.removeEventListener('online', onOn);
      window.removeEventListener('offline', onOff);
    };
  });

  $effect(() => {
    return subscribe((n) => { pending = n; });
  });

  const visible = $derived(!online || pending > 0);
  const label = $derived(!online ? 'Offline' : (pending > 0 ? `Syncing ${pending}` : ''));
  const tooltipText = $derived(
    !online
      ? 'You are offline. Changes will sync when you reconnect.'
      : (pending > 0
          ? `${pending} change${pending === 1 ? '' : 's'} pending — syncing now.`
          : '')
  );
</script>

{#if visible}
  <span class="offline-chip" class:offline={!online} class:syncing={online && pending > 0} use:tooltip={tooltipText}>
    <span class="dot" aria-hidden="true"></span>
    {label}
  </span>
{/if}

<style>
  .offline-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 999px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: default;
    user-select: none;
  }
  .offline-chip.offline {
    background: color-mix(in srgb, var(--error, #dc2626) 12%, var(--bg-secondary));
    border-color: color-mix(in srgb, var(--error, #dc2626) 30%, var(--border));
    color: var(--error, #dc2626);
  }
  .offline-chip.syncing {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-secondary));
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
    color: var(--accent);
  }
  .offline-chip .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .offline-chip.syncing .dot {
    animation: chip-pulse 1.2s ease-in-out infinite;
  }
  @keyframes chip-pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
</style>
