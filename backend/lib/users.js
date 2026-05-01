/**
 * User account helpers — signup, lookup, password operations.
 */

import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { getDb } from '../db/init.js';

const BCRYPT_ROUNDS = 10;

export async function createUser({ email, password, plan = 'free' }) {
  if (!email || !password) throw new Error('email and password required');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const normalized = String(email).trim().toLowerCase();
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(normalized)) throw new Error('Invalid email');

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
  if (existing) throw new Error('An account with that email already exists');

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const verifyToken = randomBytes(32).toString('hex');
  const result = db.prepare(`
    INSERT INTO users (email, password_hash, plan, email_verify_token)
    VALUES (?, ?, ?, ?)
  `).run(normalized, hash, plan, verifyToken);

  return {
    id: result.lastInsertRowid,
    email: normalized,
    plan,
    emailVerifyToken: verifyToken,
  };
}

export async function authenticate({ email, password }) {
  const db = getDb();
  const normalized = String(email || '').trim().toLowerCase();
  const row = db.prepare('SELECT id, email, password_hash, plan FROM users WHERE email = ?').get(normalized);
  if (!row) return null;
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return null;
  db.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?').run(row.id);
  return { id: row.id, email: row.email, plan: row.plan };
}

export function getUserById(id) {
  const db = getDb();
  return db.prepare(`
    SELECT id, email, plan, stripe_customer_id, stripe_subscription_id,
           current_period_end, email_verified, team_id, is_team_admin,
           created_at, display_name, timezone
    FROM users WHERE id = ?
  `).get(id) || null;
}

export function getUserByEmail(email) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase()) || null;
}

export function verifyEmail(token) {
  const db = getDb();
  const row = db.prepare('SELECT id FROM users WHERE email_verify_token = ?').get(token);
  if (!row) return null;
  db.prepare(`
    UPDATE users SET email_verified = 1, email_verify_token = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(row.id);
  return row.id;
}

export async function changePassword(userId, newPassword) {
  if (!newPassword || newPassword.length < 8) throw new Error('Password must be at least 8 characters');
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const db = getDb();
  db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(hash, userId);
}

export function setStripeIds(userId, { customerId, subscriptionId, plan, periodEnd }) {
  const db = getDb();
  db.prepare(`
    UPDATE users SET
      stripe_customer_id = COALESCE(?, stripe_customer_id),
      stripe_subscription_id = COALESCE(?, stripe_subscription_id),
      plan = COALESCE(?, plan),
      current_period_end = COALESCE(?, current_period_end),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(customerId, subscriptionId, plan, periodEnd, userId);
}
