import type { PlaybackResult, NativeCapabilities } from '../../shared/playback.ts';
import type { StoredProviderMapping, ProviderResolution } from './contract.ts';
import { providerSupportDiagnostic } from './support-diagnostics.ts';

export type ApprovedNativeResource = {
  mapping_id: number;
  provider_id: string;
  resource_id: string;
  language: string;
  edition: string;
  license: string;
  rights_evidence_url: string;
  identity_evidence_url: string;
  approved_at: string;
  enabled: number;
  content_sha1?: string | null;
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nativeCapabilities: NativeCapabilities = { seek: true, volume: true, fullscreen: true, progressEvents: true, subtitles: false, qualitySelection: false };
type NativeMappingIdentity = Pick<StoredProviderMapping, 'mappingId' | 'providerId' | 'providerResourceId' | 'language'>;
function evidenceUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.port; } catch { return false; }
}
/** The selector and resolver must apply the same identity and rights gate. */
function approvalError(mapping: NativeMappingIdentity, resource: ApprovedNativeResource): 'RESOURCE_IDENTITY_MISMATCH' | 'RESOURCE_NOT_APPROVED' | 'INVALID_RESOURCE_ID' | null {
  if (mapping.providerId !== 'internet-archive' || resource.provider_id !== mapping.providerId || resource.mapping_id !== mapping.mappingId || resource.resource_id !== mapping.providerResourceId || resource.language !== mapping.language) return 'RESOURCE_IDENTITY_MISMATCH';
  if (resource.enabled !== 1 || !Number.isFinite(Date.parse(resource.approved_at)) || !resource.license.trim() || !evidenceUrl(resource.rights_evidence_url) || !evidenceUrl(resource.identity_evidence_url)) return 'RESOURCE_NOT_APPROVED';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(resource.resource_id)) return 'INVALID_RESOURCE_ID';
  return null;
}
export function hasApprovedNativeResource(mapping: NativeMappingIdentity, resource: ApprovedNativeResource | null | undefined): boolean {
  return !!resource && approvalError(mapping, resource) === null;
}
export function unsupportedNative(mapping: StoredProviderMapping, code?: string, message?: string, retryable?: boolean): PlaybackResult {
  const diagnostic = providerSupportDiagnostic(mapping);
  return { kind: 'unsupported', mappingId: String(mapping.mappingId), providerId: mapping.providerId, language: mapping.language, error: { code: code ?? diagnostic.code, message: message ?? diagnostic.message, retryable: retryable ?? diagnostic.retryable } };
}
export async function boundedPublicJson(response: Response, maxBytes = 1024 * 1024): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(response.status === 429 ? 'UPSTREAM_RATE_LIMIT' : response.status === 403 ? 'UPSTREAM_BLOCKED' : response.status === 404 ? 'RESOURCE_NOT_FOUND' : 'UPSTREAM_UNAVAILABLE');
  }
  if (!response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw new Error('UPSTREAM_SCHEMA_CHANGED'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('UPSTREAM_EMPTY_RESPONSE');
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('UPSTREAM_RESPONSE_TOO_LARGE'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('UPSTREAM_SCHEMA_CHANGED'); }
}
function archiveUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !(url.hostname === 'archive.org' || /^(?:ia|dn)\d{6,}\.(?:us|ca|eu)\.archive\.org$/.test(url.hostname))) throw new Error('UNSAFE_MEDIA_DESTINATION');
  return url;
}

/** Resolves only explicitly reviewed public-domain/licensed catalogue mappings.
 * Item IDs are stable; media filenames and redirects are obtained afresh from the
 * documented metadata API. No iframe, captured-token replay or arbitrary proxy. */
