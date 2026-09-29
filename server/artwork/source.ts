import type { ArtworkRole } from '../../shared/artwork.ts';
import { completeRaster } from './raster.ts';

export interface AniListArtworkMedia {
  id: number;
  idMal: number | null;
  title: { english: string | null; romaji: string; native: string | null };
  format: string;
  year: number | null;
  siteUrl: string;
  posterUrl: string | null;
  backdropUrl: string | null;
}
export interface ImageMeasurement { width: number; height: number; format: 'jpeg' | 'png' | 'webp'; }
export interface ArtworkResource extends ImageMeasurement { url: string; bytes: number; contentSha256: string; verifiedAt: string; }
export class ArtworkSourceError extends Error {
  constructor(readonly code: 'BLOCKED' | 'UNAVAILABLE' | 'RATE_LIMITED' | 'QUOTA_EXHAUSTED' | 'INVALID_RESPONSE' | 'INVALID_DESTINATION', message: string, readonly status?: number, readonly retryAfterSeconds = 60) { super(message); }
}

export function validateArtworkUrl(value: unknown, id: number, role: ArtworkRole): string {
  if (typeof value !== 'string' || value.length > 1000 || !Number.isSafeInteger(id) || id < 1) throw new ArtworkSourceError('INVALID_DESTINATION', 'The metadata image reference is invalid.');
  let url: URL;
  try { url = new URL(value); } catch { throw new ArtworkSourceError('INVALID_DESTINATION', 'The metadata image URL is invalid.'); }
  const path = role === 'backdrop'
    ? new RegExp(`^/file/anilistcdn/media/anime/banner/${id}-[A-Za-z0-9]+\\.(?:jpg|jpeg|png|webp)$`)
    : new RegExp(`^/file/anilistcdn/media/anime/cover/(?:large|medium|small)/b?x?${id}-[A-Za-z0-9]+\\.(?:jpg|jpeg|png|webp)$`);
  if (url.protocol !== 'https:' || url.hostname !== 's4.anilist.co' || url.port || url.username || url.password || url.search || url.hash || !path.test(url.pathname))
    throw new ArtworkSourceError('INVALID_DESTINATION', 'The returned image is outside this reviewed media identity and source host.');
  return url.href;
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ArtworkSourceError('INVALID_RESPONSE', 'The artwork metadata response changed.');
  return value as Record<string, unknown>;
};
const optionalText = (value: unknown, limit = 1000): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > limit) throw new ArtworkSourceError('INVALID_RESPONSE', 'An artwork metadata text field is invalid.');
  return value;
};

export function parseAniListMedia(value: unknown, expectedId: number): AniListArtworkMedia {
  const media = object(value); const titles = object(media.title); const startDate = object(media.startDate); const cover = object(media.coverImage);
  if (media.id !== expectedId || !Number.isSafeInteger(expectedId) || expectedId < 1 || media.type !== 'ANIME' || typeof media.format !== 'string' || !/^[A-Z_]{2,20}$/.test(media.format))
    throw new ArtworkSourceError('INVALID_RESPONSE', 'The metadata response does not match the reviewed anime identity.');
  if (media.idMal !== null && (!Number.isSafeInteger(media.idMal) || Number(media.idMal) < 1)) throw new ArtworkSourceError('INVALID_RESPONSE', 'The authoritative MAL identifier is malformed.');
  if (startDate.year !== null && (!Number.isSafeInteger(startDate.year) || Number(startDate.year) < 1800 || Number(startDate.year) > 2200)) throw new ArtworkSourceError('INVALID_RESPONSE', 'The release year is malformed.');
  const romaji = optionalText(titles.romaji); if (!romaji) throw new ArtworkSourceError('INVALID_RESPONSE', 'The metadata title is absent.');
  const poster = optionalText(cover.extraLarge ?? cover.large); const backdrop = optionalText(media.bannerImage);
  const siteUrl = `https://anilist.co/anime/${expectedId}`;
  if (media.siteUrl !== siteUrl) throw new ArtworkSourceError('INVALID_RESPONSE', 'The metadata canonical URL does not match its authoritative ID.');
  return { id: expectedId, idMal: media.idMal === null ? null : Number(media.idMal), title: { romaji, english: optionalText(titles.english), native: optionalText(titles.native) }, format: media.format, year: startDate.year === null ? null : Number(startDate.year), siteUrl,
    posterUrl: poster ? validateArtworkUrl(poster, expectedId, 'poster') : null,
    backdropUrl: backdrop ? validateArtworkUrl(backdrop, expectedId, 'backdrop') : null };
}

export function imageDimensions(bytes: Uint8Array): ImageMeasurement | null {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 24 && bytes[0] === 137 && ascii(1, 4) === 'PNG') return { format: 'png', width: data.getUint32(16), height: data.getUint32(20) };
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const kind = ascii(12, 16);
    if (kind === 'VP8X') return { format: 'webp', width: bytes[24] + (bytes[25] << 8) + (bytes[26] << 16) + 1, height: bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) + 1 };
    if (kind === 'VP8 ') return { format: 'webp', width: data.getUint16(26, true) & 0x3fff, height: data.getUint16(28, true) & 0x3fff };
    if (kind === 'VP8L') { const bits = data.getUint32(21, true); return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }; }
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset++] !== 0xff) continue;
    let marker = bytes[offset++]; while (marker === 0xff) marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const size = data.getUint16(offset);
    if (size < 2 || offset + size > bytes.length) break;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return { format: 'jpeg', width: data.getUint16(offset + 5), height: data.getUint16(offset + 3) };
    offset += size;
  }
  return null;
}

