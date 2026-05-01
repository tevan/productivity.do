<script>
  import { getPrefs, updatePref } from '../stores/prefs.svelte.js';
  import { getCalendars } from '../stores/calendars.svelte.js';
  import { PASTEL_COLORS } from '../utils/colors.js';
  import { initAudio } from '../utils/reminders.js';
  import BookingsTab from './BookingsTab.svelte';
  import BillingTab from './BillingTab.svelte';
  import IcsFeedRow from './IcsFeedRow.svelte';
  import TodoistIntegration from './TodoistIntegration.svelte';
  import FocusBlocksEditor from './FocusBlocksEditor.svelte';
  import EmailToTask from './EmailToTask.svelte';
  import BoardColumnsEditor from './BoardColumnsEditor.svelte';
  import IntegrationsTab from './IntegrationsTab.svelte';
  import AppTabsEditor from './AppTabsEditor.svelte';
  import ProfileTab from './ProfileTab.svelte';
  import SupportChatTab from './SupportChatTab.svelte';
  import { navigate } from '../stores/routeStore.svelte.js';
  import ImportTab from './ImportTab.svelte';
  import AiTab from './AiTab.svelte';
  import TemplatesEditor from './TemplatesEditor.svelte';
  import SubscriptionsEditor from './SubscriptionsEditor.svelte';
  import QuickSlotsEditor from './QuickSlotsEditor.svelte';
  import Dropdown from './Dropdown.svelte';
  import { COLOR_SCHEMES } from '../utils/colorSchemes.js';
  import DeveloperTab from './DeveloperTab.svelte';
  import RoutingFormsTab from './RoutingFormsTab.svelte';
  import { api } from '../api.js';
  import { tooltip } from '../actions/tooltip.js';
  import { fetchWeather } from '../stores/weather.svelte.js';

  let weatherSearch = $state('');
  let weatherResults = $state([]);
  let weatherSearchTimer = null;
  function onWeatherSearchInput() {
    clearTimeout(weatherSearchTimer);
    const q = weatherSearch.trim();
    if (q.length < 2) { weatherResults = []; return; }
    weatherSearchTimer = setTimeout(async () => {
      try {
        const r = await api(`/api/weather/geocode?q=${encodeURIComponent(q)}`);
        if (r?.ok) weatherResults = r.results || [];
      } catch {}
    }, 220);
  }
  async function pickWeatherLocation(r) {
    updatePref('weatherLocation', { lat: r.lat, lon: r.lon });
    updatePref('weatherLocationLabel', r.label);
    weatherSearch = '';
    weatherResults = [];
    await fetchWeather();
  }

  let { onclose = () => {} } = $props();

  const prefs = getPrefs();
  const cals = getCalendars();

  let activeTab = $state('general');
  let tzSearch = $state('');
  let addTzSearch = $state('');

  const allTimezones = Intl.supportedValuesOf('timeZone');
  const filteredTz = $derived(
    tzSearch ? allTimezones.filter(tz => tz.toLowerCase().includes(tzSearch.toLowerCase())).slice(0, 20) : []
  );
  const filteredAddTz = $derived(
    addTzSearch ? allTimezones.filter(tz =>
      tz.toLowerCase().includes(addTzSearch.toLowerCase()) &&
      tz !== prefs.values.primaryTimezone &&
      !(prefs.values.additionalTimezones || []).includes(tz)
    ).slice(0, 20) : []
  );

  function tzOffsetLabel(tz) {
    try {
      const now = new Date();
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
      const parts = fmt.formatToParts(now);
      const offset = parts.find(p => p.type === 'timeZoneName');
      return offset ? offset.value : '';
    } catch { return ''; }
  }

  function selectPrimaryTz(tz) {
    updatePref('primaryTimezone', tz);
    tzSearch = '';
  }

  function addTimezone(tz) {
    const current = prefs.values.additionalTimezones || [];
    updatePref('additionalTimezones', [...current, tz]);
    addTzSearch = '';
  }

  function removeTimezone(tz) {
    const current = prefs.values.additionalTimezones || [];
    updatePref('additionalTimezones', current.filter(t => t !== tz));
  }

  async function requestNotificationPermission() {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        updatePref('enableBrowserNotifications', true);
        initAudio(); // Unlock AudioContext on user gesture
      }
    }
  }

  // Top-level groups. Each opens a left-rail of subsections so we don't
  // need 12 tabs across the top — Google/Linear style.
  const tabs = [
    { id: 'general',       label: 'General',       icon: 'sliders' },
    { id: 'tabs',          label: 'Tabs',          icon: 'layout' },
    { id: 'calendar',      label: 'Calendar',      icon: 'calendar' },
    { id: 'tasks',         label: 'Tasks',         icon: 'check' },
    { id: 'notes',         label: 'Notes',         icon: 'note' },
    { id: 'integrations',  label: 'Integrations',  icon: 'plug' },
    { id: 'ai',            label: 'AI',            icon: 'sparkle' },
    { id: 'import',        label: 'Import',        icon: 'download' },
    { id: 'bookings',      label: 'Booking',       icon: 'link' },
    { id: 'notifications', label: 'Notifications', icon: 'bell' },
    { id: 'account',       label: 'Account',       icon: 'user' },
    { id: 'help',          label: 'Help',          icon: 'help' },
  ];

  // Default work hours used when a user hasn't configured them yet.
  const DEFAULT_WORK_HOURS = {
    sun: [],
    mon: [{ start: '09:00', end: '17:00' }],
    tue: [{ start: '09:00', end: '17:00' }],
    wed: [{ start: '09:00', end: '17:00' }],
    thu: [{ start: '09:00', end: '17:00' }],
    fri: [{ start: '09:00', end: '17:00' }],
    sat: [],
  };
  const DAYS = [
    { key: 'mon', label: 'Mon' },
    { key: 'tue', label: 'Tue' },
    { key: 'wed', label: 'Wed' },
    { key: 'thu', label: 'Thu' },
    { key: 'fri', label: 'Fri' },
    { key: 'sat', label: 'Sat' },
    { key: 'sun', label: 'Sun' },
  ];

  const workHours = $derived(prefs.values.workHours || DEFAULT_WORK_HOURS);

  function dayWindow(key) {
    const wins = workHours[key] || [];
    return wins[0] || null;
  }
  function setDayEnabled(key, enabled) {
    const next = { ...workHours };
    next[key] = enabled ? [{ start: '09:00', end: '17:00' }] : [];
    updatePref('workHours', next);
  }
  function setDayWindow(key, field, value) {
    const next = { ...workHours };
    const win = next[key]?.[0] || { start: '09:00', end: '17:00' };
    next[key] = [{ ...win, [field]: value }];
    updatePref('workHours', next);
  }

  const ALL_VIEW_OPTIONS = [
    { id: 'day', label: 'Day' },
    { id: 'nextdays', label: 'Next N Days' },
    { id: 'week', label: 'Week' },
    { id: 'month', label: 'Month' },
  ];

  function viewLabel(id) {
    return ALL_VIEW_OPTIONS.find(v => v.id === id)?.label || id;
  }

  function toggleView(id) {
    const current = prefs.values.enabledViews || [];
    let next;
    if (current.includes(id)) {
      next = current.filter(v => v !== id);
      // Don't allow zero enabled views
      if (next.length === 0) next = [id];
    } else {
      // Preserve canonical order from ALL_VIEW_OPTIONS
      const set = new Set([...current, id]);
      next = ALL_VIEW_OPTIONS.map(v => v.id).filter(v => set.has(v));
    }
    updatePref('enabledViews', next);
  }

  const SIDEBAR_SECTION_OPTIONS = [
    { id: 'miniCalendar', label: 'Mini calendar' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'notes', label: 'Notes' },
    { id: 'sets', label: 'Calendar sets' },
    { id: 'bookingPages', label: 'Booking pages' },
    { id: 'calendars', label: 'Calendars' },
    { id: 'templates', label: 'Templates' },
    { id: 'subscriptions', label: 'Subscriptions' },
    { id: 'quickSlots', label: 'Quick slots' },
  ];

  function toggleSidebarSection(id) {
    const current = prefs.values.sidebarSections || { miniCalendar: true, tasks: true, sets: true, calendars: true };
    updatePref('sidebarSections', { ...current, [id]: !current[id] });
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') onclose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="settings-backdrop" onclick={onclose}></div>
<div class="settings-modal" onkeydown={handleKeydown}>
  <div class="settings-header">
    <h2>Settings</h2>
    <button class="close-btn" onclick={onclose} aria-label="Close settings">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M13.5 4.5L4.5 13.5M4.5 4.5L13.5 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>

  <div class="settings-layout">
    <nav class="settings-nav">
      {#each tabs as tab}
        <button
          class="nav-item"
          class:active={activeTab === tab.id}
          onclick={() => activeTab = tab.id}
        >
          <span class="nav-icon" aria-hidden="true">
            {#if tab.icon === 'sliders'}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h7M3 8h10M3 12h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="11.5" cy="4" r="1.6" stroke="currentColor" stroke-width="1.4"/><circle cx="4.5" cy="12" r="1.6" stroke="currentColor" stroke-width="1.4"/></svg>
            {:else if tab.icon === 'calendar'}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            {:else if tab.icon === 'check'}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5 8l2.2 2.2L11.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {:else if tab.icon === 'link'}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6.5 8.5l3-3M5 11a2.8 2.8 0 010-4l1.5-1.5M11 5a2.8 2.8 0 010 4l-1.5 1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            {:else if tab.icon === 'bell'}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3.5 11h9l-1-1.5V7a3.5 3.5 0 00-7 0v2.5L3.5 11zM6.5 13a1.5 1.5 0 003 0" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
            {:else if tab.icon === 'user'}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="2.7" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 13.5c.6-2.4 2.8-3.7 5.5-3.7s4.9 1.3 5.5 3.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            {:else if tab.icon === 'note'}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z M10 2v3h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 8h6M5 11h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            {:else if tab.icon === 'plug'}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5 1v3M11 1v3M6.5 4h3a1 1 0 011 1v3a3.5 3.5 0 01-7 0V5a1 1 0 011-1zM8 11v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {:else if tab.icon === 'download'}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v9M5 8l3 3 3-3M3 13h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {:else if tab.icon === 'layout'}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M2 6h12M6 6v8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            {:else if tab.icon === 'help'}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M6.2 6a1.8 1.8 0 113.4.7c-.3.6-1.6.8-1.6 1.7M8 11.5h.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            {:else if tab.icon === 'sparkle'}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.5 4.5H14l-3.75 2.75L11.75 14 8 11.25 4.25 14l1.5-4.75L2 6.5h4.5L8 2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
            {/if}
          </span>
          <span class="nav-label">{tab.label}</span>
        </button>
      {/each}
    </nav>

    <div class="settings-content">
      {#if activeTab === 'general'}
        <div class="settings-section">
          <h3>View</h3>
          <div class="setting-row">
            <label>Default view</label>
            <div class="setting-dd">
              <Dropdown
                value={prefs.values.defaultView}
                ariaLabel="Default view"
                onchange={(v) => updatePref('defaultView', v)}
                options={(prefs.values.enabledViews || []).map(v => ({ value: v, label: viewLabel(v) }))}
              />
            </div>
          </div>
          <div class="setting-row">
            <label>Days to show</label>
            <div class="setting-dd">
              <Dropdown
                value={prefs.values.nextDaysCount}
                ariaLabel="Days to show"
                onchange={(v) => updatePref('nextDaysCount', v)}
                options={[3, 4, 5, 6, 7].map(n => ({ value: n, label: `${n} days` }))}
              />
            </div>
          </div>
          <div class="setting-row">
            <label>Week starts on</label>
            <div class="setting-dd">
              <Dropdown
                value={prefs.values.weekStartDay}
                ariaLabel="Week starts on"
                onchange={(v) => updatePref('weekStartDay', v)}
                options={[
                  { value: 'monday', label: 'Monday' },
                  { value: 'sunday', label: 'Sunday' },
                ]}
              />
            </div>
          </div>
          <div class="setting-row">
            <label>Show weekends in week view</label>
            <input
              type="checkbox"
              checked={prefs.values.showWeekends !== false}
              onchange={(e) => updatePref('showWeekends', e.currentTarget.checked)}
            />
          </div>

          <h3>Available Views</h3>
          <p class="help-text">Pick which view tabs appear in the toolbar.</p>
          <div class="checkbox-grid">
            {#each ALL_VIEW_OPTIONS as v}
              <label class="checkbox-row">
                <input
                  type="checkbox"
                  checked={(prefs.values.enabledViews || []).includes(v.id)}
                  onchange={() => toggleView(v.id)}
                />
                <span>{v.label}</span>
              </label>
            {/each}
          </div>
          <div class="setting-row">
            <label>Time format</label>
            <div class="setting-dd">
              <Dropdown
                value={prefs.values.timeFormat}
                ariaLabel="Time format"
                onchange={(v) => updatePref('timeFormat', v)}
                options={[
                  { value: '12h', label: '12 hour' },
                  { value: '24h', label: '24 hour' },
                ]}
              />
            </div>
          </div>
          <div class="setting-row">
            <label>Default event duration</label>
            <div class="setting-dd">
              <Dropdown
                value={prefs.values.defaultEventDuration}
                ariaLabel="Default event duration"
                onchange={(v) => updatePref('defaultEventDuration', v)}
                options={[15, 30, 45, 60].map(n => ({ value: n, label: `${n} min` }))}
              />
            </div>
          </div>
          <div class="setting-row">
            <label>
              Drag-to-create snap
              <span class="setting-hint">When dragging on the calendar, snap the start/end to this granularity. Hold Shift while dragging to bypass.</span>
            </label>
            <div class="setting-dd">
              <Dropdown
                value={prefs.values.dragSnapMinutes || 30}
                ariaLabel="Drag snap"
                onchange={(v) => updatePref('dragSnapMinutes', v)}
                options={[
                  { value: 30, label: '30 min (default)' },
                  { value: 15, label: '15 min (precise)' },
                ]}
              />
            </div>
          </div>

          <h3>Appearance</h3>
          <div class="setting-row">
            <label>Theme</label>
            <div class="setting-dd">
              <Dropdown
                value={prefs.values.theme}
                ariaLabel="Theme"
                onchange={(v) => updatePref('theme', v)}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
            </div>
          </div>
          <h4 class="subsection-h">Color scheme</h4>
          <div class="scheme-grid">
            {#each COLOR_SCHEMES as s}
              <button
                type="button"
                class="scheme-card"
                class:active={(prefs.values.colorScheme || 'default') === s.id}
                onclick={() => updatePref('colorScheme', s.id)}
              >
                <div class="scheme-swatches">
                  {#each s.swatches as c}
                    <span class="scheme-swatch" style="background: {c}"></span>
                  {/each}
                </div>
                <div class="scheme-info">
                  <div class="scheme-name">{s.name}</div>
                  <div class="scheme-desc">{s.description}</div>
                </div>
              </button>
            {/each}
          </div>

          {#if (prefs.values.colorScheme || 'default') === 'default'}
            <div class="setting-row">
              <label>Custom accent color</label>
              <input
                type="color"
                value={prefs.values.accentColor}
                onchange={(e) => updatePref('accentColor', e.target.value)}
              />
            </div>
          {/if}
        </div>

        <div class="settings-section">
          <h3>Sidebar</h3>
          <div class="setting-row">
            <label>
              Width
              <span class="setting-hint">Drag the right edge of the sidebar at any time to fine-tune.</span>
            </label>
            <div class="setting-dd">
              <Dropdown
                value={prefs.values.sidebarWidthPreset || 'standard'}
                ariaLabel="Sidebar width"
                onchange={(v) => updatePref('sidebarWidthPreset', v)}
                options={[
                  { value: 'standard', label: 'Standard (240px)' },
                  { value: 'wide', label: 'Wide (320px)' },
                  { value: 'custom', label: 'Custom (drag to set)' },
                ]}
              />
            </div>
          </div>

          <h4 class="subsection-h">Sections</h4>
          <p class="help-text">Show or hide whole sections of the left sidebar.</p>
          <div class="checkbox-grid">
            {#each SIDEBAR_SECTION_OPTIONS as s}
              <label class="checkbox-row">
                <input
                  type="checkbox"
                  checked={(prefs.values.sidebarSections || { miniCalendar: true, tasks: true, sets: true, calendars: true })[s.id] !== false}
                  onchange={() => toggleSidebarSection(s.id)}
                />
                <span>{s.label}</span>
              </label>
            {/each}
          </div>
        </div>

        <div class="settings-section">
          <h3>Keyboard Shortcuts</h3>
          <p class="help-text">Press <kbd>?</kbd> from the calendar to open the in-app help.</p>
          <table class="shortcut-table">
            <tbody>
              <tr><td><kbd>T</kbd></td><td>Jump to today</td></tr>
              <tr><td><kbd>N</kbd> or <kbd>C</kbd></td><td>New event</td></tr>
              <tr><td><kbd>Cmd/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>N</kbd></td><td>New note</td></tr>
              <tr><td><kbd>1</kbd> – <kbd>4</kbd></td><td>Switch view (in tab order)</td></tr>
              <tr><td><kbd>D</kbd> / <kbd>X</kbd> / <kbd>W</kbd> / <kbd>M</kbd></td><td>Day / Next-days / Week / Month</td></tr>
              <tr><td><kbd>J</kbd> / <kbd>K</kbd> or arrows</td><td>Next / Previous range</td></tr>
              <tr><td><kbd>G</kbd></td><td>Go to date…</td></tr>
              <tr><td><kbd>Cmd/Ctrl</kbd> + <kbd>F</kbd></td><td>Search events</td></tr>
              <tr><td><kbd>Cmd/Ctrl</kbd> + <kbd>1-3</kbd></td><td>Switch calendar set</td></tr>
              <tr><td><kbd>?</kbd></td><td>Show this help</td></tr>
              <tr><td><kbd>Esc</kbd></td><td>Close popovers / inputs</td></tr>
            </tbody>
          </table>
        </div>

      {:else if activeTab === 'tabs'}
        <div class="settings-section">
          <h3>Tabs</h3>
          <AppTabsEditor />
        </div>

      {:else if activeTab === 'calendar'}
        <div class="settings-section">
          <h3>Display</h3>
          <div class="setting-row">
            <label>Dim past events</label>
            <input
              type="checkbox"
              checked={prefs.values.dimPastEvents}
              onchange={(e) => updatePref('dimPastEvents', e.target.checked)}
            />
          </div>
          <div class="setting-row">
            <label>Show declined events</label>
            <input
              type="checkbox"
              checked={prefs.values.showDeclinedEvents}
              onchange={(e) => updatePref('showDeclinedEvents', e.target.checked)}
            />
          </div>
          <div class="setting-row">
            <label>
              Show duplicate working locations
              <span class="setting-hint">When you have the same location (e.g. "Home") on the same day from multiple recurring events, only the longest-spanning one shows. Turn on to see them all.</span>
            </label>
            <input
              type="checkbox"
              checked={prefs.values.showDuplicateWorkingLocations}
              onchange={(e) => updatePref('showDuplicateWorkingLocations', e.target.checked)}
            />
          </div>
          <div class="setting-row">
            <label>Show week numbers</label>
            <input
              type="checkbox"
              checked={prefs.values.showWeekNumbers}
              onchange={(e) => updatePref('showWeekNumbers', e.target.checked)}
            />
          </div>
          <div class="setting-row">
            <label>
              Highlight hour slot on hover
              <span class="setting-hint">Tints the time slot under the cursor so you can preview where a new event would land.</span>
            </label>
            <input
              type="checkbox"
              checked={prefs.values.showHoverSlot !== false}
              onchange={(e) => updatePref('showHoverSlot', e.target.checked)}
            />
          </div>

          <h3>Confirmations</h3>
          <p class="help-text">Turn off to delete instantly — useful when clearing a backlog.</p>
          <div class="setting-row">
            <label>Confirm before deleting tasks</label>
            <input
              type="checkbox"
              checked={prefs.values.confirmDeleteTask !== false}
              onchange={(e) => updatePref('confirmDeleteTask', e.target.checked)}
            />
          </div>
          <div class="setting-row">
            <label>Confirm before deleting events</label>
            <input
              type="checkbox"
              checked={prefs.values.confirmDeleteEvent !== false}
              onchange={(e) => updatePref('confirmDeleteEvent', e.target.checked)}
            />
          </div>
          <div class="setting-row">
            <label>Confirm before deleting notes</label>
            <input
              type="checkbox"
              checked={prefs.values.confirmDeleteNote !== false}
              onchange={(e) => updatePref('confirmDeleteNote', e.target.checked)}
            />
          </div>

          <h3>Sync</h3>
          <div class="setting-row">
            <label>Sync calendar visibility across devices</label>
            <input
              type="checkbox"
              checked={prefs.values.syncCalendarVisibility}
              onchange={(e) => updatePref('syncCalendarVisibility', e.target.checked)}
            />
          </div>
          <p class="help-text">When off, which calendars are shown is stored locally on this device only.</p>

          <h3>Calendars</h3>
          <p class="help-text">Toggle which calendars appear in the sidebar list. They still sync — hidden ones just don't take up space.</p>
          {#if true}
          {@const hiddenIds = new Set(prefs.values.hiddenCalendarIds || [])}
          {@const isMine = (c) => { const r = c.access_role || c.accessRole; return !r || r === 'owner' || r === 'writer'; }}
          {@const myCalsAll = cals.items.filter(isMine)}
          {@const otherCalsAll = cals.items.filter(c => !isMine(c))}
          {#if myCalsAll.length > 0}
            <div class="cal-group">
              <div class="cal-group-h">My calendars</div>
              {#each myCalsAll as cal}
                <div class="cal-mgmt-row">
                  <span class="cal-mgmt-name">{cal.summary}</span>
                  <button
                    class="cal-mgmt-btn"
                    class:hidden={hiddenIds.has(cal.id)}
                    onclick={() => {
                      const next = hiddenIds.has(cal.id)
                        ? (prefs.values.hiddenCalendarIds || []).filter(c => c !== cal.id)
                        : [...(prefs.values.hiddenCalendarIds || []), cal.id];
                      updatePref('hiddenCalendarIds', next);
                    }}
                  >{hiddenIds.has(cal.id) ? 'Show' : 'Hide'}</button>
                </div>
              {/each}
            </div>
          {/if}
          {#if otherCalsAll.length > 0}
            <div class="cal-group">
              <div class="cal-group-h">Other calendars</div>
              {#each otherCalsAll as cal}
                <div class="cal-mgmt-row">
                  <span class="cal-mgmt-name">{cal.summary}</span>
                  <button
                    class="cal-mgmt-btn"
                    class:hidden={hiddenIds.has(cal.id)}
                    onclick={() => {
                      const next = hiddenIds.has(cal.id)
                        ? (prefs.values.hiddenCalendarIds || []).filter(c => c !== cal.id)
                        : [...(prefs.values.hiddenCalendarIds || []), cal.id];
                      updatePref('hiddenCalendarIds', next);
                    }}
                  >{hiddenIds.has(cal.id) ? 'Show' : 'Hide'}</button>
                </div>
              {/each}
            </div>
          {/if}
          {#if cals.items.length === 0}
            <p class="help-text">Connect a Google account below to see your calendars here.</p>
          {/if}
          {/if}

          <h3>Connected Accounts</h3>
          <div class="setting-row">
            <label>Google Calendar</label>
            <a href="/api/auth/google" class="connect-btn">Connect</a>
          </div>

          <h3>Subscribe in another calendar app</h3>
          <p class="help-text">Get a read-only feed of your visible calendars. Paste this URL into Apple Calendar, Google Calendar, Fantastical, or Outlook. Anyone with this URL can read your events — keep it private.</p>
          <IcsFeedRow />

          <h3>Export</h3>
          <div class="setting-row">
            <label>Events CSV<span class="row-help">All visible events</span></label>
            <a class="connect-btn" href="/api/events.csv" download>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <path d="M6.5 1.5v7.5M3 6l3.5 3.5L10 6M2 11.5h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Download
            </a>
          </div>
        </div>

        <div class="settings-section">
          <h3>Weather</h3>
          <div class="setting-row">
            <label>Show in calendar</label>
            <input
              type="checkbox"
              checked={prefs.values.showWeather}
              onchange={(e) => updatePref('showWeather', e.target.checked)}
            />
          </div>
          <div class="setting-row weather-loc-row">
            <label>
              Location
              <span class="row-help">{prefs.values.weatherLocationLabel || 'Set a city or postal code'}</span>
            </label>
            <div class="setting-dd weather-loc-wrap">
              <input
                type="text"
                class="weather-loc-input"
                bind:value={weatherSearch}
                oninput={onWeatherSearchInput}
                placeholder="City or postal code…"
              />
              {#if weatherResults.length > 0}
                <div class="tz-dropdown">
                  {#each weatherResults as r}
                    <button class="tz-option" onclick={() => pickWeatherLocation(r)}>
                      <span>{r.label}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
          <div class="setting-row">
            <label>Temperature unit</label>
            <div class="setting-dd">
              <Dropdown
                value={prefs.values.temperatureUnit}
                ariaLabel="Temperature unit"
                onchange={(v) => updatePref('temperatureUnit', v)}
                options={[
                  { value: 'F', label: 'Fahrenheit' },
                  { value: 'C', label: 'Celsius' },
                ]}
              />
            </div>
          </div>
          <div class="setting-row">
            <label>Display</label>
            <div class="setting-dd">
              <Dropdown
                value={prefs.values.weatherDisplay || 'highLow'}
                ariaLabel="Weather display"
                onchange={(v) => updatePref('weatherDisplay', v)}
                options={[
                  { value: 'highLow', label: 'High / low forecast' },
                  { value: 'current', label: 'Current temperature only' },
                  { value: 'both', label: 'Current + high / low' },
                ]}
              />
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Primary Time Zone</h3>
          <div class="tz-current">
            <span class="tz-name">{prefs.values.primaryTimezone}</span>
            <span class="tz-offset">{tzOffsetLabel(prefs.values.primaryTimezone)}</span>
          </div>
          <div class="tz-search-wrap">
            <input
              type="text"
              bind:value={tzSearch}
              placeholder="Search time zones..."
              class="tz-search"
            />
            {#if filteredTz.length > 0}
              <div class="tz-dropdown">
                {#each filteredTz as tz}
                  <button class="tz-option" onclick={() => selectPrimaryTz(tz)}>
                    <span>{tz.replace(/_/g, ' ')}</span>
                    <span class="tz-offset">{tzOffsetLabel(tz)}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          <h3>Additional Time Zones</h3>
          <p class="help-text">Shown as columns alongside the main time grid.</p>
          {#if (prefs.values.additionalTimezones || []).length > 0}
            <div class="tz-list">
              {#each prefs.values.additionalTimezones as tz}
                <div class="tz-list-item">
                  <span>{tz.replace(/_/g, ' ')}</span>
                  <span class="tz-offset">{tzOffsetLabel(tz)}</span>
                  <button class="tz-remove" onclick={() => removeTimezone(tz)} use:tooltip={'Remove'}>×</button>
                </div>
              {/each}
            </div>
          {/if}
          <div class="tz-search-wrap">
            <input
              type="text"
              bind:value={addTzSearch}
              placeholder="Add time zone..."
              class="tz-search"
            />
            {#if filteredAddTz.length > 0}
              <div class="tz-dropdown">
                {#each filteredAddTz as tz}
                  <button class="tz-option" onclick={() => addTimezone(tz)}>
                    <span>{tz.replace(/_/g, ' ')}</span>
                    <span class="tz-offset">{tzOffsetLabel(tz)}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <div class="settings-section">
          <h3>Event templates</h3>
          <TemplatesEditor />
        </div>

        <div class="settings-section">
          <h3>Calendar subscriptions</h3>
          <SubscriptionsEditor />
        </div>

        <div class="settings-section">
          <h3>Quick slots</h3>
          <QuickSlotsEditor />
        </div>

      {:else if activeTab === 'bookings'}
        <BookingsTab />
        <div class="settings-section">
          <h3>Routing Forms</h3>
          <p class="help-text">Send invitees to the right booking page based on their answers.</p>
          <RoutingFormsTab />
        </div>

      {:else if activeTab === 'account'}
        <div class="settings-section">
          <h3>Profile</h3>
          <ProfileTab />
        </div>
        <div class="settings-section">
          <h3>Plan &amp; billing</h3>
          <BillingTab />
        </div>
        <div class="settings-section">
          <h3>Developer</h3>
          <p class="help-text">API keys and outbound webhooks for programmatic access.</p>
          <DeveloperTab />
        </div>

      {:else if activeTab === 'tasks'}
        <div class="settings-section">
          <h3>Board columns</h3>
          <p class="help-text">The kanban board on the Tasks view. Up to 5 columns; To Do, In Progress, and Done are always present (Done = Todoist completed).</p>
          <BoardColumnsEditor />
        </div>
        <div class="settings-section">
          <h3>Project color tinting</h3>
          <p class="help-text">By default, project dots use Todoist's literal palette so they match Todoist's UI exactly. Turn this on to bucket each Todoist color into the active color scheme — projects keep their distinct slots but pick up the scheme's hue.</p>
          <label class="checkbox-row">
            <input
              type="checkbox"
              checked={!!prefs.values.themeProjectColors}
              onchange={(e) => updatePref('themeProjectColors', e.target.checked)}
            />
            <span>Tint project colors with the active color scheme</span>
          </label>
        </div>
        <div class="settings-section">
          <h3>Sidebar group-by tabs</h3>
          <p class="help-text">Pick which "group by" tabs appear above the task list. At least one must be enabled — Date is enforced if you turn off all of them.</p>
          <div class="checkbox-grid">
            {#each [['date', 'Date'], ['project', 'Project'], ['label', 'Label'], ['priority', 'Priority']] as [val, lbl]}
              <label class="checkbox-row">
                <input
                  type="checkbox"
                  checked={(prefs.values.taskGroupByOptions || ['date', 'project']).includes(val)}
                  onchange={(e) => {
                    const current = prefs.values.taskGroupByOptions || ['date', 'project'];
                    let next = e.currentTarget.checked
                      ? [...new Set([...current, val])]
                      : current.filter(v => v !== val);
                    if (next.length === 0) next = ['date'];
                    updatePref('taskGroupByOptions', next);
                    if (!next.includes(prefs.values.taskGroupBy)) updatePref('taskGroupBy', next[0]);
                  }}
                />
                <span>{lbl}</span>
              </label>
            {/each}
          </div>

          <h3>Work Hours</h3>
          <p class="help-text">Auto-schedule will only place tasks inside these windows. Times are in your primary timezone ({prefs.values.primaryTimezone}).</p>
          <div class="work-hours-grid">
            {#each DAYS as d}
              {@const win = dayWindow(d.key)}
              <div class="day-row">
                <label class="day-toggle">
                  <input
                    type="checkbox"
                    checked={!!win}
                    onchange={(e) => setDayEnabled(d.key, e.target.checked)}
                  />
                  <span class="day-name">{d.label}</span>
                </label>
                {#if win}
                  <input
                    type="time"
                    value={win.start}
                    onchange={(e) => setDayWindow(d.key, 'start', e.target.value)}
                  />
                  <span class="day-sep">–</span>
                  <input
                    type="time"
                    value={win.end}
                    onchange={(e) => setDayWindow(d.key, 'end', e.target.value)}
                  />
                {:else}
                  <span class="day-off">Off</span>
                {/if}
              </div>
            {/each}
          </div>

          <h3 style="margin-top:24px">Default task duration</h3>
          <p class="help-text">Used when a task has no estimate set.</p>
          <div class="setting-row">
            <label for="default-task-duration">Default minutes</label>
            <input
              id="default-task-duration"
              type="number"
              min="15"
              max="240"
              step="15"
              value={prefs.values.defaultTaskDuration || 30}
              onchange={(e) => updatePref('defaultTaskDuration', parseInt(e.target.value) || 30)}
            />
          </div>

          <h3 style="margin-top:24px">Focus blocks</h3>
          <p class="help-text">Recurring weekly windows that auto-schedule will avoid. Rendered as a soft band on the calendar.</p>
          <FocusBlocksEditor />

          <h3 style="margin-top:24px">Email-to-task</h3>
          <p class="help-text">Forward an email to your personal inbox address to create a task automatically.</p>
          <EmailToTask />

          <h3 style="margin-top:24px">Todoist integration</h3>
          <p class="help-text">
            Paste a Todoist API token to sync your tasks. Get one from
            <a href="https://app.todoist.com/app/settings/integrations/developer" target="_blank" rel="noopener noreferrer">Todoist → Settings → Integrations → Developer</a>.
          </p>
          <TodoistIntegration />
        </div>

      {:else if activeTab === 'notes'}
        <div class="settings-section">
          <h3>Reader metadata</h3>
          <p class="help-text">Choose what to show under the title when reading a note. Timestamps default on; counts off (less noise out of the box).</p>
          <div class="checkbox-grid">
            <label class="checkbox-row">
              <input type="checkbox" checked={prefs.values.notesShowUpdated !== false} onchange={(e) => updatePref('notesShowUpdated', e.target.checked)} />
              <span>Last updated</span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" checked={prefs.values.notesShowCreated !== false} onchange={(e) => updatePref('notesShowCreated', e.target.checked)} />
              <span>Created</span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" checked={!!prefs.values.notesShowWords} onchange={(e) => updatePref('notesShowWords', e.target.checked)} />
              <span>Word count</span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" checked={!!prefs.values.notesShowChars} onchange={(e) => updatePref('notesShowChars', e.target.checked)} />
              <span>Character count</span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" checked={!!prefs.values.notesShowReadTime} onchange={(e) => updatePref('notesShowReadTime', e.target.checked)} />
              <span>Reading time (~200 wpm)</span>
            </label>
          </div>
        </div>

      {:else if activeTab === 'integrations'}
        <div class="settings-section">
          <h3>Integrations</h3>
          <p class="help-text">
            The integrations directory has its own page now. Browse 100+
            tools by category, search, and filter by status.
          </p>
          <a class="page-link" href="/integrations" onclick={(e) => {
            e.preventDefault();
            navigate('/integrations');
            onclose();
          }}>
            Open integrations directory
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 5l7 7-7 7"/>
            </svg>
          </a>
        </div>

      {:else if activeTab === 'import'}
        <div class="settings-section">
          <h3>Import</h3>
          <ImportTab />
        </div>

      {:else if activeTab === 'ai'}
        <div class="settings-section">
          <h3>AI providers</h3>
          <AiTab />
        </div>

      {:else if activeTab === 'help'}
        <div class="settings-section">
          <h3>AI assistant</h3>
          <SupportChatTab />
        </div>

      {:else if activeTab === 'notifications'}
        <div class="settings-section">
          <h3>Default Reminder</h3>
          <div class="setting-row">
            <label>Remind before event</label>
            <div class="setting-dd">
              <Dropdown
                value={prefs.values.defaultReminderMinutes}
                ariaLabel="Remind before event"
                onchange={(v) => updatePref('defaultReminderMinutes', v)}
                options={[
                  { value: 0, label: 'None' },
                  { value: 5, label: '5 minutes' },
                  { value: 10, label: '10 minutes' },
                  { value: 15, label: '15 minutes' },
                  { value: 30, label: '30 minutes' },
                  { value: 60, label: '1 hour' },
                  { value: 120, label: '2 hours' },
                  { value: 1440, label: '1 day' },
                ]}
              />
            </div>
          </div>

          <h3>Channels</h3>
          <p class="help-text">Pick how you want to be notified for events, bookings, and reminders. Multiple channels can be active at once.</p>

          <!-- In-app: the bell icon in the toolbar always exists, but the
               user can disable the dot/sound. -->
          <div class="setting-row">
            <label>
              <span class="ch-label">In-app</span>
              <span class="ch-help">Bell icon + the notifications panel</span>
            </label>
            <input
              type="checkbox"
              checked={prefs.values.notifyApp !== false}
              onchange={(e) => updatePref('notifyApp', e.target.checked)}
            />
          </div>

          <!-- Browser/system push (uses the in-tab Notification API). -->
          <div class="setting-row">
            <label>
              <span class="ch-label">Browser</span>
              <span class="ch-help">System notifications when this tab is open</span>
            </label>
            {#if prefs.values.enableBrowserNotifications}
              <input
                type="checkbox"
                checked={true}
                onchange={() => updatePref('enableBrowserNotifications', false)}
              />
            {:else}
              <button class="connect-btn" onclick={requestNotificationPermission}>Enable</button>
            {/if}
          </div>
          <div class="setting-row">
            <label>
              <span class="ch-label">Notification sound</span>
              <span class="ch-help">Play a chime with browser notifications</span>
            </label>
            <input
              type="checkbox"
              checked={prefs.values.reminderSound}
              onchange={(e) => updatePref('reminderSound', e.target.checked)}
            />
          </div>

          <!-- Email — reuses the user's signup email and the Resend provider. -->
          <div class="setting-row">
            <label>
              <span class="ch-label">Email</span>
              <span class="ch-help">Sent to your account email</span>
            </label>
            <input
              type="checkbox"
              checked={!!prefs.values.notifyEmail}
              onchange={(e) => updatePref('notifyEmail', e.target.checked)}
            />
          </div>

          <!-- SMS — requires a phone number AND a configured Twilio (or
               equivalent) backend. Show a phone-number input with a test
               button; the actual SMS dispatch lives in lib/notify.js. -->
          <div class="setting-row">
            <label>
              <span class="ch-label">SMS</span>
              <span class="ch-help">Texts to your phone (Pro feature)</span>
            </label>
            <input
              type="checkbox"
              checked={!!prefs.values.notifySms}
              onchange={(e) => updatePref('notifySms', e.target.checked)}
            />
          </div>
          {#if prefs.values.notifySms}
            <div class="setting-row">
              <label>Phone number</label>
              <input
                type="tel"
                placeholder="+1 555 123 4567"
                value={prefs.values.notifySmsPhone || ''}
                onchange={(e) => updatePref('notifySmsPhone', e.currentTarget.value.trim())}
                class="phone-input"
              />
            </div>
          {/if}

          <h3>What to notify</h3>
          <p class="help-text">Choose which kinds of events trigger notifications across the channels above.</p>

          <div class="setting-row">
            <label><span class="ch-label">Event reminders</span></label>
            <input
              type="checkbox"
              checked={prefs.values.notifyEventReminders !== false}
              onchange={(e) => updatePref('notifyEventReminders', e.target.checked)}
            />
          </div>
          <div class="setting-row">
            <label><span class="ch-label">New bookings</span></label>
            <input
              type="checkbox"
              checked={prefs.values.notifyBookings !== false}
              onchange={(e) => updatePref('notifyBookings', e.target.checked)}
            />
          </div>
          <div class="setting-row">
            <label><span class="ch-label">Task reminders</span></label>
            <input
              type="checkbox"
              checked={!!prefs.values.notifyTaskReminders}
              onchange={(e) => updatePref('notifyTaskReminders', e.target.checked)}
            />
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .settings-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 1000;
  }

  .settings-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1001;
    width: 920px;
    max-width: calc(100vw - 32px);
    height: 86vh;
    max-height: 760px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
  }
  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }

  .settings-header h2 { font-size: 16px; font-weight: 600; }

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

  .settings-layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .settings-nav {
    width: 160px;
    border-right: 1px solid var(--border-light);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--bg-secondary);
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border: none;
    background: none;
    text-align: left;
    font-size: 13px;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .nav-icon {
    display: inline-flex;
    align-items: center;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
  .nav-item:hover { background: var(--surface-hover); }
  .nav-item:hover .nav-icon { color: var(--text-primary); }
  .nav-item.active { background: var(--surface); color: var(--accent); font-weight: 500; box-shadow: var(--shadow-sm); }
  .nav-item.active .nav-icon { color: var(--accent); }

  .settings-content {
    flex: 1;
    overflow-y: auto;
    padding: 24px 28px;
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 22px;
    margin-bottom: 22px;
    border-bottom: 1px solid var(--border-light);
  }
  .settings-section:last-child { border-bottom: none; padding-bottom: 0; margin-bottom: 0; }

  .settings-section h3 {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    margin-top: 14px;
  }
  .settings-section h3:first-child { margin-top: 0; }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 32px;
  }

  .setting-row label {
    font-size: 13px;
    color: var(--text-secondary);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .setting-hint {
    font-size: 12px;
    color: var(--text-tertiary);
    font-weight: 400;
    max-width: 460px;
    line-height: 1.4;
  }
  .setting-dd { width: 200px; flex-shrink: 0; }

  .subsection-h {
    margin: 16px 0 6px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
  }
  .scheme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
    margin: 12px 0 16px;
  }
  .scheme-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    background: var(--bg-secondary);
    border: 2px solid var(--border);
    border-radius: var(--radius-md, 8px);
    text-align: left;
    cursor: pointer;
    color: var(--text-primary);
    font-family: inherit;
    transition: border-color 0.15s;
  }
  .scheme-card:hover { border-color: var(--accent); }
  .scheme-card.active { border-color: var(--accent); }
  .scheme-swatches {
    display: flex;
    height: 28px;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .scheme-swatch { flex: 1; height: 100%; }
  .scheme-info { display: flex; flex-direction: column; gap: 2px; }
  .scheme-name { font-size: 13px; font-weight: 500; }
  .scheme-desc { font-size: 11px; color: var(--text-tertiary); line-height: 1.35; }

  /* All text-style inputs in Settings get the same chrome as the rest of
     the app: bordered, rounded, themed bg, accent focus ring. */
  .setting-row input[type="text"],
  .setting-row input[type="number"],
  .setting-row input[type="email"],
  .setting-row input[type="url"],
  .setting-row input[type="password"],
  .setting-row input[type="search"],
  .setting-row input[type="tel"],
  .setting-row input[type="date"],
  .setting-row input[type="time"],
  .setting-row textarea {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
    outline: none;
    width: 200px;
  }
  .setting-row input:focus,
  .setting-row textarea:focus { border-color: var(--accent); }

  .setting-row input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .setting-row input[type="color"] {
    width: 32px;
    height: 24px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0;
    cursor: pointer;
  }

  .connect-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    background: var(--accent);
    color: white;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    text-decoration: none;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  .connect-btn:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: white; }

  .help-text {
    font-size: 13px;
    color: var(--text-tertiary);
  }
  .page-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    margin-top: 12px;
    width: fit-content;
  }
  .page-link:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* Channel rows in Notifications: a primary label + secondary helper hint
     in the same column, with the toggle on the right. */
  .ch-label {
    display: block;
    font-size: 13px;
    color: var(--text-primary);
    font-weight: 500;
  }
  .ch-help {
    display: block;
    font-size: 11px;
    color: var(--text-tertiary);
    margin-top: 1px;
  }
  .phone-input {
    width: 220px;
    padding: 6px 10px;
    font-size: 13px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .phone-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-light);
  }

  .tz-current {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .tz-name {
    font-size: 13px;
    color: var(--text-primary);
  }

  .tz-offset {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .tz-search-wrap {
    position: relative;
  }
  .row-help {
    font-size: 11px;
    color: var(--text-tertiary);
    font-weight: 400;
  }
  .weather-loc-wrap {
    position: relative;
  }
  .weather-loc-input {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: 13px;
    color: var(--text-primary);
    outline: none;
  }
  .weather-loc-input:focus { border-color: var(--accent); }

  .tz-search {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: 13px;
    color: var(--text-primary);
    outline: none;
  }
  .tz-search:focus { border-color: var(--accent); }
  .tz-search::placeholder { color: var(--text-tertiary); }

  .tz-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    max-height: 200px;
    overflow-y: auto;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-md);
    z-index: 10;
    margin-top: 2px;
  }

  .tz-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: none;
    font-size: 13px;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }
  .tz-option:hover { background: var(--surface-hover); }

  .tz-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .tz-list-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 13px;
    color: var(--text-primary);
  }

  .tz-remove {
    margin-left: auto;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    font-size: 16px;
  }
  .tz-remove:hover { color: var(--error); background: var(--surface-hover); }

  .cal-group { margin-bottom: 14px; }
  .cal-group-h {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
    padding: 8px 0 4px;
    border-bottom: 1px solid var(--border-light);
    margin-bottom: 4px;
  }
  .cal-mgmt-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 4px;
    border-radius: var(--radius-sm);
    gap: 12px;
  }
  .cal-mgmt-row:hover { background: var(--surface-hover); }
  .cal-mgmt-name {
    font-size: 13px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cal-mgmt-btn {
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
  }
  .cal-mgmt-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
  .cal-mgmt-btn.hidden { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
  .hidden-cal-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .hidden-cal-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .hidden-cal-name {
    font-size: 13px;
    color: var(--text-primary);
  }

  .show-cal-btn {
    padding: 2px 10px;
    font-size: 11px;
    font-weight: 500;
    color: var(--accent);
    background: none;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .show-cal-btn:hover {
    background: var(--accent);
    color: white;
  }

  .checkbox-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 16px;
  }

  .work-hours-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .day-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 0;
    font-size: 13px;
  }
  .day-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 90px;
    cursor: pointer;
  }
  .day-toggle input[type="checkbox"] {
    width: 14px;
    height: 14px;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .day-name {
    color: var(--text-primary);
    font-weight: 500;
  }
  .day-row input[type="time"] {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 12px;
    font-family: inherit;
  }
  .day-sep {
    color: var(--text-tertiary);
  }
  .day-off {
    color: var(--text-tertiary);
    font-style: italic;
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-primary);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
  }
  .checkbox-row:hover {
    background: var(--surface-hover);
  }
  .checkbox-row input[type="checkbox"] {
    width: 14px;
    height: 14px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .shortcut-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .shortcut-table td {
    padding: 6px 4px;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border-light);
    vertical-align: middle;
  }
  .shortcut-table td:first-child {
    width: 40%;
    color: var(--text-primary);
    font-size: 12px;
  }

  kbd {
    display: inline-block;
    padding: 1px 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    color: var(--text-primary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    line-height: 1.4;
    white-space: nowrap;
  }

  .tips-list {
    list-style: disc;
    padding-left: 20px;
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.7;
  }
  .tips-list li {
    margin: 0;
  }

  @media (max-width: 700px) {
    .settings-modal { height: calc(100vh - 32px); max-height: none; width: calc(100vw - 16px); }
    .settings-layout { flex-direction: column; }
    .settings-nav {
      width: 100%;
      flex-direction: row;
      overflow-x: auto;
      border-right: none;
      border-bottom: 1px solid var(--border-light);
      padding: 6px 8px;
      gap: 4px;
      /* Right-edge fade tells the user content scrolls — without this the
         half-clipped tab pill at the right just looks broken. */
      mask-image: linear-gradient(to right, black calc(100% - 24px), transparent);
      -webkit-mask-image: linear-gradient(to right, black calc(100% - 24px), transparent);
      scroll-snap-type: x proximity;
    }
    .settings-nav .nav-item {
      white-space: nowrap;
      flex-shrink: 0;
      padding: 6px 10px;
      scroll-snap-align: start;
    }
    .settings-content { padding: 16px; }
  }
</style>
