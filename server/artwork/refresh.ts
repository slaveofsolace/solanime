import { AppError } from '../errors.ts';
import { assertMediaMatches, resourceMutation, type ArtworkMatch, type SqlMutation } from './model.ts';
import { ArtworkSourceError, fetchAniListMedia, fetchArtworkResource, parseAniListMedia, usefulArtwork, type AniListArtworkMedia } from './source.ts';

export interface ArtworkCheckpoint { phase: 'metadata' | 'poster' | 'backdrop' | 'done'; media?: AniListArtworkMedia; outcomes?: Partial<Record<'poster' | 'backdrop', 'verified' | 'IMAGE_ABSENT' | 'BELOW_SIZE_THRESHOLD'>>; }
export interface ArtworkStep { statements: SqlMutation[]; checkpoint: ArtworkCheckpoint; complete: boolean; requests: number; }
export function parseArtworkCheckpoint(value: unknown, match: ArtworkMatch): ArtworkCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(422, 'UPSTREAM_CHANGED', 'The persisted artwork checkpoint is malformed.');
  const input = value as Record<string, unknown>; const phase = input.phase ?? 'metadata';
  if (!['metadata','poster','backdrop','done'].includes(String(phase))) throw new AppError(422, 'UPSTREAM_CHANGED', 'The artwork checkpoint phase is unrecognized.');
  if (phase === 'metadata') return { phase: 'metadata' };
  if (!input.media || typeof input.media !== 'object' || Array.isArray(input.media)) throw new AppError(422, 'UPSTREAM_CHANGED', 'The persisted artwork metadata is missing.');
  const saved = input.media as Record<string, unknown>;
  const media = parseAniListMedia({ id: saved.id, idMal: saved.idMal, type: 'ANIME', format: saved.format, startDate: { year: saved.year }, title: saved.title, siteUrl: saved.siteUrl, coverImage: { extraLarge: saved.posterUrl }, bannerImage: saved.backdropUrl }, match.mediaId);
  assertMediaMatches(match, media);
  const outcomes: ArtworkCheckpoint['outcomes'] = {};
  if (input.outcomes !== undefined) {
    if (!input.outcomes || typeof input.outcomes !== 'object' || Array.isArray(input.outcomes)) throw new AppError(422, 'UPSTREAM_CHANGED', 'The artwork role outcomes are malformed.');
    for (const [role, outcome] of Object.entries(input.outcomes)) {
      if ((role !== 'poster' && role !== 'backdrop') || !['verified','IMAGE_ABSENT','BELOW_SIZE_THRESHOLD'].includes(outcome)) throw new AppError(422, 'UPSTREAM_CHANGED', 'An artwork role outcome is unrecognized.');
      outcomes[role] = outcome;
    }
  }
  return { phase: phase as 'poster' | 'backdrop' | 'done', media, ...(Object.keys(outcomes).length ? { outcomes } : {}) };
}
export function artworkFailureMutation(matchId: string, code: string, role?: 'poster' | 'backdrop'): SqlMutation {
  return { sql: `UPDATE title_artwork SET last_checked_at=?,last_error_code=? WHERE match_id=?${role ? ' AND role=?' : ''}`, values: [new Date().toISOString(), code.slice(0, 60), matchId, ...(role ? [role] : [])] };
}

/** One metadata or image request per durable phase. No bulk search, hidden URL expansion, or image proxy. */
export async function advanceArtwork(match: ArtworkMatch, saved: unknown, send: typeof fetch = fetch): Promise<ArtworkStep> {
  if (match.reviewStatus !== 'approved') throw new ArtworkSourceError('BLOCKED', 'This artwork identity is disabled; no source request was made.');
  const checkpoint = parseArtworkCheckpoint(saved, match);
  if (checkpoint.phase === 'done') return { statements: [], checkpoint, complete: true, requests: 0 };
  if (checkpoint.phase === 'metadata') {
    const media = await fetchAniListMedia(match.mediaId, send); assertMediaMatches(match, media);
    return { statements: [], checkpoint: { phase: 'poster', media }, complete: false, requests: 1 };
  }
  const media = checkpoint.media!; const role = checkpoint.phase;
  const url = role === 'poster' ? media.posterUrl : media.backdropUrl;
  const next: ArtworkCheckpoint = { phase: role === 'poster' ? 'backdrop' : 'done', media, outcomes: { ...checkpoint.outcomes } };
  if (!url) { next.outcomes![role] = 'IMAGE_ABSENT'; return { statements: [artworkFailureMutation(match.id, 'IMAGE_ABSENT', role)], checkpoint: next, complete: next.phase === 'done', requests: 0 }; }
  const resource = await fetchArtworkResource(url, match.mediaId, role, send);
  next.outcomes![role] = usefulArtwork(resource, role) ? 'verified' : 'BELOW_SIZE_THRESHOLD';
  return { statements: usefulArtwork(resource, role) ? [resourceMutation(match, role, resource)] : [artworkFailureMutation(match.id, 'BELOW_SIZE_THRESHOLD', role)], checkpoint: next, complete: next.phase === 'done', requests: 1 };
}

export interface ArtworkPolicyPort {
  claim(hostname: string, now: string, next: string): Promise<boolean>;
  state(hostname: string): Promise<{ next_request_at: string; blocked_status: number | null } | null>;
  hold(hostname: string, until: string, blockedStatus: number | null): Promise<void>;
}
export const claimArtworkHostSql = `INSERT INTO artwork_source_policy(hostname,next_request_at,blocked_status,updated_at) VALUES(?,?,NULL,?)
  ON CONFLICT(hostname) DO UPDATE SET next_request_at=excluded.next_request_at,updated_at=excluded.updated_at
  WHERE artwork_source_policy.blocked_status IS NULL AND artwork_source_policy.next_request_at<=excluded.updated_at RETURNING hostname`;

/** Durable per-host pacing and explicit refusal retention, shared by local and cloud consumers. */
export function policyArtworkFetch(port: ArtworkPolicyPort, send: typeof fetch = fetch, now: () => Date = () => new Date(), mode: 'artwork' | 'identity-discovery' = 'artwork'): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const allowed = mode === 'identity-discovery' ? ['anime.vidy.st'] : ['graphql.anilist.co','s4.anilist.co'];
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || !allowed.includes(url.hostname) || (mode === 'identity-discovery' && !/^\/api\/episodes\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.pathname))) throw new ArtworkSourceError('INVALID_DESTINATION', 'This artwork transport only supports its reviewed metadata and image hosts.');
    const time = now(); const claimed = await port.claim(url.hostname, time.toISOString(), new Date(time.getTime() + 2200).toISOString());
    if (!claimed) {
      const state = await port.state(url.hostname);
      if (state?.blocked_status) throw new ArtworkSourceError('BLOCKED', 'The source has an explicit recorded refusal; operator review is required.', state.blocked_status);
      const seconds = Math.max(1, Math.ceil((Date.parse(state?.next_request_at ?? '') - time.getTime()) / 1000));
      throw new ArtworkSourceError('RATE_LIMITED', 'The durable source request interval has not elapsed.', undefined, Number.isFinite(seconds) ? seconds : 3);
    }
    const response = await send(input, init);
    if ([401,403,429].includes(response.status)) {
      const header = response.headers.get('retry-after');
      const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? Math.ceil((Date.parse(header) - time.getTime()) / 1000) : 60;
      const wait = Number.isFinite(seconds) ? Math.max(1, Math.min(seconds, 86_400)) : 60;
      await port.hold(url.hostname, new Date(time.getTime() + wait * 1000).toISOString(), response.status === 429 ? null : response.status);
    }
    return response;
  };
}
