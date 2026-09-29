import type { PlaybackResult } from '../../shared/playback.ts';
import { RELEASE } from '../../shared/release.ts';
import type { StoredProviderMapping } from './contract.ts';
import { boundedPublicJson, unsupportedNative, type ApprovedNativeResource } from './native.ts';

export const COMMONS_PROVIDER_ID = 'wikimedia-commons';
export const COMMONS_PROVIDER_LABEL = 'Wikimedia Commons';
export const COMMONS_PROVIDER_ALIASES = ['Commons', 'Wikimedia Commons'] as const;
// Wikimedia requires an identifiable client with operator contact information.
// This is our real project, never a borrowed browser/bot identity or a proxy.
export const COMMONS_USER_AGENT = `Solanime/${RELEASE} (https://solanime.pages.dev; public-domain video metadata)`;
type MappingIdentity = Pick<StoredProviderMapping, 'mappingId' | 'providerId' | 'providerResourceId' | 'language'>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fileTitle = (value: string) => value.replaceAll('_', ' ').normalize('NFC');
const validFileTitle = (value: string) => value.startsWith('File:') && value.length > 5 && value.length <= 512 && !/[\\/#?<>\[\]{}|\u0000-\u001f\u007f]/.test(value);
const evidenceUrl = (value: string) => {
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.port; }
  catch { return false; }
};
function commonsRightsUrl(value: string, title: string) {
  try {
    const url = new URL(value);
    return evidenceUrl(value) && url.hostname === 'commons.wikimedia.org' && !url.search &&
      fileTitle(decodeURIComponent(url.pathname.slice('/wiki/'.length))) === fileTitle(title) && url.pathname.startsWith('/wiki/');
  } catch { return false; }
}
function approvalError(mapping: MappingIdentity, resource: ApprovedNativeResource): string | null {
  if (mapping.providerId !== COMMONS_PROVIDER_ID || resource.provider_id !== mapping.providerId || resource.mapping_id !== mapping.mappingId ||
    !mapping.providerResourceId || fileTitle(resource.resource_id) !== fileTitle(mapping.providerResourceId) || resource.language !== mapping.language)
    return 'RESOURCE_IDENTITY_MISMATCH';
  if (!validFileTitle(resource.resource_id)) return 'INVALID_RESOURCE_ID';
  if (resource.enabled !== 1 || !Number.isFinite(Date.parse(resource.approved_at)) || !resource.edition.trim() || !resource.license.trim() ||
    !commonsRightsUrl(resource.rights_evidence_url, resource.resource_id) || !evidenceUrl(resource.identity_evidence_url) ||
    typeof resource.content_sha1 !== 'string' || !/^[a-f0-9]{40}$/.test(resource.content_sha1)) return 'RESOURCE_NOT_APPROVED';
  return null;
}

/** Shared by selectors and resolution: a Commons label is not playback approval. */
export function hasApprovedCommonsResource(mapping: MappingIdentity, resource: ApprovedNativeResource | null | undefined): boolean {
  return !!resource && approvalError(mapping, resource) === null;
}

