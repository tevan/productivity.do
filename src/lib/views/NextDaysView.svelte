<script>
  import TimeGrid from '../components/TimeGrid.svelte';
  import { getView } from '../stores/view.svelte.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { getWeekDays } from '../utils/dates.js';

  let { events = [], tasks = [], onclickEvent = () => {}, oneditEvent = () => {}, onclickSlot = () => {}, onclickAllDay = () => {}, ondragCreate = () => {}, onclickDate = () => {}, oncontextEvent = () => {}, onhoverSlot = () => {} } = $props();

  const view = getView();
  const prefs = getPrefs();

  const dates = $derived(getWeekDays(view.viewStart, prefs.values.nextDaysCount || 5));
</script>

<TimeGrid {dates} {events} {tasks} {onclickEvent} {oneditEvent} {onclickSlot} {onclickAllDay} {ondragCreate} {onclickDate} {oncontextEvent} {onhoverSlot} />
