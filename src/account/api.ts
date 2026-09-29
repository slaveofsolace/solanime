import { ApiError, request } from '../lib/api';
import type { CommunityComment, CommunityCommentsPage } from '../types';
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
  ).catch(error => {
    if (error instanceof ApiError && error.problem.status === 401 &&
      !['login', 'register', 'recover'].includes(path) &&
      (error.problem.details as { reason?: string } | undefined)?.reason !== 'PASSWORD_PROOF_FAILED') {
      window.dispatchEvent(new Event('solanime:session-expired'));
    }
    throw error;
  });
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

const communityHeaders = () => ({
  'x-solanime-intent': 'account',
  ...(csrf ? { 'x-csrf-token': csrf } : {}),
});

function validCommunityComment(value: unknown): value is CommunityComment {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CommunityComment>;
  return typeof item.id === 'string' && typeof item.episodeId === 'string' &&
    !!item.author && typeof item.author.name === 'string' &&
    ['ruby', 'ocean', 'violet', 'emerald', 'amber'].includes(String(item.author.avatar)) &&
    typeof item.body === 'string' && Number.isSafeInteger(item.revision) &&
    typeof item.createdAt === 'string' && typeof item.updatedAt === 'string' &&
    typeof item.ownedByViewer === 'boolean';
}

export async function episodeComments(
  episodeId: string,
  options: { profileId?: string; page?: number; pageSize?: number } = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (options.profileId) params.set('profile', options.profileId);
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  const result = await request<CommunityCommentsPage>(
    `/api/episodes/${encodeURIComponent(episodeId)}/comments${params.size ? `?${params}` : ''}`,
    { signal },
  );
  if (!Array.isArray(result.items) || !result.items.every(validCommunityComment) ||
    !Number.isSafeInteger(result.total) || !Number.isSafeInteger(result.page) ||
    !Number.isSafeInteger(result.pageSize) || !Number.isSafeInteger(result.pages))
    throw new Error('The episode community response is incomplete. Reload and check the API version.');
  return result;
}

async function commentMutation(
  episodeId: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  commentId: string | undefined,
  value: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const result = await request<{ comment?: CommunityComment; deleted?: boolean; id?: string }>(
    `/api/episodes/${encodeURIComponent(episodeId)}/comments${commentId ? `/${encodeURIComponent(commentId)}` : ''}`,
    { method, headers: communityHeaders(), body: JSON.stringify(value), signal },
  );
  if (method === 'DELETE') {
    if (result.deleted !== true || result.id !== commentId)
      throw new Error('The comment deletion response is incomplete. Reload and check the API version.');
  } else if (!validCommunityComment(result.comment)) {
    throw new Error('The comment response is incomplete. Reload and check the API version.');
  }
  return result;
}

export function createEpisodeComment(episodeId: string, profileId: string, body: string, signal?: AbortSignal) {
  return commentMutation(episodeId, 'POST', undefined, { profileId, body }, signal);
}

export function updateEpisodeComment(episodeId: string, commentId: string, profileId: string, body: string, revision: number, signal?: AbortSignal) {
  return commentMutation(episodeId, 'PATCH', commentId, { profileId, body, revision }, signal);
}

export function deleteEpisodeComment(episodeId: string, commentId: string, profileId: string, revision: number, signal?: AbortSignal) {
  return commentMutation(episodeId, 'DELETE', commentId, { profileId, revision }, signal);
}