const failures: Record<string, { message: string; retryable: boolean }> = {
  RESOURCE_IDENTITY_MISMATCH: { message: 'The reviewed Commons file does not match this episode version.', retryable: false },
  RESOURCE_NOT_APPROVED: { message: 'This exact Commons file and edition have not been approved for native playback.', retryable: false },
  INVALID_RESOURCE_ID: { message: 'The stored Commons File title is invalid.', retryable: false },
  RESOURCE_NOT_FOUND: { message: 'The reviewed Commons file is no longer available.', retryable: false },
  RESOURCE_RIGHTS_CHANGED: { message: 'The Commons public-domain declaration changed or now lists restrictions. A new rights review is required.', retryable: false },
  RESOURCE_IDENTITY_CHANGED: { message: 'Commons returned a different file identity. This mapping needs review.', retryable: false },
  RESOURCE_EDITION_CHANGED: { message: 'The Commons file content changed since this edition was reviewed. A new identity and rights review is required.', retryable: false },
  NATIVE_FORMAT_UNAVAILABLE: { message: 'This Commons adapter requires an original WebM video; the current file is not a supported format.', retryable: false },
  UPSTREAM_BLOCKED: { message: 'Commons declined this request. Solanime does not bypass access restrictions.', retryable: false },
  UPSTREAM_RATE_LIMIT: { message: 'Commons asked for fewer requests. Wait before trying again.', retryable: true },
  UPSTREAM_SCHEMA_CHANGED: { message: 'Commons returned an unexpected metadata format. This connection needs review.', retryable: false },
  UPSTREAM_EMPTY_RESPONSE: { message: 'Commons returned no metadata. Try again later.', retryable: true },
  UPSTREAM_RESPONSE_TOO_LARGE: { message: 'The Commons metadata exceeded the safe response limit.', retryable: false },
  UPSTREAM_REDIRECT: { message: 'The fixed Commons metadata endpoint unexpectedly redirected. The destination was not followed.', retryable: false },
  UPSTREAM_TIMEOUT: { message: 'Commons took too long to respond. Try again later.', retryable: true },
  UPSTREAM_UNAVAILABLE: { message: 'Commons could not be reached. Try again later.', retryable: true },
  UNSAFE_MEDIA_DESTINATION: { message: 'Commons returned a media destination outside this reviewed connection.', retryable: false },
  MEDIA_REDIRECT_LIMIT: { message: 'The Commons media destination changed too many times.', retryable: false },
  MEDIA_RESTRICTED: { message: 'The media host restricts this file. Solanime does not bypass that restriction.', retryable: false },
  MEDIA_NOT_FOUND: { message: 'The Commons media file is unavailable.', retryable: false },
  MEDIA_UNAVAILABLE: { message: 'The Commons media host is unavailable. Try again later.', retryable: true },
  MEDIA_TYPE_CHANGED: { message: 'The media host no longer returns the expected WebM video.', retryable: false },
  MEDIA_CORS_RESTRICTED: { message: 'The media host does not permit anonymous cross-origin video requests for this file.', retryable: false },
  MEDIA_RANGE_UNAVAILABLE: { message: 'The media host did not confirm byte-range support required for seeking and progress restoration.', retryable: false },
};

function mediaUrl(value: string, title: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'upload.wikimedia.org' || url.username || url.password || url.port || url.hash)
      throw Error();
    // Only the original file path is evidenced. Do not infer transcode routes,
    // derivative filenames, archive revisions, signed URLs or arbitrary hosts.
    const match = /^\/wikipedia\/commons\/[a-f0-9]\/[a-f0-9]{2}\/([^/]+)$/.exec(url.pathname);
    if (!match || fileTitle('File:' + decodeURIComponent(match[1])) !== fileTitle(title)) throw Error();
    for (const key of [...url.searchParams.keys()]) {
      if (!/^utm_/i.test(key)) throw Error();
      url.searchParams.delete(key);
    }
    return url;
  } catch { throw new Error('UNSAFE_MEDIA_DESTINATION'); }
}

