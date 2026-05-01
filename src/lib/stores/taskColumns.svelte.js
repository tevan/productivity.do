// Task board columns — per-user kanban configuration.
// See docs/internal/tasks-board.md for the full design.

import { api } from '../api.js';

let columns = $state([]); // [{ id, position, name, statusKey }]
let loaded = $state(false);

export function getTaskColumns() {
  return {
    get items() { return columns; },
    get loaded() { return loaded; },
  };
}

export async function fetchTaskColumns() {
  try {
    const res = await api('/api/task-columns');
    if (res?.ok) {
      columns = res.columns || [];
      loaded = true;
    }
  } catch (e) {
    console.error('Failed to fetch task columns:', e);
  }
}

export async function renameColumn(id, name) {
  // Optimistic — flip immediately, server confirms.
  columns = columns.map(c => c.id === id ? { ...c, name } : c);
  await api(`/api/task-columns/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  }).catch(() => {});
}

export async function recolorColumn(id, color) {
  // color: '#RRGGBB' or null to clear.
  columns = columns.map(c => c.id === id ? { ...c, color } : c);
  await api(`/api/task-columns/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ color }),
  }).catch(() => {});
}

export async function addColumn(name) {
  const res = await api('/api/task-columns', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  if (res?.ok && res.column) {
    columns = [...columns, res.column].sort((a, b) => a.position - b.position);
  }
  return res;
}

export async function removeColumn(id) {
  const res = await api(`/api/task-columns/${id}`, { method: 'DELETE' });
  if (res?.ok) {
    columns = columns.filter(c => c.id !== id);
  }
  return res;
}

export async function reorderColumns(ids) {
  // Optimistic reorder.
  const byId = new Map(columns.map(c => [c.id, c]));
  columns = ids.map((id, idx) => byId.get(id)).filter(Boolean).map((c, idx) => ({ ...c, position: idx }));
  await api('/api/task-columns/order', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  }).catch(() => {});
}