export async function boundedArtworkBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { await response.body?.cancel(); throw new ArtworkSourceError('INVALID_RESPONSE', 'The artwork response exceeds the bounded size limit.'); }
  const reader = response.body?.getReader(); if (!reader) throw new ArtworkSourceError('INVALID_RESPONSE', 'The artwork response body is absent.');
  const parts: Uint8Array[] = []; let size = 0;
  for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new ArtworkSourceError('INVALID_RESPONSE', 'The artwork response exceeds the bounded size limit.'); } parts.push(part.value); }
  const bytes = new Uint8Array(size); let cursor = 0; for (const part of parts) { bytes.set(part, cursor); cursor += part.length; } return bytes;
}

async function checkedResponse(response: Response): Promise<Response> {
  if (response.status === 200) return response;
  await response.body?.cancel();
  const retry = response.headers.get('retry-after');
  const retrySeconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry) - Date.now()) / 1000) : 60;
  const delay = Number.isFinite(retrySeconds) ? Math.max(1, Math.min(86_400, retrySeconds)) : 60;
  if (response.status === 401 || response.status === 403) throw new ArtworkSourceError('BLOCKED', 'The source explicitly refused this normal artwork request; no bypass or automatic retry.', response.status);
  if (response.status === 429) throw new ArtworkSourceError('RATE_LIMITED', 'The source requested a pause before further artwork requests.', response.status, delay);
  if (response.status >= 300 && response.status < 400) throw new ArtworkSourceError('INVALID_DESTINATION', 'The artwork source redirected; the destination requires a separate review.', response.status);
  throw new ArtworkSourceError('UNAVAILABLE', 'The source artwork resource is currently unavailable.', response.status, delay);
}

export async function fetchAniListMedia(id: number, send: typeof fetch = fetch): Promise<AniListArtworkMedia> {
  return fetchAniListIdentity(id, 'id', send);
}

/** Documented Media(idMal:) lookup; never searches or chooses a similarly named title. */
export async function fetchAniListMediaByMal(id: number, send: typeof fetch = fetch): Promise<AniListArtworkMedia> {
  return fetchAniListIdentity(id, 'idMal', send);
}

async function fetchAniListIdentity(id: number, key: 'id' | 'idMal', send: typeof fetch): Promise<AniListArtworkMedia> {
  if (!Number.isSafeInteger(id) || id < 1) throw new ArtworkSourceError('INVALID_RESPONSE', 'Use a reviewed authoritative anime ID.');
  const query = `query SolanimeArtwork($id: Int!) { Media(${key}: $id, type: ANIME) { id idMal type format startDate { year } title { english romaji native } siteUrl coverImage { extraLarge large } bannerImage } }`;
  const response = await checkedResponse(await send('https://graphql.anilist.co/', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ query, variables: { id } }), redirect: 'manual', signal: AbortSignal.timeout(15_000) }));
  if (!response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw new ArtworkSourceError('INVALID_RESPONSE', 'The artwork metadata endpoint did not return JSON.'); }
  let decoded: unknown; try { decoded = JSON.parse(new TextDecoder().decode(await boundedArtworkBody(response, 100_000))); } catch (error) { if (error instanceof ArtworkSourceError) throw error; throw new ArtworkSourceError('INVALID_RESPONSE', 'The artwork metadata response is malformed.'); }
  const result = object(decoded); if (result.errors) throw new ArtworkSourceError('INVALID_RESPONSE', 'The metadata service returned a GraphQL error; existing artwork was retained.');
  const value = object(object(result.data).Media);
  if (value[key] !== id) throw new ArtworkSourceError('INVALID_RESPONSE', 'The returned authoritative identifier does not match the exact lookup.');
  return parseAniListMedia(value, key === 'id' ? id : Number(value.id));
}

export async function fetchArtworkResource(url: string, id: number, role: ArtworkRole, send: typeof fetch = fetch): Promise<ArtworkResource> {
  const validated = validateArtworkUrl(url, id, role);
  const response = await checkedResponse(await send(validated, { headers: { accept: 'image/jpeg,image/png,image/webp' }, redirect: 'manual', signal: AbortSignal.timeout(15_000) }));
  if (!/^image\/(?:jpeg|png|webp)(?:;|$)/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); throw new ArtworkSourceError('INVALID_RESPONSE', 'The artwork resource is not a supported raster image.'); }
  const bytes = await boundedArtworkBody(response, 8_000_000); const dimensions = imageDimensions(bytes);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > 8_388_608 || !completeRaster(bytes, dimensions.format)) throw new ArtworkSourceError('INVALID_RESPONSE', 'The artwork image is truncated, malformed, animated or exceeds its bounded decoded dimensions.');
  if (!response.headers.get('content-type')?.toLowerCase().startsWith(`image/${dimensions.format}`)) throw new ArtworkSourceError('INVALID_RESPONSE','The measured image container does not match its declared media type.');
  const digestBytes = new Uint8Array(bytes.length); digestBytes.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', digestBytes.buffer);
  return { ...dimensions, url: validated, bytes: bytes.length, contentSha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join(''), verifiedAt: new Date().toISOString() };
}

export function usefulArtwork(dimensions: ImageMeasurement, role: ArtworkRole): boolean {
  if (dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > 8_388_608) return false;
  const ratio = dimensions.width / dimensions.height;
  return role === 'backdrop' ? dimensions.width >= 1000 && dimensions.height >= 250 && ratio >= 1.5 && ratio <= 6
    : dimensions.width >= 300 && dimensions.height >= 400 && ratio >= 0.5 && ratio <= 0.85;
}
