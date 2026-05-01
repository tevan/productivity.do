<script>
  // Settings → Account → Profile.
  // Display name, email, password, avatar, sessions, soft-delete.

  import { onMount } from 'svelte';
  import { api } from '../api.js';
  import { tooltip } from '../actions/tooltip.js';
  import { confirmAction } from '../utils/confirmModal.svelte.js';

  let loading = $state(true);
  let user = $state(null);
  let sessions = $state([]);

  // Form state
  let displayName = $state('');
  let timezone = $state('');
  let savingProfile = $state(false);

  // Email change
  let newEmail = $state('');
  let emailPwd = $state('');
  let emailMsg = $state('');

  // Password change
  let currentPwd = $state('');
  let newPwd = $state('');
  let newPwd2 = $state('');
  let pwdMsg = $state('');

  // Delete
  let deletePwd = $state('');
  let deleteMode = $state('soft');
  let deleteMsg = $state('');

  async function load() {
    loading = true;
    try {
      const r = await api('/api/account');
      user = r.user;
      sessions = r.sessions || [];
      displayName = user.displayName || '';
      timezone = user.timezone || '';
    } finally { loading = false; }
  }
  onMount(load);

  async function saveProfile() {
    savingProfile = true;
    try {
      await api('/api/account/profile', {
        method: 'PUT',
        body: JSON.stringify({ displayName, timezone }),
      });
      await load();
    } catch (e) { alert(e?.message || 'Save failed'); }
    finally { savingProfile = false; }
  }

  async function uploadAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch('/api/account/avatar', { method: 'POST', body: fd, credentials: 'same-origin' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Upload failed');
      await load();
    } catch (err) { alert(err.message); }
  }

  async function removeAvatar() {
    const ok = await confirmAction({
      title: 'Remove your avatar?',
      body: 'Goes back to the Gravatar fallback (or a generic icon).',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    await api('/api/account/avatar', { method: 'DELETE' });
    await load();
  }

  async function changeEmail(e) {
    e?.preventDefault?.();
    emailMsg = '';
    try {
      const r = await api('/api/account/change-email', {
        method: 'POST',
        body: JSON.stringify({ newEmail, currentPassword: emailPwd }),
      });
      emailMsg = `Confirmation link sent to ${r.sentTo}. Click it to complete the change.`;
      newEmail = '';
      emailPwd = '';
      await load();
    } catch (err) {
      emailMsg = err?.message || 'Change failed';
    }
  }

  async function changePassword(e) {
    e?.preventDefault?.();
    pwdMsg = '';
    if (newPwd !== newPwd2) { pwdMsg = 'New passwords don\'t match'; return; }
    if (newPwd.length < 12) { pwdMsg = 'New password must be at least 12 characters'; return; }
    try {
      await api('/api/account/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
      });
      pwdMsg = 'Password changed. Other sessions have been signed out.';
      currentPwd = ''; newPwd = ''; newPwd2 = '';
      await load();
    } catch (err) {
      pwdMsg = err?.message || 'Change failed';
    }
  }

  async function revokeSession(s) {
    if (s.isCurrent) return;
    const ok = await confirmAction({
      title: 'Sign out this session?',
      body: 'The user on that device will be signed out immediately.',
      confirmLabel: 'Sign out',
      danger: true,
    });
    if (!ok) return;
    await api(`/api/account/sessions/${s.id}`, { method: 'DELETE' });
    await load();
  }

  async function revokeOthers() {
    const ok = await confirmAction({
      title: 'Sign out all other sessions?',
      body: 'You\'ll stay signed in on this device. Every other device gets signed out.',
      confirmLabel: 'Sign out everywhere else',
      danger: true,
    });
    if (!ok) return;
    await api('/api/account/sessions/revoke-others', { method: 'POST' });
    await load();
  }

  async function deleteAccount(e) {
    e?.preventDefault?.();
    deleteMsg = '';
    const isImmediate = deleteMode === 'immediate';
    const ok = await confirmAction({
      title: isImmediate ? 'Permanently delete your account?' : 'Delete your account?',
      body: isImmediate
        ? 'This cannot be undone. All your data is purged immediately.'
        : 'You can recover within 30 days by signing in or contacting support. After 30 days, all data is purged.',
      confirmLabel: isImmediate ? 'Delete permanently' : 'Delete account',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api('/api/account/delete', {
        method: 'POST',
        body: JSON.stringify({ password: deletePwd, mode: deleteMode }),
      });
      // Sign-out happened server-side; redirect to login
      window.location.href = '/login?deleted=1';
    } catch (err) {
      deleteMsg = err?.message || 'Delete failed';
    }
  }

  async function downloadExport() {
    window.location.href = '/api/account/export';
  }

  function fmtTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString();
  }
</script>

<div class="profile-tab">
  {#if loading}
    <div class="muted">Loading…</div>
  {:else if user}
    <!-- Avatar + display name -->
    <section class="card">
      <h4>Profile</h4>
      <div class="avatar-row">
        <img class="avatar" src={user.avatarUrl} alt="Avatar" />
        <div class="avatar-actions">
          <label class="btn">
            Upload avatar
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onchange={uploadAvatar} hidden />
          </label>
          {#if user.avatarUrl?.startsWith('/avatars/')}
            <button class="btn-link" onclick={removeAvatar}>Remove</button>
          {/if}
          <p class="hint">Up to 2 MB. PNG, JPG, WebP, or GIF.</p>
        </div>
      </div>
      <div class="setting-row">
        <label>Display name</label>
        <input type="text" bind:value={displayName} placeholder="(optional)" maxlength="100" />
      </div>
      <div class="setting-row">
        <label>Timezone</label>
        <input type="text" bind:value={timezone} placeholder="e.g. America/New_York" maxlength="100" />
      </div>
      <button class="btn primary" onclick={saveProfile} disabled={savingProfile}>
        {savingProfile ? 'Saving…' : 'Save profile'}
      </button>
    </section>

    <!-- Email -->
    <section class="card">
      <h4>Email</h4>
      <p class="hint">Current: <strong>{user.email}</strong></p>
      {#if user.pendingEmail}
        <p class="hint pending">Pending change to <strong>{user.pendingEmail}</strong>. Click the confirmation link sent to that address.</p>
      {/if}
      <form onsubmit={changeEmail}>
        <div class="setting-row">
          <label>New email</label>
          <input type="email" bind:value={newEmail} required />
        </div>
        <div class="setting-row">
          <label>Confirm with current password</label>
          <input type="password" bind:value={emailPwd} required autocomplete="current-password" />
        </div>
        <button type="submit" class="btn primary" disabled={!newEmail || !emailPwd}>Change email</button>
        {#if emailMsg}<p class="msg">{emailMsg}</p>{/if}
      </form>
    </section>

    <!-- Password -->
    <section class="card">
      <h4>Password</h4>
      <form onsubmit={changePassword}>
        <div class="setting-row">
          <label>Current password</label>
          <input type="password" bind:value={currentPwd} required autocomplete="current-password" />
        </div>
        <div class="setting-row">
          <label>New password</label>
          <input type="password" bind:value={newPwd} minlength="12" required autocomplete="new-password" />
        </div>
        <div class="setting-row">
          <label>Confirm new password</label>
          <input type="password" bind:value={newPwd2} minlength="12" required autocomplete="new-password" />
        </div>
        <button type="submit" class="btn primary" disabled={!currentPwd || !newPwd || !newPwd2}>Change password</button>
        {#if pwdMsg}<p class="msg">{pwdMsg}</p>{/if}
      </form>
    </section>

    <!-- Active sessions -->
    <section class="card">
      <h4>Active sessions</h4>
      <p class="hint">Devices currently signed in to your account.</p>
      <ul class="sessions">
        {#each sessions as s (s.id)}
          <li class="session" class:current={s.isCurrent}>
            <div class="session-info">
              <div class="session-ua">{s.userAgent || 'Unknown device'}</div>
              <div class="session-meta">
                {s.ip || 'unknown ip'} · last active {fmtTime(s.lastSeenAt)}
                {#if s.isCurrent}<span class="pill">This device</span>{/if}
              </div>
            </div>
            {#if !s.isCurrent}
              <button class="btn-link danger" onclick={() => revokeSession(s)}>Sign out</button>
            {/if}
          </li>
        {/each}
      </ul>
      {#if sessions.filter(s => !s.isCurrent).length}
        <button class="btn" onclick={revokeOthers}>Sign out all other sessions</button>
      {/if}
    </section>

    <!-- Data -->
    <section class="card">
      <h4>Your data</h4>
      <p class="hint">Download a JSON dump of everything we have on file.</p>
      <button class="btn" onclick={downloadExport}>Download data</button>
    </section>

    <!-- Danger zone -->
    <section class="card danger-zone">
      <h4>Danger zone</h4>
      {#if user.deletedAt}
        <p class="warn">Account scheduled for deletion. Sign in again on any device to recover, or contact support.</p>
      {:else}
        <p class="hint">Delete your account. Soft-delete keeps your data recoverable for 30 days.</p>
        <form onsubmit={deleteAccount}>
          <div class="setting-row">
            <label>Mode</label>
            <select bind:value={deleteMode}>
              <option value="soft">Soft-delete (30-day recovery)</option>
              <option value="immediate">Delete permanently (irreversible)</option>
            </select>
          </div>
          <div class="setting-row">
            <label>Confirm with current password</label>
            <input type="password" bind:value={deletePwd} required autocomplete="current-password" />
          </div>
          <button type="submit" class="btn danger" disabled={!deletePwd}>
            {deleteMode === 'immediate' ? 'Delete permanently' : 'Delete account'}
          </button>
          {#if deleteMsg}<p class="msg">{deleteMsg}</p>{/if}
        </form>
      {/if}
    </section>
  {/if}
</div>

<style>
  .profile-tab { display: flex; flex-direction: column; gap: 16px; }
  .muted { color: var(--text-tertiary); font-size: 13px; }
  .card {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 16px;
    background: var(--surface);
  }
  .card h4 {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
    margin: 0 0 12px;
  }
  .hint { font-size: 12px; color: var(--text-tertiary); margin: 0 0 10px; line-height: 1.5; }
  .hint.pending { color: var(--accent); }
  .msg { font-size: 12px; color: var(--text-secondary); margin: 8px 0 0; }
  .warn { font-size: 13px; color: var(--error); margin: 0; }

  .avatar-row { display: flex; gap: 14px; align-items: center; margin-bottom: 12px; }
  .avatar { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border); }
  .avatar-actions { display: flex; flex-direction: column; gap: 4px; }

  .setting-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .setting-row label { font-size: 12px; color: var(--text-secondary); }
  .setting-row input, .setting-row select {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 13px;
  }

  .btn {
    display: inline-block;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-primary);
    font-size: 12px;
    cursor: pointer;
    text-decoration: none;
  }
  .btn:hover { background: var(--surface-hover); border-color: var(--accent); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent); color: white; border-color: var(--accent); }
  .btn.primary:hover { background: var(--accent); filter: brightness(1.05); }
  .btn.danger { background: var(--error); color: white; border-color: var(--error); }
  .btn-link { background: none; border: none; color: var(--accent); cursor: pointer; font-size: 12px; padding: 0; text-decoration: underline; }
  .btn-link.danger { color: var(--error); }

  .sessions { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .session {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
  }
  .session.current { border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
  .session-ua { font-size: 12px; color: var(--text-primary); font-weight: 500; }
  .session-meta { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
  .pill {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--accent-light);
    color: var(--accent);
    font-size: 10px;
    font-weight: 600;
  }
  .danger-zone { border-color: color-mix(in srgb, var(--error) 30%, var(--border)); }
</style>
