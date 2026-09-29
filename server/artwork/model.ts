import { AppError } from '../errors.ts';
import type { ArtworkRole, ArtworkReuseStatus } from '../../shared/artwork.ts';
import { validateArtworkUrl, type AniListArtworkMedia, type ArtworkResource } from './source.ts';
import { validateSourceIdentityProof, type SourceIdentityProof, type ArtworkIdentityOwner } from './identity.ts';

export interface ArtworkReview {
  titleId: number;
  titleSource: 'anikoto';
  titleSourceId: string;
  mediaId: number;
  malId: number | null;
  releaseYear: number;
  format: string;
  reviewedAt: string;
  evidence: {
    sourceUrl: string;
    metadataUrl: string;
    sourceName: string;
    metadataName: string;
    sourceAlias: string;
    metadataAlias: string;
    sourcePosterSha256?: string;
    metadataPosterSha256?: string;
    posterComparison?: 'same-key-art-manually-reviewed';
    premiereDate?: string;
    identityProof?: SourceIdentityProof;
    notes: string;
  };
}
export interface ArtworkMatch extends ArtworkReview { id: string; reviewStatus: 'approved' | 'disabled'; }
export interface SqlMutation { sql: string; values: Array<string | number | null>; }
const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '').trim();
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(400, 'BAD_REQUEST', 'Artwork review must be a structured object.');
  return value as Record<string, unknown>;
};
const string = (value: unknown, limit = 1000): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new AppError(400, 'BAD_REQUEST', 'Artwork review text is absent or too long.');
  return value;
};
export const matchId = (sourceId: string, mediaId: number) => `anikoto:${sourceId}:anilist:${mediaId}`;

/** Requires either explicit composite review or an exact source-title/episode/MAL crosswalk. Never a name-only matcher. */
export function validateArtworkReview(value: unknown): ArtworkReview {
  const input = record(value); const proof = record(input.evidence);
  for (const key of ['titleId','mediaId','releaseYear']) if (!Number.isSafeInteger(input[key]) || Number(input[key]) < 1) throw new AppError(400, 'BAD_REQUEST', 'Artwork review identifiers must be positive integers.');
  if (input.malId !== null && (!Number.isSafeInteger(input.malId) || Number(input.malId) < 1)) throw new AppError(400, 'BAD_REQUEST', 'The reviewed MAL identifier is invalid.');
  const sourceId = string(input.titleSourceId, 100); const format = string(input.format, 20); const reviewedAt = string(input.reviewedAt, 30);
  if (input.titleSource !== 'anikoto' || !/^[A-Za-z0-9_-]+$/.test(sourceId) || !/^[A-Za-z_ ]{2,20}$/.test(format) || !Number.isFinite(Date.parse(reviewedAt))) throw new AppError(400, 'BAD_REQUEST', 'The artwork source identity or review date is invalid.');
  const sourceUrl = string(proof.sourceUrl); const metadataUrl = string(proof.metadataUrl);
  const parsed = new URL(sourceUrl);
  if (parsed.origin !== 'https://anikototv.to' || !/^\/watch\/[a-z0-9-]+$/.test(parsed.pathname) || parsed.search || parsed.hash || parsed.username || parsed.password || metadataUrl !== `https://anilist.co/anime/${input.mediaId}`) throw new AppError(400, 'BAD_REQUEST', 'Artwork review evidence must name canonical source and authoritative metadata records.');
  const sourceName = string(proof.sourceName); const metadataName = string(proof.metadataName); const sourceAlias = string(proof.sourceAlias); const metadataAlias = string(proof.metadataAlias);
  if (proof.identityProof !== undefined) {
    const identityProof = validateSourceIdentityProof(proof.identityProof, sourceId, sourceUrl, input.malId === null ? null : Number(input.malId));
    if (proof.posterComparison !== undefined || proof.sourcePosterSha256 !== undefined || proof.metadataPosterSha256 !== undefined || proof.premiereDate !== undefined) throw new AppError(400, 'BAD_REQUEST', 'An exact-ID crosswalk must not imply a manual poster or premiere-date review.');
    return { titleId: Number(input.titleId), titleSource: 'anikoto', titleSourceId: sourceId, mediaId: Number(input.mediaId), malId: Number(input.malId), releaseYear: Number(input.releaseYear), format, reviewedAt,
      evidence: { sourceUrl, metadataUrl, sourceName, metadataName, sourceAlias, metadataAlias, identityProof, notes: string(proof.notes, 2000) } };
  }
  if (normalized(sourceName) !== normalized(metadataName) || normalized(sourceAlias) !== normalized(metadataAlias)) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'Artwork identity requires independently matching names and alternate titles.');
  const sourcePosterSha256 = string(proof.sourcePosterSha256, 64); const metadataPosterSha256 = string(proof.metadataPosterSha256, 64);
  if (!/^[a-f0-9]{64}$/.test(sourcePosterSha256) || !/^[a-f0-9]{64}$/.test(metadataPosterSha256) || proof.posterComparison !== 'same-key-art-manually-reviewed') throw new AppError(400, 'BAD_REQUEST', 'A manual comparison of both actual poster resources is required; names alone cannot approve artwork.');
  const premiereDate = string(proof.premiereDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(premiereDate) || Number(premiereDate.slice(0, 4)) !== input.releaseYear || !Number.isFinite(Date.parse(premiereDate))) throw new AppError(400, 'BAD_REQUEST', 'The independently reviewed premiere date does not match the release year.');
  return { titleId: Number(input.titleId), titleSource: 'anikoto', titleSourceId: sourceId, mediaId: Number(input.mediaId), malId: input.malId === null ? null : Number(input.malId), releaseYear: Number(input.releaseYear), format, reviewedAt,
    evidence: { sourceUrl, metadataUrl, sourceName, metadataName, sourceAlias, metadataAlias, sourcePosterSha256, metadataPosterSha256, posterComparison: 'same-key-art-manually-reviewed', premiereDate, notes: string(proof.notes, 2000) } };
}

