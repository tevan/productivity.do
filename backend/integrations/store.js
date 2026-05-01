// Persistence helpers for the `integrations` table. Wraps token CRUD so
// adapters don't have to know about SQL. All adapters write through
// upsertIntegration() and read through getIntegration().
//
// Tokens are encrypted at rest when ENCRYPTION_KEY is set (AES-256-GCM via
// lib/cryptoBox.js). Without a key, fields are stored plaintext — same
// behaviour as before encryption was wired in. Migration is lazy: existing
// plaintext rows decrypt as themselves; the next write re-encrypts them.

import { getDb, q } from '../db/init.js';
import { encrypt, decrypt } from '../lib/cryptoBox.js';

const ENCRYPTED_FIELDS = ['access_token', 'refresh_token'];

function decryptRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const f of ENCRYPTED_FIELDS) {
    if (out[f] != null) {
      try { out[f] = decrypt(out[f]); }
      catch { out[f] = null; } // corrupt — surface as missing rather than crash
    }
  }
  return out;
}

export function getIntegration(userId, provider) {
  const row = q(
    'SELECT * FROM integrations WHERE user_id = ? AND provider = ?'
  ).get(userId, provider) || null;
  return decryptRow(row);
}

export function listUserIntegrations(userId) {
  return q(
    'SELECT id, provider, status, account_email, last_synced_at, last_error, created_at FROM integrations WHERE user_id = ? ORDER BY created_at'
  ).all(userId);
}

export function upsertIntegration(userId, provider, fields) {
  const existing = getIntegration(userId, provider);
  const now = new Date().toISOString();
  const merged = {
    status: 'connected',
    access_token: null,
    refresh_token: null,
    expires_at: null,
    account_email: null,
    metadata_json: null,
    last_synced_at: null,
    last_error: null,
    ...existing,
    ...fields,
  };
  const accessEnc = encrypt(merged.access_token);
  const refreshEnc = encrypt(merged.refresh_token);
  if (existing) {
    q(`
      UPDATE integrations SET
        status = ?, access_token = ?, refresh_token = ?, expires_at = ?,
        account_email = ?, metadata_json = ?, last_error = ?
      WHERE user_id = ? AND provider = ?
    `).run(
      merged.status, accessEnc, refreshEnc, merged.expires_at,
      merged.account_email,
      typeof merged.metadata_json === 'string'
        ? merged.metadata_json
        : (merged.metadata_json ? JSON.stringify(merged.metadata_json) : null),
      merged.last_error,
      userId, provider
    );
    return getIntegration(userId, provider);
  }
  q(`
    INSERT INTO integrations
      (user_id, provider, status, access_token, refresh_token, expires_at,
       account_email, metadata_json, last_error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, provider, merged.status, accessEnc, refreshEnc,
    merged.expires_at, merged.account_email,
    typeof merged.metadata_json === 'string'
      ? merged.metadata_json
      : (merged.metadata_json ? JSON.stringify(merged.metadata_json) : null),
    merged.last_error, now
  );
  return getIntegration(userId, provider);
}

export function deleteIntegration(userId, provider) {
  q('DELETE FROM integrations WHERE user_id = ? AND provider = ?').run(userId, provider);
}

export function markSynced(userId, provider, error = null) {
  q(`
    UPDATE integrations
    SET last_synced_at = datetime('now'), last_error = ?, status = ?
    WHERE user_id = ? AND provider = ?
  `).run(error, error ? 'error' : 'connected', userId, provider);
}

export function parseMetadata(row) {
  if (!row?.metadata_json) return {};
  try { return JSON.parse(row.metadata_json); } catch { return {}; }
}
