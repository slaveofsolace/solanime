import { AppError } from './errors.ts';

export const COMMUNITY_COMMENT_MAX_CHARACTERS = 1000;
export const COMMUNITY_COMMENT_MAX_BYTES = 8000;
export const COMMUNITY_PAGE_SIZE_MAX = 50;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function communityUuid(value: unknown, label = 'identifier'): string {
  if (typeof value !== 'string' || !uuid.test(value))
    throw new AppError(400, 'BAD_REQUEST', `Invalid community ${label}.`);
  return value.toLowerCase();
}

export function communityRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new AppError(400, 'BAD_REQUEST', 'A current positive comment revision is required.');
  return Number(value);
}

export function communityCommentBody(value: unknown): string {
  if (typeof value !== 'string')
    throw new AppError(400, 'BAD_REQUEST', 'Write a comment before posting.');
  const body = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (!body || [...body].length > COMMUNITY_COMMENT_MAX_CHARACTERS ||
    new TextEncoder().encode(body).byteLength > COMMUNITY_COMMENT_MAX_BYTES ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(body))
    throw new AppError(400, 'BAD_REQUEST', `Comments must be plain text between 1 and ${COMMUNITY_COMMENT_MAX_CHARACTERS} characters.`);
  return body;
}

export function communityPositiveInteger(value: string | null, fallback: number, maximum: number): number {
  if (value === null || value === '') return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum)
    throw new AppError(400, 'INVALID_QUERY', 'Choose a valid community page and page size.');
  return Number(value);
}

export function publicComment(row: {
  id: string;
  episode_id: number | string;
  author_name: string;
  author_avatar: string;
  body: string;
  revision: number;
  created_at: number;
  updated_at: number;
  viewer_owned?: number | boolean;
}) {
  return {
    id: row.id,
    episodeId: String(row.episode_id),
    author: { name: row.author_name, avatar: row.author_avatar },
    body: row.body,
    revision: Number(row.revision),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
    ownedByViewer: Boolean(row.viewer_owned),
  };
}
