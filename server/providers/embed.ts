import type {
  EmbedCapabilities,
  EmbedIframePolicy,
  EmbedMessageProtocol,
  PlaybackResult,
} from '../../shared/playback.ts';
import type { StoredProviderMapping } from './contract.ts';

export const MEGAPLAY_EMBED_HOST = 'megaplay.buzz' as const;
export const MEGAPLAY_EMBED_ORIGIN = `https://${MEGAPLAY_EMBED_HOST}` as const;
export const MEGAPLAY_EMBED_PROVIDERS = ['vidstream-2', 'hd-1', 'hd-2'] as const;
const providerIds = new Set<string>(MEGAPLAY_EMBED_PROVIDERS);
const RESOURCE = /^[A-Za-z0-9+/_=-]{1,4096}$/;
const MAX_RESPONSE_BYTES = 64 * 1024;
const RESOLUTION_TTL_MS = 10 * 60_000;

export const MEGAPLAY_EMBED_CAPABILITIES: EmbedCapabilities = Object.freeze({
  fullscreen: true,
  progressEvents: true,
  completionEvents: true,
  errorEvents: true,
  seek: false,
  volume: false,
  subtitles: false,
  qualitySelection: false,
});
export const MEGAPLAY_IFRAME_POLICY: EmbedIframePolicy = Object.freeze({
  sandbox: [] as EmbedIframePolicy['sandbox'],
  allow: ['autoplay', 'fullscreen'] as EmbedIframePolicy['allow'],
  referrerPolicy: 'strict-origin-when-cross-origin',
  requiresGuard: true,
});
export const MEGAPLAY_MESSAGE_PROTOCOL: EmbedMessageProtocol = Object.freeze({
  origin: MEGAPLAY_EMBED_ORIGIN,
  channel: 'megacloud',
  events: ['time', 'complete', 'error'] as EmbedMessageProtocol['events'],
  types: ['watching-log'] as EmbedMessageProtocol['types'],
});

type EmbedMapping = Pick<
  StoredProviderMapping,
  | 'mappingId'
  | 'providerId'
  | 'language'
  | 'providerResourceId'
  | 'canonicalEmbedUrl'
  | 'availability'
  | 'unavailableReason'
>;

function unsupported(
  mapping: Pick<StoredProviderMapping, 'mappingId' | 'providerId' | 'language'>,
  code: string,
  message: string,
  retryable = false,
): PlaybackResult {
  return {
    kind: 'unsupported',
    mappingId: String(mapping.mappingId),
    providerId: mapping.providerId,
    language: mapping.language,
    error: { code, message, retryable },
  };
}

function matchesProviderSelector(url: URL, providerId: string): boolean {
  if (!url.search) return true;
  if (providerId === 'hd-1') return url.search === '?s=tcdn';
  if (providerId === 'hd-2') return url.search === '?s=bcdn';
  return false;
}

export function validateMegaPlayEmbedUrl(value: string, language: string, providerId = 'vidstream-2'): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('INVALID_PROVIDER_RESOURCE');
  }
  const match = /^\/stream\/s-2\/([0-9]{1,20})\/(sub|dub)\/?$/.exec(url.pathname);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== MEGAPLAY_EMBED_HOST ||
    url.username ||
    url.password ||
    url.port ||
    !matchesProviderSelector(url, providerId) ||
    url.hash ||
    !match ||
    match[2] !== language
  )
    throw new Error('INVALID_PROVIDER_RESOURCE');
  return url;
}

export function hasSupportedMegaPlayEmbed(mapping: EmbedMapping): boolean {
  if (!providerIds.has(mapping.providerId) || !['sub', 'dub'].includes(mapping.language)) return false;
  if (mapping.canonicalEmbedUrl) {
    try {
      validateMegaPlayEmbedUrl(mapping.canonicalEmbedUrl, mapping.language, mapping.providerId);
      return true;
    } catch {
      return false;
    }
  }
  return typeof mapping.providerResourceId === 'string' && RESOURCE.test(mapping.providerResourceId);
}

export function megaPlayEmbedResult(mapping: EmbedMapping, rawUrl: string): PlaybackResult {
  if (!providerIds.has(mapping.providerId) || !['sub', 'dub'].includes(mapping.language))
    throw new Error('INVALID_PROVIDER_RESOURCE');
  const url = validateMegaPlayEmbedUrl(rawUrl, mapping.language, mapping.providerId);
  return {
    kind: 'embed',
    mappingId: String(mapping.mappingId),
    providerId: mapping.providerId,
    language: mapping.language,
    format: 'iframe',
    embedUrl: url.href,
    allowedEmbedHosts: [MEGAPLAY_EMBED_HOST],
    capabilities: MEGAPLAY_EMBED_CAPABILITIES,
    iframePolicy: MEGAPLAY_IFRAME_POLICY,
    messageProtocol: MEGAPLAY_MESSAGE_PROTOCOL,
    expiresAt: new Date(Date.now() + RESOLUTION_TTL_MS).toISOString(),
  };
}

