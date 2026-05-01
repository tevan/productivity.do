// Generic stub used by adapters that aren't fully implemented yet. Returns
// shaped 501-style errors instead of crashing, so the UI can show the
// integration as "coming soon" rather than missing.

export function makeStub({ provider, name, kind, category, status, authType, description, docsUrl, requiresEnv, recommended, mode }) {
  const NOT_IMPL = (op) => async () => {
    const err = new Error(`${name}: ${op} not implemented`);
    err.code = 'not_implemented';
    err.status = 501;
    throw err;
  };
  return {
    provider,
    name,
    kind,
    category: category || kind,
    status: status || 'coming_soon',
    mode: mode || 'sync', // 'sync' | 'import' | 'read'
    recommended: !!recommended,
    authType,
    description,
    docsUrl,
    requiresEnv: requiresEnv || [],
    syncEnabled: false,
    authStartUrl: NOT_IMPL('authStartUrl'),
    authCallback: NOT_IMPL('authCallback'),
    authValidatePat: NOT_IMPL('authValidatePat'),
    syncTasks: NOT_IMPL('syncTasks'),
    syncEvents: NOT_IMPL('syncEvents'),
    createTask: NOT_IMPL('createTask'),
    updateTask: NOT_IMPL('updateTask'),
    deleteTask: NOT_IMPL('deleteTask'),
    completeTask: NOT_IMPL('completeTask'),
    createEvent: NOT_IMPL('createEvent'),
    updateEvent: NOT_IMPL('updateEvent'),
    deleteEvent: NOT_IMPL('deleteEvent'),
    disconnect: async () => null, // disconnect always works (just deletes the row)
  };
}
