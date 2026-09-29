import { AppError } from '../errors.ts';
import { parseStoredMatch } from './model.ts';
import { validateArtworkUrl } from './source.ts';

/** Full, source-specific rows only; the protected import endpoint is not an artwork URL proxy. */
export function validateArtworkImportRow(table: string, row: Record<string, unknown>, requiredColumns: readonly string[]): void {
  if (table !== 'artwork_matches' && table !== 'title_artwork') return;
  if (requiredColumns.some(column => !(column in row))) throw new AppError(400, 'INVALID_IMPORT', 'Artwork imports require a complete reviewed row, not partial identity patches.');
  if (table === 'artwork_matches') { parseStoredMatch(row); return; }
  const match = typeof row.match_id === 'string' ? /^anikoto:[A-Za-z0-9_-]+:anilist:([1-9][0-9]*)$/.exec(row.match_id) : null;
  if (!match || (row.role !== 'poster' && row.role !== 'backdrop')) throw new AppError(400, 'INVALID_IMPORT', 'Artwork resources need their exact reviewed match and role.');
  validateArtworkUrl(row.url, Number(match[1]), row.role);
  for (const key of ['width','height']) if (!Number.isSafeInteger(row[key]) || Number(row[key]) < 1 || Number(row[key]) > 12_000) throw new AppError(400, 'INVALID_IMPORT', 'Artwork image measurements are invalid.');
  if (!['jpeg','png','webp'].includes(String(row.format)) || !/^[a-f0-9]{64}$/.test(String(row.content_sha256)) || !['reference-only','permission-recorded','public-domain','unknown'].includes(String(row.reuse_status))) throw new AppError(400, 'INVALID_IMPORT', 'Artwork format, verification digest or reuse status is invalid.');
  for (const key of ['first_seen_at','last_checked_at','last_successful_verification_at']) if (typeof row[key] !== 'string' || !Number.isFinite(Date.parse(String(row[key])))) throw new AppError(400, 'INVALID_IMPORT', 'Artwork observation dates are invalid.');
  if (Date.parse(String(row.last_checked_at)) < Date.parse(String(row.last_successful_verification_at))) throw new AppError(400, 'INVALID_IMPORT', 'Artwork verification cannot be newer than its last observation.');
}
