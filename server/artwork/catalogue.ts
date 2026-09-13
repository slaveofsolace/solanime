import type { SqliteDatabase } from '../db.ts';
import type { CatalogueDatabase } from '../cloud/data/catalogue.ts';
import type { CatalogueArtwork, VerifiedArtwork, ArtworkReuseStatus } from '../../shared/artwork.ts';
import { usefulArtwork, validateArtworkUrl } from './source.ts';
import { validateSourceIdentityProof } from './identity.ts';

type Row = Record<string, unknown>;
const schemaQuery = "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('artwork_matches','title_artwork')";
const artworkQuery = `SELECT CAST(m.title_id AS TEXT) AS titleId,m.media_id,m.mal_id,m.title_source_id,m.reviewed_at,m.evidence_json,a.*
  FROM artwork_matches m JOIN titles t ON t.id=m.title_id AND t.source=m.title_source AND t.source_id=m.title_source_id AND t.release_year=m.release_year AND LOWER(t.format)=LOWER(m.format)
  JOIN title_artwork a ON a.match_id=m.id WHERE m.review_status='approved' AND t.id IN (SELECT value FROM json_each(?))`;

function idsFor(items: readonly Row[]): number[] {
  return [...new Set(items.map(item => Number(item.id)).filter(id => Number.isSafeInteger(id) && id > 0))];
}
function projectArtwork(rows: readonly Row[]): Map<string, NonNullable<CatalogueArtwork['artwork']>> {
  const found = new Map<string, NonNullable<CatalogueArtwork['artwork']>>();
  for (const row of rows) {
    if (row.last_error_code === 'IMAGE_ABSENT') continue;
    if ((row.role !== 'poster' && row.role !== 'backdrop') || !Number.isSafeInteger(row.media_id) || !Number.isSafeInteger(row.width) || !Number.isSafeInteger(row.height) || !['jpeg','png','webp'].includes(String(row.format)) || !/^[a-f0-9]{64}$/.test(String(row.content_sha256)) || !Number.isFinite(Date.parse(String(row.last_successful_verification_at)))) continue;
    const width = Number(row.width); const height = Number(row.height);
    if (!usefulArtwork({ width, height, format: 'jpeg' }, row.role)) continue;
    let url: string; try { url = validateArtworkUrl(row.url, Number(row.media_id), row.role); } catch { continue; }
    const status = String(row.reuse_status);
    const reuseStatus: ArtworkReuseStatus = status === 'reference-only' || status === 'permission-recorded' || status === 'public-domain' ? status : 'unknown';
    let proof: Record<string, unknown>; try { proof = JSON.parse(String(row.evidence_json)) as Record<string, unknown>; } catch { continue; }
    if (!proof || typeof proof !== 'object' || Array.isArray(proof)) continue;
    if (proof.identityProof) {
      try { validateSourceIdentityProof(proof.identityProof,String(row.title_source_id),String(proof.sourceUrl),row.mal_id === null ? null : Number(row.mal_id)); } catch { continue; }
    } else if (proof.posterComparison !== 'same-key-art-manually-reviewed') continue;
    const entry: VerifiedArtwork = { url, width, height, role: row.role, source: 'anilist', sourceMediaId: Number(row.media_id), sourcePageUrl: `https://anilist.co/anime/${row.media_id}`, verifiedAt: String(row.last_successful_verification_at), contentSha256: String(row.content_sha256), reuseStatus, identityReview: proof.identityProof ? 'source-id-verified' : 'manual-reviewed', freshness: row.last_error_code ? 'last-known-good' : 'verified', lastCheckedAt: String(row.last_checked_at) };
    const existing = found.get(String(row.titleId)) ?? {}; existing[row.role] = entry; found.set(String(row.titleId), existing);
  }
  return found;
}
function decorate<T extends Row>(items: readonly T[], assets: Map<string, NonNullable<CatalogueArtwork['artwork']>>): Array<T & CatalogueArtwork> {
  return items.map(item => {
    const artwork = assets.get(String(item.id));
    return { ...item, posterUrl: artwork?.poster?.url ?? (typeof item.imageUrl === 'string' ? item.imageUrl : typeof item.artworkUrl === 'string' ? item.artworkUrl : null), backdropUrl: artwork?.backdrop?.url ?? null, ...(artwork && Object.keys(artwork).length ? { artwork } : {}) };
  });
}

/** Read-only and backward compatible with schema 8; no fetch or migration during browsing. */
export function decorateLocalArtwork<T extends Row>(db: SqliteDatabase, items: readonly T[]): Array<T & CatalogueArtwork> {
  const ids = idsFor(items); const found: Row[] = [];
  if (ids.length && Number((db.prepare(schemaQuery).get() as { count: number }).count) === 2) {
    for (let index = 0; index < ids.length; index += 100) found.push(...db.prepare(artworkQuery).all(JSON.stringify(ids.slice(index, index + 100))));
  }
  return decorate(items, projectArtwork(found));
}

/** At most one bounded artwork query for a normal catalogue page; original API IDs remain unchanged. */
export async function decorateCloudArtwork<T extends Row>(db: CatalogueDatabase, items: readonly T[]): Promise<Array<T & CatalogueArtwork>> {
  const ids = idsFor(items); const found: Row[] = [];
  if (ids.length && Number((await db.prepare(schemaQuery).first<{ count: number }>())?.count) === 2) {
    for (let index = 0; index < ids.length; index += 100) found.push(...(await db.prepare(artworkQuery).bind(JSON.stringify(ids.slice(index, index + 100))).all<Row>()).results);
  }
  return decorate(items, projectArtwork(found));
}
