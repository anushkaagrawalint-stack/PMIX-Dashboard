import crypto from 'crypto';

// Reversible AES-256-GCM encryption for the Admin Panel's "view current password"
// feature (owner request 2026-07-08). Separate from the bcrypt hash used for actual
// login verification — bcrypt.compare still guards sign-in; this is purely so
// admin/tester can look up what a user's current password is.
function getKey(): Buffer {
  const hex = process.env.USER_PW_ENC_KEY;
  if (!hex) throw new Error('USER_PW_ENC_KEY is not configured');
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('USER_PW_ENC_KEY must be a 64-char hex string (32 bytes)');
  return key;
}

// Stored as base64(iv[12] || authTag[16] || ciphertext) — one column, no delimiter needed.
export function encryptPassword(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptPassword(enc: string): string {
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
