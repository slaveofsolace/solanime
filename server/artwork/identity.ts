import { AppError } from '../errors.ts';
import { ArtworkSourceError, boundedArtworkBody } from './source.ts';

export interface ArtworkIdentityOwner {
  titleId: number;
  source: 'anikoto';
  sourceId: string;
  slug: string;
  name: string;
  aliases: string[];
  year: number | null;
  format: string | null;
  episodes: Array<{ sourceId: string; number: number | null }>;
}
export interface SourceIdentityProof {
  kind: 'source-id-verified';
  source: 'movy-anime';
  sourceUrl: string;
  sourceTitleId: string;
  sourceSlug: string;
  malId: number;
  observedAt: string;
  responseSha256: string;
  returnedEpisodes: number;
  matchedEpisodes: number;
  catalogueEpisodes: number;
  anchors: Array<{ sourceId: string; number: number | null }>;
}
export type IdentityObservation =
  | { status: 'verified'; malId: number; proof: SourceIdentityProof }
  | { status: 'unresolved'; code: 'MISSING_SOURCE_IDENTIFIER' | 'NO_IMPORTED_EPISODE_ANCHOR' | 'INCOMPLETE_EPISODE_RESPONSE' | 'MISSING_MAL_IDENTIFIER' | 'AMBIGUOUS_MAL_IDENTIFIER' | 'SOURCE_IDENTITY_CONFLICT' };

export function identityEndpoint(slug: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 200) throw new ArtworkSourceError('INVALID_DESTINATION', 'Use an existing canonical anime slug.');
  return `https://anime.vidy.st/api/episodes/${slug}`;
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ArtworkSourceError('INVALID_RESPONSE', 'The observed anime identity response changed.');
  return value as Record<string, unknown>;
};
const positiveId = (value: unknown): string | null => {
  const text = String(value ?? '');
  return /^[1-9][0-9]{0,14}$/.test(text) && Number.isSafeInteger(Number(text)) ? text : null;
};
const episodeNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) throw new ArtworkSourceError('INVALID_RESPONSE', 'The observed episode number is malformed.');
  return number;
};

/** Accepts no title-search inference: source title ID, slug and actual imported episode IDs must agree. */
export function inspectSourceIdentity(value: unknown, owner: ArtworkIdentityOwner, observation: { observedAt: string; responseSha256: string }): IdentityObservation {
  if (owner.source !== 'anikoto' || !positiveId(owner.sourceId)) return { status: 'unresolved', code: 'MISSING_SOURCE_IDENTIFIER' };
  if (!owner.episodes.length) return { status: 'unresolved', code: 'NO_IMPORTED_EPISODE_ANCHOR' };
  if (!Number.isFinite(Date.parse(observation.observedAt)) || !/^[a-f0-9]{64}$/.test(observation.responseSha256)) throw new ArtworkSourceError('INVALID_RESPONSE', 'The identity observation requires a timestamp and response digest.');
  const body = object(value); const result = object(body.results);
  if (body.success !== true || positiveId(result.animeId) !== owner.sourceId || result.slug !== owner.slug) return { status: 'unresolved', code: 'SOURCE_IDENTITY_CONFLICT' };
  if (!Number.isSafeInteger(result.totalEpisodes) || Number(result.totalEpisodes) < 0 || Number(result.totalEpisodes) > 50_000 || !Array.isArray(result.episodes)) throw new ArtworkSourceError('INVALID_RESPONSE', 'The observed episode inventory is malformed.');
  if (!result.episodes.length || result.episodes.length !== result.totalEpisodes) return { status: 'unresolved', code: 'INCOMPLETE_EPISODE_RESPONSE' };
  const catalogue = new Map(owner.episodes.map(episode => [episode.sourceId, episode.number]));
  if (catalogue.size !== owner.episodes.length) return { status: 'unresolved', code: 'SOURCE_IDENTITY_CONFLICT' };
  const seen = new Set<string>(); const malIds = new Set<string>(); const matched: SourceIdentityProof['anchors'] = [];
  let missingMal = false;
  for (const entry of result.episodes) {
    const episode = object(entry); const id = positiveId(episode.id); const malId = positiveId(episode.mal_id);
    if (!id || seen.has(id)) throw new ArtworkSourceError('INVALID_RESPONSE', 'The observed episode identifiers are missing or duplicated.');
    seen.add(id); if (malId) malIds.add(malId); else missingMal = true;
    const number = episodeNumber(episode.episode_no);
    if (catalogue.has(id)) {
      const expectedNumber = catalogue.get(id)!;
      if (expectedNumber !== null && number !== expectedNumber) return { status: 'unresolved', code: 'SOURCE_IDENTITY_CONFLICT' };
      matched.push({ sourceId: id, number });
    }
  }
  if (malIds.size > 1) return { status: 'unresolved', code: 'AMBIGUOUS_MAL_IDENTIFIER' };
  if (!malIds.size || missingMal) return { status: 'unresolved', code: 'MISSING_MAL_IDENTIFIER' };
  // A response must include every currently imported source episode; stale/partial rows need review, never a guessed season offset.
  if (matched.length !== catalogue.size) return { status: 'unresolved', code: 'SOURCE_IDENTITY_CONFLICT' };
  const indexes = [...new Set([0, Math.floor((matched.length - 1) / 2), matched.length - 1])];
  const malId = Number([...malIds][0]);
  return { status: 'verified', malId, proof: { kind: 'source-id-verified', source: 'movy-anime', sourceUrl: identityEndpoint(owner.slug), sourceTitleId: owner.sourceId, sourceSlug: owner.slug, malId, ...observation, returnedEpisodes: result.episodes.length, matchedEpisodes: matched.length, catalogueEpisodes: catalogue.size, anchors: indexes.map(index => matched[index]) } };
}

