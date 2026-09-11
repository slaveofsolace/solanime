import { request } from '../lib/api';
let csrf: string | null = null;
export function setAccountCsrf(value: string | null) {
  csrf = value;
}
export async function accountRequest<T>(path: string, body?: unknown, signal?: AbortSignal) {
  const result = await request<T>(
    '/api/account/' + path,
    body === undefined
      ? { signal }
      : {
          method: 'POST',
          signal,
          headers: { 'x-solanime-intent': 'account', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
          body: JSON.stringify(body),
        },
  );
  const data = result as Record<string, unknown>;
  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const invalid = () => {
    throw new Error(
      'The account response is incomplete. Reload the page and check the API version.',
    );
  };
  if (!object(data)) invalid();
  if (Object.hasOwn(data, 'account')) {
    if (
      data.account !== null &&
      (!object(data.account) ||
        typeof data.account.id !== 'string' ||
        typeof data.account.email !== 'string')
    )
      invalid();
    if (
      !Array.isArray(data.profiles) ||
      data.profiles.length > 5 ||
      !data.profiles.every(
        (p: unknown) =>
          object(p) &&
          typeof p.id === 'string' &&
          typeof p.name === 'string' &&
          ['ruby', 'ocean', 'violet', 'emerald', 'amber'].includes(String(p.avatar)),
      )
    )
      invalid();
    if (
      data.account !== null &&
      (typeof data.csrfToken !== 'string' || !/^[\w-]{43}$/.test(data.csrfToken))
    )
      invalid();
  }
  if (path.endsWith('/data') && body === undefined) {
    if (
      !object(data.values) ||
      !object(data.revisions) ||
      !Object.values(data.revisions).every((v) => Number.isSafeInteger(v) && Number(v) >= 1)
    )
      invalid();
  }
  if (
    path.endsWith('/data') &&
    body !== undefined &&
    (!Number.isSafeInteger(data.revision) || Number(data.revision) < 1)
  )
    invalid();
  return result;
}
