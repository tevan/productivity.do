<script>
  import TimeGrid from '../components/TimeGrid.svelte';
  import { getView } from '../stores/view.svelte.js';

  let { events = [], tasks = [], onclickEvent = () => {}, oneditEvent = () => {}, onclickSlot = () => {}, onclickAllDay = () => {}, ondragCreate = () => {}, onclickDate = () => {}, oncontextEvent = () => {}, onhoverSlot = () => {} } = $props();

  const view = getView();
  const dates = $derived([new Date(view.currentDate)]);
</script>

<TimeGrid {dates} {events} {tasks} {onclickEvent} {oneditEvent} {onclickSlot} {onclickAllDay} {ondragCreate} {onclickDate} {oncontextEvent} {onhoverSlot} />
