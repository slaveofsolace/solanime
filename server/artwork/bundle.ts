import type { SqliteDatabase } from '../db.ts';
import { AppError } from '../errors.ts';
import { approveLocalArtwork } from './local.ts';
import { assertMediaMatches, resourceMutation, validateArtworkReview, type ArtworkReview } from './model.ts';
import { validateArtworkUrl, type AniListArtworkMedia, type ArtworkResource } from './source.ts';
import { parseArtworkCheckpoint } from './refresh.ts';

export interface ArtworkBundleRecord { review: ArtworkReview; metadata: AniListArtworkMedia; resources: Array<ArtworkResource & { role: 'poster' | 'backdrop' }>; }
export interface ArtworkBundle { version: 1; records: ArtworkBundleRecord[]; }
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(400, 'BAD_REQUEST', 'Artwork bundle data must be a structured object.');
  return value as Record<string, unknown>;
};
export function validateArtworkBundle(input: unknown): ArtworkBundle {
  const value = object(input);
  if (value.version !== 1 || !Array.isArray(value.records) || !value.records.length || value.records.length > 100) throw new AppError(400, 'BAD_REQUEST', 'An artwork review bundle must contain one to one hundred explicit reviewed records.');
  const usedTitles = new Set<number>(); const usedMedia = new Set<number>();
  const records = value.records.map(entry => {
    const row = object(entry); const review = validateArtworkReview(row.review);
    if (usedTitles.has(review.titleId) || usedMedia.has(review.mediaId)) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'A review bundle cannot repeat a title or authoritative identity.');
    usedTitles.add(review.titleId); usedMedia.add(review.mediaId);
    const match = { ...review, id: `anikoto:${review.titleSourceId}:anilist:${review.mediaId}`, reviewStatus: 'approved' as const };
    const metadata = parseArtworkCheckpoint({ phase: 'done', media: row.metadata }, match).media!;
    assertMediaMatches(review, metadata);
    if (!Array.isArray(row.resources) || row.resources.length < 1 || row.resources.length > 2) throw new AppError(400, 'BAD_REQUEST', 'Only measured poster/backdrop resources may be included.');
    const usedRoles = new Set<string>();
    const resources = row.resources.map((entry): ArtworkResource & { role: 'poster' | 'backdrop' } => {
      const image = object(entry); const role = image.role;
      if ((role !== 'poster' && role !== 'backdrop') || usedRoles.has(role)) throw new AppError(400, 'BAD_REQUEST', 'Artwork resource roles must be distinct.');
      usedRoles.add(role);
      const url = validateArtworkUrl(image.url, review.mediaId, role);
      if (url !== (role === 'poster' ? metadata.posterUrl : metadata.backdropUrl)) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'The measured image is not the resource returned for this reviewed metadata identity.');
      for (const key of ['width','height','bytes']) if (!Number.isSafeInteger(image[key]) || Number(image[key]) < 1 || Number(image[key]) > (key === 'bytes' ? 8_000_000 : 12_000)) throw new AppError(400, 'BAD_REQUEST', 'Artwork measurements are invalid.');
      const format = image.format;
      if (format !== 'jpeg' && format !== 'png' && format !== 'webp') throw new AppError(400, 'BAD_REQUEST', 'Artwork must be a measured raster image.');
      if (typeof image.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(image.contentSha256) || typeof image.verifiedAt !== 'string' || !Number.isFinite(Date.parse(image.verifiedAt))) throw new AppError(400, 'BAD_REQUEST', 'Each artwork resource requires its digest and observation time.');
      if (role === 'poster' && !review.evidence.identityProof && image.contentSha256 !== review.evidence.metadataPosterSha256) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'The reviewed poster differs from the measured resource.');
      return { role, url, width: Number(image.width), height: Number(image.height), bytes: Number(image.bytes), format, contentSha256: image.contentSha256, verifiedAt: image.verifiedAt };
    });
    if (!review.evidence.identityProof && !usedRoles.has('poster')) throw new AppError(400, 'BAD_REQUEST', 'The independently reviewed poster resource must be retained as evidence.');
    return { review, metadata, resources };
  });
  return { version: 1, records };
}

/** Consumes already measured operator evidence; performs zero upstream requests. Idempotent per title. */
export function applyArtworkBundle(db: SqliteDatabase, input: unknown) {
  const bundle = validateArtworkBundle(input); let matches = 0; let resources = 0;
  for (const entry of bundle.records) {
    const match = approveLocalArtwork(db, entry.review);
    if (match.reviewStatus !== 'approved') throw new AppError(409, 'IMPORT_CONFLICT', 'An operator-disabled artwork mapping stays disabled.');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const image of entry.resources) {
        const mutation = resourceMutation(match, image.role, image);
        resources += Number(db.prepare(mutation.sql).run(...mutation.values).changes);
      }
      const now = entry.review.reviewedAt;
      db.prepare(`INSERT INTO artwork_jobs(match_id,status,checkpoint_json,available_at,created_at,updated_at) VALUES(?,'completed',?,?,?,?) ON CONFLICT(match_id) DO UPDATE SET checkpoint_json=excluded.checkpoint_json,updated_at=excluded.updated_at WHERE artwork_jobs.status='completed' AND artwork_jobs.updated_at<=excluded.updated_at`).run(match.id, JSON.stringify({ phase: 'done', media: entry.metadata }), now, now, now);
      db.exec('COMMIT'); matches++;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return { reviewedRecords: matches, resourceUpserts: resources, upstreamRequests: 0, sourceIdentifiersChanged: 0, reuseStatus: 'reference-only' as const };
}
