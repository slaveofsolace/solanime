import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../../errors.ts';
import { object } from '../../accounts/validation.ts';
import type { IdentityCredentials } from './types.ts';

const encoder = new TextEncoder();
export const encodeBytes = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export function decodeBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[\w-]+$/.test(value)) throw new Error('Invalid base64url value.');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (x) => x.charCodeAt(0));
}
export const randomToken = () => encodeBytes(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))),
    (x) => x.toString(16).padStart(2, '0')).join('');
}
export async function equalToken(supplied: unknown, expected: string) {
  const valid = typeof supplied === 'string' && supplied.length <= 256;
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(valid ? supplied : '')),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b)) && valid;
}
export function validCredentialKey(value: string | undefined): value is string {
  try { return !!value && /^[\w-]{43}$/.test(value) && decodeBytes(value).length === 32; }
  catch { return false; }
}
async function key(value: string) {
  if (!validCredentialKey(value))
    throw new AppError(503, 'UNAVAILABLE', 'Account encryption is not configured.', { reason: 'AUTH_NOT_CONFIGURED' });
  return crypto.subtle.importKey('raw', decodeBytes(value), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealCredentials(value: IdentityCredentials, secret: string, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode('solanime-session:v1:' + context) },
    await key(secret), encoder.encode(JSON.stringify(value)),
  );
  return `v1.${encodeBytes(iv)}.${encodeBytes(new Uint8Array(ciphertext))}`;
}
export async function openCredentials(cipher: string, secret: string, context: string): Promise<IdentityCredentials> {
  try {
    if (cipher.length > 24000) throw new Error();
    const parts = cipher.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') throw new Error();
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decodeBytes(parts[1]), additionalData: encoder.encode('solanime-session:v1:' + context) },
      await key(secret), decodeBytes(parts[2]),
    );
    const value: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    if (!object(value) || typeof value.uid !== 'string' || !value.uid || value.uid.length > 128 ||
      typeof value.idToken !== 'string' || value.idToken.length > 12000 ||
      typeof value.refreshToken !== 'string' || value.refreshToken.length > 4096 ||
      !Number.isSafeInteger(value.expiresAt) || !Number.isSafeInteger(value.authenticatedAt)) throw new Error();
    return { uid: value.uid, idToken: value.idToken, refreshToken: value.refreshToken,
      expiresAt: Number(value.expiresAt), authenticatedAt: Number(value.authenticatedAt) };
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'This session can no longer be restored. Sign in again.', { reason: 'SESSION_CREDENTIAL_INVALID' });
  }
}
