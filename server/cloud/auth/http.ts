import { AppError, asAppError } from '../../errors.ts';
import { object } from '../../accounts/validation.ts';
import { equalToken } from './crypto.ts';

export function accountReply(status: number, body: unknown, extra: HeadersInit = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
  new Headers(extra).forEach((value, name) => headers.set(name, value));
  return new Response(JSON.stringify(body), { status, headers });
}
export function accountError(error: unknown) {
  const e = asAppError(error);
  const retry = e.details?.retryAfterSeconds;
  return accountReply(e.status, { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } },
    typeof retry === 'number' ? { 'Retry-After': String(Math.ceil(retry)) } : {});
}
export async function boundedJson(input: Request | Response, maxBytes = 256 * 1024, timeoutMs = 10000) {
  if (Number(input.headers.get('content-length')) > maxBytes)
    throw new AppError(413, 'BAD_REQUEST', 'Request body is too large.');
  if (!input.body) throw new AppError(400, 'BAD_REQUEST', 'Request body must be a JSON object.');
  const reader = input.body.getReader();
  let size = 0, timedOut = false;
  const chunks: Uint8Array[] = [];
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, timeoutMs);
  try {
    for (;;) {
      const part = await reader.read();
      if (timedOut) throw new AppError(408, 'UNAVAILABLE', 'Request body timed out.');
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError(413, 'BAD_REQUEST', 'Request body is too large.');
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new AppError(400, 'BAD_REQUEST', 'Request body must be valid JSON.'); }
    if (!object(value)) throw new AppError(400, 'BAD_REQUEST', 'Request body must be a JSON object.');
    return value;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
export function cookieValue(request: Request, name: string) {
  const values = (request.headers.get('cookie') ?? '').split(';').map((x) => x.trim())
    .filter((x) => x.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : '';
}
export async function requireMutation(request: Request, origins: string[], csrf?: string) {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!origin || !origins.includes(origin) || request.headers.get('x-solanime-intent') !== 'account' ||
    (fetchSite && fetchSite !== 'same-origin'))
    throw new AppError(403, 'UNAUTHORIZED', 'Cross-origin account changes are blocked.');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? ''))
    throw new AppError(415, 'BAD_REQUEST', 'Account changes require JSON.');
  if (csrf && !(await equalToken(request.headers.get('x-csrf-token'), csrf)))
    throw new AppError(403, 'UNAUTHORIZED', 'Your session changed. Reload before trying again.');
}
/** Same local password policy, without importing the memory-hard local hashing implementation. */
export function validateManagedPassword(value: unknown): string {
  if (typeof value !== 'string' || [...value].length < 15 || [...value].length > 128 || new TextEncoder().encode(value).length > 1024)
    throw new AppError(400, 'BAD_REQUEST', 'Use a password of 15–128 characters. Spaces and passphrases are welcome.');
  if (['passwordpassword', '123456789012345', 'qwertyuiopasdfgh', 'letmeinletmeinletmein'].includes(value.toLowerCase()))
    throw new AppError(400, 'BAD_REQUEST', 'Choose a less predictable password.');
  return value;
}