async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('UPSTREAM_RESPONSE_TOO_LARGE');
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Resolve an existing Anikoto server reference through its same public selection
 * endpoint. This returns only the provider's documented iframe URL. It never
 * follows the player, extracts media, supplies a forged Referrer/Origin, proxies
 * provider traffic, or accepts an arbitrary URL from the caller.
 */
export async function resolveMegaPlayEmbed(
  mapping: EmbedMapping,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<PlaybackResult> {
  if (!providerIds.has(mapping.providerId))
    return unsupported(mapping, 'PROVIDER_BACKEND_UNVERIFIED', 'This provider is not connected to the reviewed MegaPlay embed interface.');
  if (mapping.availability === 'blocked')
    return unsupported(mapping, 'PROVIDER_BLOCKED', mapping.unavailableReason || 'This provider mapping is blocked.');
  if (!['sub', 'dub'].includes(mapping.language))
    return unsupported(mapping, 'INCOMPATIBLE_VERSION', `MegaPlay embeds are not documented for the stored ${mapping.language} version.`);
  if (mapping.canonicalEmbedUrl) {
    try {
      return megaPlayEmbedResult(mapping, mapping.canonicalEmbedUrl);
    } catch {
      return unsupported(mapping, 'INVALID_PROVIDER_RESOURCE', 'The stored provider URL does not match the reviewed MegaPlay route and language.');
    }
  }
  if (!mapping.providerResourceId || !RESOURCE.test(mapping.providerResourceId))
    return unsupported(mapping, 'INVALID_STORED_RESOURCE', 'The stored Anikoto server reference is missing or malformed.');

  const timeout = AbortSignal.timeout(12_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const endpoint = new URL('/ajax/server', 'https://anikototv.to');
  endpoint.searchParams.set('get', mapping.providerResourceId);
  try {
    const response = await fetcher(endpoint, {
      redirect: 'manual',
      signal: combined,
      headers: {
        accept: 'application/json, text/javascript;q=0.9',
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return unsupported(mapping, 'UPSTREAM_REDIRECT', 'The Anikoto resolver unexpectedly redirected. The destination was not followed.');
    }
    if ([401, 403, 451].includes(response.status)) {
      await response.body?.cancel();
      return unsupported(mapping, 'UPSTREAM_BLOCKED', 'The public resolver declined this request; Solanime did not bypass the refusal.');
    }
    if (response.status === 429) {
      await response.body?.cancel();
      return unsupported(mapping, 'UPSTREAM_RATE_LIMIT', 'The public resolver requested fewer requests. Try again later.', true);
    }
    if (!response.ok) {
      await response.body?.cancel();
      return unsupported(mapping, 'UPSTREAM_UNAVAILABLE', `The public resolver returned HTTP ${response.status}.`, response.status >= 500);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      return unsupported(mapping, 'UPSTREAM_SCHEMA_CHANGED', 'The public resolver no longer returns JSON.');
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      return unsupported(mapping, 'UPSTREAM_RESPONSE_TOO_LARGE', 'The public resolver response exceeded the safe limit.');
    }
    let text: string;
    try {
      text = await boundedText(response);
    } catch (error) {
      if (error instanceof Error && error.message === 'UPSTREAM_RESPONSE_TOO_LARGE')
        return unsupported(mapping, 'UPSTREAM_RESPONSE_TOO_LARGE', 'The public resolver response exceeded the safe limit.');
      throw error;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return unsupported(mapping, 'UPSTREAM_SCHEMA_CHANGED', 'The public resolver returned malformed JSON.');
    }
    const record = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
    const result = record?.result && typeof record.result === 'object' && !Array.isArray(record.result)
      ? record.result as Record<string, unknown>
      : null;
    if (record?.status !== 200 || typeof result?.url !== 'string')
      return unsupported(mapping, 'UPSTREAM_SCHEMA_CHANGED', 'The public resolver response no longer contains the documented embed destination.');
    try {
      return megaPlayEmbedResult(mapping, result.url);
    } catch {
      return unsupported(mapping, 'INVALID_PROVIDER_RESOURCE', 'The resolver destination does not match the reviewed MegaPlay route and language.');
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
    const timedOut = timeout.aborted || (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name));
    return unsupported(
      mapping,
      timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
      timedOut ? 'The public resolver did not respond before the timeout.' : 'The public resolver could not be reached.',
      true,
    );
  }
}
