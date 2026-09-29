import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { AppError } from '../errors.ts';
const N = 131072,
  R = 8,
  P = 1;
let inFlight = 0;
/** Bound memory use; reject excess work rather than queuing unbounded password hashes. */
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (inFlight >= 2) throw new AppError(503, 'UNAVAILABLE', 'Sign-in is busy. Try again shortly.');
  inFlight++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(password, salt, 64, { N, r: R, p: P, maxmem: 160 * 1024 * 1024 }, (error, result) =>
        error ? reject(error) : resolve(result),
      ),
    );
  } finally {
    inFlight--;
  }
}
export function validatePassword(value: unknown): string {
  if (
    typeof value !== 'string' ||
    [...value].length < 15 ||
    [...value].length > 128 ||
    Buffer.byteLength(value) > 1024
  )
    throw new AppError(
      400,
      'BAD_REQUEST',
      'Use a password of 15–128 characters. Spaces and passphrases are welcome.',
    );
  if (
    ['passwordpassword', '123456789012345', 'qwertyuiopasdfgh', 'letmeinletmeinletmein'].includes(
      value.toLowerCase(),
    )
  )
    throw new AppError(400, 'BAD_REQUEST', 'Choose a less predictable password.');
  return value;
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(password, salt);
  return ['scrypt', '1', N, R, P, salt.toString('hex'), derived.toString('hex')].join('$');
}
export async function verifyPassword(password: unknown, stored?: string): Promise<boolean> {
  const parts = stored?.split('$');
  const valid =
    parts?.length === 7 &&
    parts[0] === 'scrypt' &&
    parts[1] === '1' &&
    parts[2] === String(N) &&
    parts[3] === String(R) &&
    parts[4] === String(P) &&
    /^[a-f0-9]{32}$/.test(parts[5]) &&
    /^[a-f0-9]{128}$/.test(parts[6]);
  // Unknown users still pay the same password-hashing cost.
  const supplied =
    typeof password === 'string' && Buffer.byteLength(password) <= 1024 ? password : '';
  const computed = await derive(
    supplied,
    valid ? Buffer.from(parts![5], 'hex') : Buffer.alloc(16, 73),
  );
  const expected = valid ? Buffer.from(parts![6], 'hex') : Buffer.alloc(64);
  return timingSafeEqual(computed, expected) && !!valid;
}
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function equalToken(a: unknown, b: string): boolean {
  return (
    typeof a === 'string' &&
    a.length <= 256 &&
    timingSafeEqual(Buffer.from(digest(a), 'hex'), Buffer.from(digest(b), 'hex'))
  );
}
