// Symmetric encryption for tokens stored at rest.
//
// Cipher: AES-256-GCM. Key: ENCRYPTION_KEY env (32 bytes, hex-encoded).
// Output format: `enc:v1:<iv_hex>:<tag_hex>:<ct_hex>`. Plaintext rows that
// pre-date encryption stay readable — decrypt() returns them as-is when
// the prefix is missing.
//
// Why prefix-tagged: lets us migrate live data lazily. New writes go
// through encrypt(); old reads pass through. A future migration script
// can re-encrypt rows in place.

import crypto from 'node:crypto';

const PREFIX = 'enc:v1:';

let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    console.warn('[cryptoBox] ENCRYPTION_KEY must be 64 hex chars (32 bytes); ignoring');
    return null;
  }
  cachedKey = Buffer.from(hex, 'hex');
  return cachedKey;
}

export function isEncryptionConfigured() {
  return !!getKey();
}

export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return plaintext;
  const key = getKey();
  if (!key) return plaintext; // no key configured — store plaintext
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decrypt(value) {
  if (value == null) return value;
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  const key = getKey();
  if (!key) {
    // We have ciphertext but no key — refuse to silently return garbage.
    throw new Error('encrypted token but ENCRYPTION_KEY is not set');
  }
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('malformed ciphertext');
  const [ivHex, tagHex, ctHex] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm', key, Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctHex, 'hex')),
    decipher.final(),
  ]);
  return pt.toString('utf8');
}

// Generate a fresh key. Run once: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
// or via the helper script in scripts/.