/** Release year, format and a name corroborate the ID chain; they cannot establish it alone. */
export function sourceIdentityReview(owner: ArtworkIdentityOwner, proof: SourceIdentityProof, media: AniListArtworkMedia, reviewedAt = new Date().toISOString()): ArtworkReview {
  const names = [owner.name, ...owner.aliases]; const metadataNames = [media.title.english, media.title.romaji, media.title.native].filter((value): value is string => !!value);
  const matching = names.find(name => metadataNames.some(value => normalized(value) === normalized(name)));
  if (owner.sourceId !== proof.sourceTitleId || owner.slug !== proof.sourceSlug || media.idMal !== proof.malId || owner.year === null || owner.year !== media.year || !owner.format || normalized(owner.format) !== normalized(media.format) || !matching) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'The exact-ID crosswalk has conflicting or missing title/year/format corroboration; manual review is required.');
  return validateArtworkReview({ titleId: owner.titleId, titleSource: owner.source, titleSourceId: owner.sourceId, mediaId: media.id, malId: media.idMal, releaseYear: owner.year, format: owner.format, reviewedAt,
    evidence: { sourceUrl: `https://anikototv.to/watch/${owner.slug}`, metadataUrl: media.siteUrl, sourceName: owner.name, metadataName: media.title.english ?? media.title.romaji, sourceAlias: matching, metadataAlias: media.title.romaji, identityProof: proof,
      notes: 'Exact original title ID, slug and all imported episode IDs matched the observed metadata bridge; its MAL ID matched AniList. Name, format and year were additional checks. No manual poster review or cleared artwork reuse rights is claimed.' } });
}

export function assertMediaMatches(review: ArtworkReview, media: AniListArtworkMedia): void {
  if (media.id !== review.mediaId || media.idMal !== review.malId || media.year !== review.releaseYear || normalized(media.format) !== normalized(review.format) || normalized(media.title.romaji) !== normalized(review.evidence.metadataAlias))
    throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'Refreshed metadata changed an independently reviewed identity field; existing artwork was preserved.');
}