export async function resolveInternetArchive(mapping: StoredProviderMapping, resource: ApprovedNativeResource, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<PlaybackResult> {
  const invalid = approvalError(mapping, resource);
  if (invalid) return unsupportedNative(mapping, invalid, invalid === 'RESOURCE_IDENTITY_MISMATCH' ? 'The approved resource does not match this episode version.' : invalid === 'INVALID_RESOURCE_ID' ? 'The stored archive identifier is invalid.' : 'This resource has not been approved for native playback.');
  const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
  try {
    const metadata = await boundedPublicJson(await fetcher(`https://archive.org/metadata/${encodeURIComponent(resource.resource_id)}`, { signal: abort, redirect: 'manual', headers: { Accept: 'application/json' } }));
    if (!object(metadata) || !object(metadata.metadata) || metadata.metadata.identifier !== resource.resource_id || !Array.isArray(metadata.files)) throw new Error('UPSTREAM_SCHEMA_CHANGED');
    if (metadata.is_dark || metadata.metadata.access_restricted === true || metadata.metadata.access_restricted === 'true') throw new Error('RESOURCE_RESTRICTED');
    const files = metadata.files.filter(object).filter(file => typeof file.name === 'string' && !file.private && /\.mp4$/i.test(file.name) && ['h.264 IA', 'MPEG4', 'h.264'].includes(String(file.format)));
    files.sort((a, b) => Number(String(b.format).toLowerCase() === 'h.264 ia') - Number(String(a.format).toLowerCase() === 'h.264 ia'));
    const name = files[0]?.name;
    if (typeof name !== 'string' || /[\x00-\x1f\\]/.test(name) || name.split('/').some(part => part === '..' || part === '.')) throw new Error('NATIVE_FORMAT_UNAVAILABLE');
    let url = archiveUrl(`https://archive.org/download/${encodeURIComponent(resource.resource_id)}/${name.split('/').map(encodeURIComponent).join('/')}`);
    const allowedHosts = new Set<string>([url.hostname]);
    // Validate every ordinary redirect before contacting its destination. HEAD
    // probes content type and ranges without copying the film into our service.
    for (let redirects = 0; ; redirects++) {
      const response = await fetcher(url, { method: 'HEAD', redirect: 'manual', signal: abort });
      await response.body?.cancel();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= 3 || !response.headers.get('location')) throw new Error('MEDIA_REDIRECT_LIMIT');
        url = archiveUrl(new URL(response.headers.get('location')!, url).href); allowedHosts.add(url.hostname); continue;
      }
      if (!response.ok) throw new Error(response.status === 403 ? 'MEDIA_RESTRICTED' : response.status === 404 ? 'MEDIA_NOT_FOUND' : 'MEDIA_UNAVAILABLE');
      if (!/^video\/mp4(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('MEDIA_TYPE_CHANGED');
      break;
    }
    return { kind: 'native', mappingId: String(mapping.mappingId), providerId: mapping.providerId, language: mapping.language, format: 'direct', url: url.href, allowedMediaHosts: [...allowedHosts], mediaCrossOrigin: 'none', capabilities: nativeCapabilities, captions: [], expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), attribution: { label: `Internet Archive · ${resource.edition}`, url: `https://archive.org/details/${resource.resource_id}`, license: resource.license } };
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
    const timeout = abort.aborted || (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError'));
    const code = timeout ? 'UPSTREAM_TIMEOUT' : error instanceof Error ? error.message : 'UPSTREAM_UNAVAILABLE';
    const known = /^[A-Z_]+$/.test(code) ? code : 'UPSTREAM_UNAVAILABLE';
    return unsupportedNative(mapping, known, known === 'UPSTREAM_BLOCKED' || known === 'RESOURCE_RESTRICTED' || known === 'MEDIA_RESTRICTED' ? 'The archive restricts this resource. Solanime does not bypass that restriction.' : known === 'UPSTREAM_TIMEOUT' ? 'The archive did not respond before the playback-resolution timeout. Try again.' : 'The archive could not supply a supported media resource. Try again later.', !['RESOURCE_RESTRICTED', 'MEDIA_RESTRICTED', 'UPSTREAM_BLOCKED', 'UNSAFE_MEDIA_DESTINATION', 'UPSTREAM_SCHEMA_CHANGED', 'NATIVE_FORMAT_UNAVAILABLE'].includes(known));
  }
}

/** Transitional fields keep existing local clients compatible with the stricter contract. */
export function legacyResolution(result: PlaybackResult): ProviderResolution & { result: PlaybackResult } {
  const base = { mappingId: Number(result.mappingId), providerId: result.providerId, kind: result.kind, result };
  if (result.kind === 'native')
    return { ...base, status: 'resolved', playbackType: result.format, delivery: 'native', url: result.url, allowedMediaHosts: result.allowedMediaHosts, mediaCrossOrigin: result.mediaCrossOrigin, captions: result.captions, attribution: result.attribution, expiresAt: result.expiresAt ?? undefined };
  if (result.kind === 'embed')
    return { ...base, status: 'resolved', playbackType: 'iframe', delivery: 'provider', embedUrl: result.embedUrl, allowedEmbedHosts: result.allowedEmbedHosts, capabilities: result.capabilities, iframePolicy: result.iframePolicy, messageProtocol: result.messageProtocol, expiresAt: result.expiresAt ?? undefined };
  if (result.kind === 'official-youtube')
    return { ...base, status: 'resolved', playbackType: 'iframe', delivery: 'provider', videoId: result.videoId, allowedEmbedHosts: result.allowedEmbedHosts, capabilities: result.capabilities, publisher: result.publisher, attribution: result.attribution };
  return { ...base, status: 'unsupported', playbackType: 'unknown', error: result.error };
}
