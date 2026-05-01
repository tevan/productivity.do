import { isSameDay, addDays, parseTaskDue } from './dates.js';

/**
 * Build sidebar task groups in a consistent shape:
 *   [{ label, tasks: [...], subgroups?: [{ label, tasks }], isOverdue?, isNoDate? }]
 *
 * mode: 'date' | 'project' | 'label' | 'priority'
 */
/**
 * Interleave parents and children so children appear under their parent.
 * Returns an array of { task, indent } for the input list.
 */
export function withSubtaskOrder(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const childrenByParent = new Map();
  for (const t of tasks) {
    if (t.parentId && byId.has(t.parentId)) {
      if (!childrenByParent.has(t.parentId)) childrenByParent.set(t.parentId, []);
      childrenByParent.get(t.parentId).push(t);
    }
  }
  const out = [];
  function visit(t, indent) {
    out.push({ task: t, indent });
    const kids = childrenByParent.get(t.id);
    if (kids) for (const c of kids) visit(c, indent + 1);
  }
  for (const t of tasks) {
    if (!t.parentId || !byId.has(t.parentId)) visit(t, 0);
  }
  return out;
}

export function buildTaskGroups(allTasks, mode = 'date') {
  const activeTasks = allTasks.filter(t => !t.isCompleted);
  switch (mode) {
    case 'project':
      return groupByProject(activeTasks);
    case 'label':
      return groupByLabel(activeTasks);
    case 'priority':
      return groupByPriority(activeTasks);
    case 'date':
    default:
      return groupByDate(activeTasks);
  }
}

// --- Date grouping (Fantastical-style) ---
function groupByDate(activeTasks) {
  const groups = [];
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = addDays(todayStart, 1);

  const overdue = activeTasks.filter(t => {
    const due = parseTaskDue(t);
    return due && due < todayStart && !isSameDay(due, todayStart);
  });
  if (overdue.length) {
    groups.push({ label: 'Overdue', tasks: overdue, isOverdue: true });
  }

  const todayTasks = activeTasks.filter(t => {
    const due = parseTaskDue(t);
    return due && isSameDay(due, todayStart);
  });
  if (todayTasks.length) {
    groups.push({ label: 'Today', tasks: todayTasks });
  }

  const tomorrowTasks = activeTasks.filter(t => {
    const due = parseTaskDue(t);
    return due && isSameDay(due, tomorrowStart);
  });
  if (tomorrowTasks.length) {
    groups.push({ label: 'Tomorrow', tasks: tomorrowTasks });
  }

  for (let i = 2; i <= 6; i++) {
    const d = addDays(todayStart, i);
    const dayTasks = activeTasks.filter(t => {
      const due = parseTaskDue(t);
      return due && isSameDay(due, d);
    });
    if (dayTasks.length) {
      const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      groups.push({ label, tasks: dayTasks });
    }
  }

  const laterCutoff = addDays(todayStart, 7);
  const laterTasks = activeTasks.filter(t => {
    const due = parseTaskDue(t);
    return due && due >= laterCutoff;
  });
  if (laterTasks.length) {
    groups.push({ label: 'Later', tasks: laterTasks });
  }

  const noDate = activeTasks.filter(t => !parseTaskDue(t));
  if (noDate.length) {
    // Sub-group "No date" by project so it isn't a wall of text
    const byProject = new Map();
    for (const t of noDate) {
      const key = t.projectName || 'Inbox';
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key).push(t);
    }
    const projectKeys = [...byProject.keys()].sort((a, b) => {
      if (a === 'Inbox') return -1;
      if (b === 'Inbox') return 1;
      return a.localeCompare(b);
    });
    const subgroups = projectKeys.map(p => ({
      label: p,
      tasks: byProject.get(p).sort(byPriorityThenTitle),
    }));
    groups.push({ label: 'No date', tasks: noDate, isNoDate: true, subgroups });
  }

  return groups;
}

// --- Project grouping ---
function groupByProject(activeTasks) {
  const byProject = new Map();
  for (const t of activeTasks) {
    const key = t.projectName || 'Inbox';
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(t);
  }
  const projectKeys = [...byProject.keys()].sort((a, b) => {
    if (a === 'Inbox') return -1;
    if (b === 'Inbox') return 1;
    return a.localeCompare(b);
  });
  return projectKeys.map(p => ({
    label: p,
    tasks: byProject.get(p).sort(byUrgencyThenDate),
  }));
}

// --- Label grouping ---
// A task with multiple labels appears in each of its label groups.
// A task with no labels falls into "No label".
function groupByLabel(activeTasks) {
  const byLabel = new Map();
  const unlabeled = [];
  for (const t of activeTasks) {
    const labels = t.labels && t.labels.length ? t.labels : null;
    if (!labels) {
      unlabeled.push(t);
      continue;
    }
    for (const l of labels) {
      if (!byLabel.has(l)) byLabel.set(l, []);
      byLabel.get(l).push(t);
    }
  }
  const labelKeys = [...byLabel.keys()].sort((a, b) => a.localeCompare(b));
  const groups = labelKeys.map(l => ({
    label: `@${l}`,
    tasks: byLabel.get(l).sort(byUrgencyThenDate),
  }));
  if (unlabeled.length) {
    groups.push({
      label: 'No label',
      tasks: unlabeled.sort(byUrgencyThenDate),
      isNoLabel: true,
    });
  }
  return groups;
}

// --- Priority grouping (Todoist priorities: 4 = urgent, 1 = none) ---
function groupByPriority(activeTasks) {
  const PRIORITY_LABELS = {
    4: 'Urgent',
    3: 'High',
    2: 'Medium',
    1: 'No priority',
  };
  const buckets = { 4: [], 3: [], 2: [], 1: [] };
  for (const t of activeTasks) {
    const p = t.priority || 1;
    buckets[p].push(t);
  }
  const groups = [];
  for (const p of [4, 3, 2, 1]) {
    if (buckets[p].length) {
      groups.push({
        label: PRIORITY_LABELS[p],
        tasks: buckets[p].sort(byUrgencyThenDate),
        priority: p,
      });
    }
  }
  return groups;
}

// --- Sorting helpers ---
function byPriorityThenTitle(a, b) {
  const pa = a.priority || 1;
  const pb = b.priority || 1;
  if (pa !== pb) return pb - pa;
  return (a.content || '').localeCompare(b.content || '');
}

// Overdue first, then by due date asc, then no-date last (alpha).
function byUrgencyThenDate(a, b) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const ad = parseTaskDue(a);
  const bd = parseTaskDue(b);
  const aOverdue = ad && ad < todayStart && !isSameDay(ad, todayStart) ? 1 : 0;
  const bOverdue = bd && bd < todayStart && !isSameDay(bd, todayStart) ? 1 : 0;
  if (aOverdue !== bOverdue) return bOverdue - aOverdue; // overdue first
  if (ad && bd) return ad - bd;
  if (ad && !bd) return -1; // dated before undated
  if (!ad && bd) return 1;
  // both undated: priority then title
  return byPriorityThenTitle(a, b);
}