export function reviewMutation(value: ArtworkReview): SqlMutation {
  const review = validateArtworkReview(value); const id = matchId(review.titleSourceId, review.mediaId);
  return { sql: `INSERT INTO artwork_matches(id,title_id,title_source,title_source_id,metadata_source,media_id,mal_id,release_year,format,review_status,evidence_json,reviewed_at,created_at,updated_at)
    SELECT ?,t.id,?,?, 'anilist',?,?,?,?, 'approved',?,?,?,? FROM titles t WHERE t.id=? AND t.source=? AND t.source_id=? AND t.release_year=? AND LOWER(t.format)=LOWER(?)
    ON CONFLICT(id) DO UPDATE SET evidence_json=excluded.evidence_json,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at
    WHERE artwork_matches.title_id=excluded.title_id AND artwork_matches.title_source=excluded.title_source AND artwork_matches.title_source_id=excluded.title_source_id AND artwork_matches.media_id=excluded.media_id AND artwork_matches.mal_id IS excluded.mal_id AND artwork_matches.reviewed_at<=excluded.reviewed_at`,
    values: [id, review.titleSource, review.titleSourceId, review.mediaId, review.malId, review.releaseYear, review.format, JSON.stringify(review.evidence), review.reviewedAt, review.reviewedAt, review.reviewedAt, review.titleId, review.titleSource, review.titleSourceId, review.releaseYear, review.format] };
}

export function resourceMutation(match: ArtworkMatch, role: ArtworkRole, image: ArtworkResource, reuseStatus: ArtworkReuseStatus = 'reference-only'): SqlMutation {
  validateArtworkUrl(image.url, match.mediaId, role);
  if (!/^[a-f0-9]{64}$/.test(image.contentSha256) || !Number.isFinite(Date.parse(image.verifiedAt))) throw new AppError(400, 'BAD_REQUEST', 'Artwork requires a measured resource digest and verification time.');
  return { sql: `INSERT INTO title_artwork(match_id,role,url,width,height,format,content_sha256,reuse_status,first_seen_at,last_checked_at,last_successful_verification_at,last_error_code)
    SELECT id,?,?,?,?,?,?,?,?,?,?,NULL FROM artwork_matches WHERE id=? AND media_id=? AND title_source_id=? AND review_status='approved'
    ON CONFLICT(match_id,role) DO UPDATE SET url=excluded.url,width=excluded.width,height=excluded.height,format=excluded.format,content_sha256=excluded.content_sha256,last_checked_at=excluded.last_checked_at,last_successful_verification_at=excluded.last_successful_verification_at,last_error_code=NULL
    WHERE julianday(title_artwork.last_successful_verification_at)<=julianday(excluded.last_successful_verification_at) AND julianday(title_artwork.last_checked_at)<=julianday(excluded.last_checked_at)`,
    values: [role, image.url, image.width, image.height, image.format, image.contentSha256, reuseStatus, image.verifiedAt, image.verifiedAt, image.verifiedAt, match.id, match.mediaId, match.titleSourceId] };
}

export function parseStoredMatch(row: Record<string, unknown>): ArtworkMatch {
  let evidence: unknown; try { evidence = JSON.parse(String(row.evidence_json)); } catch { throw new AppError(422, 'UPSTREAM_CHANGED', 'Stored artwork review evidence is malformed.'); }
  const review = validateArtworkReview({ titleId: row.title_id, titleSource: row.title_source, titleSourceId: row.title_source_id, mediaId: row.media_id, malId: row.mal_id, releaseYear: row.release_year, format: row.format, reviewedAt: row.reviewed_at, evidence });
  if (row.id !== matchId(review.titleSourceId, review.mediaId) || row.metadata_source !== 'anilist' || !['approved','disabled'].includes(String(row.review_status))) throw new AppError(422, 'UPSTREAM_CHANGED', 'Stored artwork identity is malformed.');
  return { ...review, id: String(row.id), reviewStatus: row.review_status === 'approved' ? 'approved' : 'disabled' };
}
