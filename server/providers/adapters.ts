import { AppError } from '../errors.ts';
import { validateEmbedUrl } from '../security.ts';
import type { ProviderAdapter, ProviderCapabilities, ProviderResolution, StoredProviderMapping } from './contract.ts';
import { NO_CAPABILITIES } from './contract.ts';
import type { PlaybackType } from '../types.ts';
import { AnikotoSourceClient, SourceRequestError } from '../ingestion/source.ts';

class UnavailableProviderAdapter implements ProviderAdapter {
  readonly capabilities = NO_CAPABILITIES;
  readonly compatibleLanguages = 'all' as const;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly aliases: readonly string[],
    readonly playbackType: PlaybackType,
    private readonly reason: string,
  ) {}

  mapResource(mapping: StoredProviderMapping) {
    return { resourceId: mapping.providerResourceId, embedUrl: mapping.canonicalEmbedUrl };
  }

  async resolve(mapping: StoredProviderMapping): Promise<ProviderResolution> {
    return {
      mappingId: mapping.mappingId,
      providerId: this.id,
      playbackType: this.playbackType,
      status: mapping.availability === 'blocked' ? 'blocked' : 'unavailable',
      error: {
        code: mapping.availability === 'blocked' ? 'PROVIDER_BLOCKED' : 'UNVERIFIED_PROVIDER_CONNECTION',
        message: mapping.unavailableReason || this.reason,
      },
    };
  }
}

const EMBED_CAPABILITIES: ProviderCapabilities = Object.freeze({
  embed: true,
  seek: false,
  volume: false,
  fullscreen: true,
  subtitles: false,
  qualitySelection: false,
  progressEvents: false,
});

const resolutionClient = new AnikotoSourceClient();

class AnikotoMegaPlayEmbedAdapter implements ProviderAdapter {
  readonly playbackType = 'iframe' as const;
  readonly capabilities = EMBED_CAPABILITIES;
  readonly compatibleLanguages = ['sub', 'dub'] as const;

  constructor(readonly id: string, readonly label: string, readonly aliases: readonly string[]) {}

  mapResource(mapping: StoredProviderMapping) {
    return { resourceId: mapping.providerResourceId, embedUrl: mapping.canonicalEmbedUrl };
  }

  async resolve(mapping: StoredProviderMapping, signal?: AbortSignal): Promise<ProviderResolution> {
    if (signal?.aborted) throw new DOMException('Resolution cancelled', 'AbortError');
    if (mapping.availability === 'blocked') return { mappingId: mapping.mappingId, providerId: this.id, playbackType: this.playbackType, status: 'blocked', error: { code: 'PROVIDER_BLOCKED', message: mapping.unavailableReason || 'This mapping is blocked.' } };
    if (!this.compatibleLanguages.some((language) => language === mapping.language)) return { mappingId: mapping.mappingId, providerId: this.id, playbackType: this.playbackType, status: 'unavailable', error: { code: 'INCOMPATIBLE_VERSION', message: `${this.label} is not verified for the stored ${mapping.language} version.` } };
    let rawUrl = mapping.canonicalEmbedUrl;
    if (!rawUrl) {
      const resource = mapping.providerResourceId;
      if (!resource || resource.length > 4096 || !/^[A-Za-z0-9+/_=-]+$/.test(resource)) {
        return { mappingId: mapping.mappingId, providerId: this.id, playbackType: this.playbackType, status: 'unavailable', error: { code: 'INVALID_STORED_RESOURCE', message: 'The stored provider reference is missing or malformed.' } };
      }
      try {
        const payload = await resolutionClient.json<{ status?: unknown; result?: unknown }>(`/ajax/server?get=${encodeURIComponent(resource)}`, signal);
        const result = payload.result && typeof payload.result === 'object' ? payload.result as Record<string, unknown> : null;
        if (payload.status !== 200 || typeof result?.url !== 'string') {
          return { mappingId: mapping.mappingId, providerId: this.id, playbackType: this.playbackType, status: 'unavailable', error: { code: 'UPSTREAM_RESOLUTION_CHANGED', message: 'The public resolver did not return the observed URL response shape.' } };
        }
        rawUrl = result.url;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        const blocked = error instanceof SourceRequestError && error.code === 'BLOCKED';
        return { mappingId: mapping.mappingId, providerId: this.id, playbackType: this.playbackType, status: blocked ? 'blocked' : 'unavailable', error: { code: blocked ? 'UPSTREAM_BLOCKED' : 'UPSTREAM_RESOLUTION_FAILED', message: error instanceof Error ? error.message : 'The public resolver request failed.' } };
      }
    }
    let url: URL;
    try { url = validateEmbedUrl(rawUrl, ['megaplay.buzz']); }
    catch (error) { return { mappingId: mapping.mappingId, providerId: this.id, playbackType: this.playbackType, status: 'unavailable', error: { code: 'INVALID_PROVIDER_RESOURCE', message: error instanceof Error ? error.message : 'The provider returned an unapproved embed URL.' } }; }
    if (!url.pathname.startsWith('/stream/s-2/')) return { mappingId: mapping.mappingId, providerId: this.id, playbackType: this.playbackType, status: 'unavailable', error: { code: 'INVALID_PROVIDER_RESOURCE', message: `${this.label} does not match the currently observed MegaPlay embed route.` } };
    return { mappingId: mapping.mappingId, providerId: this.id, playbackType: this.playbackType, embedUrl: url.toString(), status: 'resolved' };
  }
}

const visibleBackendUnknown = 'The visible source label is confirmed, but its current backend and supported integration are not established.';

const ADAPTERS: ReadonlyMap<string, ProviderAdapter> = new Map<string, ProviderAdapter>([
  ['vidstream-2', new AnikotoMegaPlayEmbedAdapter('vidstream-2', 'Vidstream-2', ['Vidstream-2'])],
  ['hd-1', new AnikotoMegaPlayEmbedAdapter('hd-1', 'HD-1', ['HD-1'])],
  ['hd-2', new AnikotoMegaPlayEmbedAdapter('hd-2', 'HD-2', ['HD-2'])],
  ['vidplay-1', new UnavailableProviderAdapter('vidplay-1', 'VidPlay-1', ['VidPlay-1'], 'unknown', visibleBackendUnknown)],
  ['kiwi', new UnavailableProviderAdapter('kiwi', 'Kiwi', ['Kiwi'], 'download', 'Kiwi is observed as a download/source label; no supported application integration is established.')],
]);

export function getProviderAdapter(providerId: string): ProviderAdapter {
  const adapter = ADAPTERS.get(providerId);
  if (!adapter) throw new AppError(422, 'UNAVAILABLE', 'No adapter is registered for this provider.', { providerId });
  return adapter;
}

export function listProviderAdapters(): ProviderAdapter[] {
  return [...ADAPTERS.values()];
}
