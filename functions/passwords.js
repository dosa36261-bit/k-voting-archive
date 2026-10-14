import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function validPassword(value) { return typeof value === 'string' && value.length >= 4 && value.length <= 128; }
export async function hashPassword(value) {
  const salt = randomBytes(16).toString('hex');
  return { scheme: 'scrypt', salt, hash: (await scrypt(value, salt, 64)).toString('hex') };
}
export async function verifyPassword(value, record) {
  // Verification preserves existing administrator passwords; minimum length
  // applies when creating a new post/comment password, not to legacy logins.
  if (typeof value !== 'string' || !value.length || value.length > 1024 || !record) return false;
  const candidate = record.scheme === 'scrypt'
    ? (await scrypt(value, record.salt, 64)).toString('hex')
    : record.scheme === 'sha256' ? sha256(value) : '';
  const expected = String(record.hash || '');
  return !!candidate && candidate.length === expected.length
    && timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}
