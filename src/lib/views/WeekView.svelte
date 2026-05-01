<script>
  import TimeGrid from '../components/TimeGrid.svelte';
  import { getView } from '../stores/view.svelte.js';
  import { getPrefs } from '../stores/prefs.svelte.js';
  import { getWeekDays } from '../utils/dates.js';

  let { events = [], tasks = [], onclickEvent = () => {}, oneditEvent = () => {}, onclickSlot = () => {}, onclickAllDay = () => {}, ondragCreate = () => {}, onclickDate = () => {}, oncontextEvent = () => {}, onhoverSlot = () => {} } = $props();

  const view = getView();
  const prefs = getPrefs();
  const dates = $derived.by(() => {
    const all = getWeekDays(view.viewStart, 7);
    if (prefs.values.showWeekends === false) {
      return all.filter(d => d.getDay() !== 0 && d.getDay() !== 6);
    }
    return all;
  });
</script>

<TimeGrid {dates} {events} {tasks} {onclickEvent} {oneditEvent} {onclickSlot} {onclickAllDay} {ondragCreate} {onclickDate} {oncontextEvent} {onhoverSlot} />