export function validateSourceIdentityProof(value: unknown, sourceId: string, sourceUrl: string, malId: number | null): SourceIdentityProof {
  const input = object(value); const slug = new URL(sourceUrl).pathname.split('/').at(-1)!;
  if (input.kind !== 'source-id-verified' || input.source !== 'movy-anime' || input.sourceUrl !== identityEndpoint(slug) || input.sourceTitleId !== sourceId || input.sourceSlug !== slug || input.malId !== malId || !positiveId(malId) || typeof input.observedAt !== 'string' || !Number.isFinite(Date.parse(input.observedAt)) || typeof input.responseSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.responseSha256)) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'The artwork identity proof does not match its source title and MAL identifier.');
  for (const key of ['returnedEpisodes','matchedEpisodes','catalogueEpisodes']) if (!Number.isSafeInteger(input[key]) || Number(input[key]) < 1 || Number(input[key]) > 50_000) throw new AppError(400, 'BAD_REQUEST', 'The artwork identity proof has invalid episode counts.');
  if (input.matchedEpisodes !== input.catalogueEpisodes || Number(input.returnedEpisodes) < Number(input.matchedEpisodes) || !Array.isArray(input.anchors) || input.anchors.length < 1 || input.anchors.length > 3) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'The artwork identity proof must retain matching source episode anchors.');
  const anchors = input.anchors.map(value => { const anchor = object(value); const sourceId = positiveId(anchor.sourceId); if (!sourceId) throw new AppError(400, 'BAD_REQUEST', 'An artwork episode anchor is invalid.'); return { sourceId, number: episodeNumber(anchor.number) }; });
  if (new Set(anchors.map(anchor => anchor.sourceId)).size !== anchors.length) throw new AppError(400, 'BAD_REQUEST', 'Artwork identity anchors must be unique.');
  return { kind: 'source-id-verified', source: 'movy-anime', sourceUrl: String(input.sourceUrl), sourceTitleId: sourceId, sourceSlug: slug, malId: Number(malId), observedAt: input.observedAt, responseSha256: input.responseSha256, returnedEpisodes: Number(input.returnedEpisodes), matchedEpisodes: Number(input.matchedEpisodes), catalogueEpisodes: Number(input.catalogueEpisodes), anchors };
}

/** Only the already observed ordinary metadata endpoint. Opaque server payloads are discarded, never persisted. */
export async function fetchSourceIdentity(owner: ArtworkIdentityOwner, send: typeof fetch = fetch, now: () => Date = () => new Date()): Promise<IdentityObservation> {
  if (!owner.episodes.length) return { status: 'unresolved', code: 'NO_IMPORTED_EPISODE_ANCHOR' };
  if (!positiveId(owner.sourceId)) return { status: 'unresolved', code: 'MISSING_SOURCE_IDENTIFIER' };
  const response = await send(identityEndpoint(owner.slug), { headers: { accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  if (response.status !== 200) {
    await response.body?.cancel();
    if ([401,403].includes(response.status)) throw new ArtworkSourceError('BLOCKED', 'The identity source refused this normal request. No retry or context masking.', response.status);
    const retry = response.headers.get('retry-after'); const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry) - now().getTime()) / 1000) : 60;
    if (response.status === 429) throw new ArtworkSourceError('RATE_LIMITED', 'The identity source requested a pause.', response.status, Number.isFinite(seconds) ? Math.max(1,Math.min(seconds,86_400)) : 60);
    if (response.status >= 300 && response.status < 400) throw new ArtworkSourceError('INVALID_DESTINATION', 'The identity endpoint redirected; a new destination needs separate review.', response.status);
    throw new ArtworkSourceError('UNAVAILABLE', 'The identity metadata is unavailable.', response.status);
  }
  if (!response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw new ArtworkSourceError('INVALID_RESPONSE', 'The identity metadata endpoint did not return JSON.'); }
  const bytes = await boundedArtworkBody(response, 4_000_000);
  let value: unknown; try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ArtworkSourceError('INVALID_RESPONSE', 'The identity metadata response is not valid JSON.'); }
  const digestBytes = new Uint8Array(bytes.length); digestBytes.set(bytes);
  const responseSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', digestBytes.buffer))].map(byte => byte.toString(16).padStart(2,'0')).join('');
  return inspectSourceIdentity(value, owner, { observedAt: now().toISOString(), responseSha256 });
}