function untilAborted<T>(value: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    value.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
const metadataValue = (metadata: Record<string, unknown>, key: string) => {
  const value = metadata[key]; return object(value) && typeof value.value === 'string' ? value.value.trim() : undefined;
};

/** Fresh public imageinfo → exact original file → validated anonymous HEAD.
 * Approval is per mapping and edition, not inferred from a matching name. No
 * captured URLs, iframe extraction, media proxy, downloaded copies or captions
 * inferred from Commons' descriptive "Captions" field are involved.
 */
export async function resolveWikimediaCommons(mapping: StoredProviderMapping, resource: ApprovedNativeResource,
  signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<PlaybackResult> {
  signal?.throwIfAborted();
  const invalid = approvalError(mapping, resource);
  if (invalid) return unsupportedNative(mapping, invalid, failures[invalid].message, false);
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Commons request timed out', 'TimeoutError')), 12_000);
  const request = async (url: string | URL, init: RequestInit = {}) => {
    controller.signal.throwIfAborted();
    const headers = new Headers(init.headers);
    headers.set('User-Agent', COMMONS_USER_AGENT);
    const response = await untilAborted(fetcher(url, { ...init, headers, signal: controller.signal, redirect: 'manual' }), controller.signal);
    controller.signal.throwIfAborted();
    return response;
  };
  try {
    const query = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo',
      iiprop: 'url|mime|size|extmetadata|sha1|canonicaltitle', titles: resource.resource_id });
    const response = await request(`https://commons.wikimedia.org/w/api.php?${query}`, { headers: { Accept: 'application/json' } });
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('UPSTREAM_REDIRECT'); }
    const metadata = await untilAborted(boundedPublicJson(response), controller.signal);
    if (!object(metadata) || !object(metadata.query) || !Array.isArray(metadata.query.pages) || metadata.query.pages.length !== 1)
      throw new Error('UPSTREAM_SCHEMA_CHANGED');
    const page: unknown = metadata.query.pages[0];
    if (!object(page)) throw new Error('UPSTREAM_SCHEMA_CHANGED');
    if (page.missing === true) throw new Error('RESOURCE_NOT_FOUND');
    if (page.invalid === true) throw new Error('INVALID_RESOURCE_ID');
    if (page.ns !== 6 || typeof page.title !== 'string' || fileTitle(page.title) !== fileTitle(resource.resource_id)) throw new Error('RESOURCE_IDENTITY_CHANGED');
    if (!Array.isArray(page.imageinfo) || page.imageinfo.length !== 1 || !object(page.imageinfo[0])) throw new Error('UPSTREAM_SCHEMA_CHANGED');
    const info = page.imageinfo[0];
    if (typeof info.canonicaltitle !== 'string' || fileTitle(info.canonicaltitle) !== fileTitle(resource.resource_id)) throw new Error('RESOURCE_IDENTITY_CHANGED');
    if (info.mime !== 'video/webm' || !/\.webm$/i.test(resource.resource_id)) throw new Error('NATIVE_FORMAT_UNAVAILABLE');
    if (typeof info.url !== 'string' || !Number.isSafeInteger(info.size) || Number(info.size) <= 0 ||
      typeof info.sha1 !== 'string' || !/^[a-f0-9]{40}$/.test(info.sha1)) throw new Error('UPSTREAM_SCHEMA_CHANGED');
    if (info.sha1 !== resource.content_sha1) throw new Error('RESOURCE_EDITION_CHANGED');
    if (!object(info.extmetadata) || metadataValue(info.extmetadata, 'LicenseShortName') !== 'Public domain' ||
      metadataValue(info.extmetadata, 'UsageTerms') !== 'Public domain' || metadataValue(info.extmetadata, 'License') !== 'pd' ||
      metadataValue(info.extmetadata, 'Copyrighted')?.toLowerCase() !== 'false' || metadataValue(info.extmetadata, 'Restrictions') !== '')
      throw new Error('RESOURCE_RIGHTS_CHANGED');
    let url = mediaUrl(info.url, resource.resource_id);
    for (let redirects = 0; ; redirects++) {
      const head = await request(url, { method: 'HEAD' });
      await head.body?.cancel();
      if ([301, 302, 303, 307, 308].includes(head.status)) {
        const next = head.headers.get('location');
        if (!next || redirects >= 3) throw new Error('MEDIA_REDIRECT_LIMIT');
        url = mediaUrl(new URL(next, url).href, resource.resource_id); continue;
      }
      if (!head.ok) throw new Error(head.status === 403 ? 'MEDIA_RESTRICTED' : head.status === 404 ? 'MEDIA_NOT_FOUND' : head.status === 429 ? 'UPSTREAM_RATE_LIMIT' : 'MEDIA_UNAVAILABLE');
      if (!/^video\/webm(?:\s*;|$)/i.test(head.headers.get('content-type') ?? '')) throw new Error('MEDIA_TYPE_CHANGED');
      if (head.headers.get('access-control-allow-origin') !== '*') throw new Error('MEDIA_CORS_RESTRICTED');
      if (head.headers.get('accept-ranges')?.toLowerCase() !== 'bytes') throw new Error('MEDIA_RANGE_UNAVAILABLE');
      break;
    }
    controller.signal.throwIfAborted();
    return { kind: 'native', mappingId: String(mapping.mappingId), providerId: COMMONS_PROVIDER_ID, language: mapping.language,
      format: 'direct', url: url.href, allowedMediaHosts: ['upload.wikimedia.org'], mediaCrossOrigin: 'anonymous', captions: [],
      capabilities: { seek: true, volume: true, fullscreen: true, progressEvents: true, subtitles: false, qualitySelection: false },
      // This is our resolution revalidation TTL, not a claim that Commons signs or expires its original-file URL.
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      attribution: { label: `${COMMONS_PROVIDER_LABEL} · ${resource.edition}`, url: resource.rights_evidence_url, license: resource.license } };
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
    const candidate = controller.signal.aborted ? 'UPSTREAM_TIMEOUT' : error instanceof Error ? error.message : 'UPSTREAM_UNAVAILABLE';
    const code = Object.hasOwn(failures, candidate) ? candidate : 'UPSTREAM_UNAVAILABLE';
    return unsupportedNative(mapping, code, failures[code].message, failures[code].retryable);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
