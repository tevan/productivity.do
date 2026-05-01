// Todoist backup parser. Todoist's "Backup" download is a JSON file with
// `projects[]`, `items[]` (tasks), `notes[]` (comments). We import the
// items and projects into native storage so the user can leave Todoist
// behind cleanly.

export function parseTodoistBackup(text) {
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error('Not valid JSON'); }
  if (!Array.isArray(json.items) && !Array.isArray(json.projects)) {
    throw new Error('Does not look like a Todoist backup (missing items[] / projects[])');
  }

  // Map old Todoist project ids → new native ids so we can preserve the
  // task-project relationship after import. Native ids are uuid'd at
  // write time, so the route handler does the actual write — we just
  // surface the parse here.
  const projects = (json.projects || []).map(p => ({
    sourceId: String(p.id),
    name: p.name,
    color: p.color,
    isFavorite: !!p.is_favorite,
    parentSourceId: p.parent_id ? String(p.parent_id) : null,
  }));

  const tasks = (json.items || []).filter(t => !t.is_deleted).map(t => ({
    content: t.content || '',
    description: t.description || null,
    sourceProjectId: t.project_id ? String(t.project_id) : null,
    priority: t.priority || 1,
    dueDate: t.due?.date || null,
    dueDatetime: t.due?.datetime || null,
    labels: Array.isArray(t.labels) ? t.labels : [],
    isCompleted: !!t.checked,
    parentSourceId: t.parent_id ? String(t.parent_id) : null,
  }));

  return { events: [], tasks, projects, notes: [] };
}
