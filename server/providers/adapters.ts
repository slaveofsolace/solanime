import { AppError } from '../errors.ts';
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderResolution,
  StoredProviderMapping,
} from './contract.ts';
import { NO_CAPABILITIES } from './contract.ts';
import type { PlaybackType } from '../types.ts';
import { resolveMegaPlayEmbed } from './embed.ts';
import { legacyResolution } from './native.ts';

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
        code:
          mapping.availability === 'blocked'
            ? 'PROVIDER_BLOCKED'
            : 'UNVERIFIED_PROVIDER_CONNECTION',
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

class AnikotoMegaPlayEmbedAdapter implements ProviderAdapter {
  readonly playbackType = 'iframe' as const;
  readonly capabilities = EMBED_CAPABILITIES;
  readonly compatibleLanguages = ['sub', 'dub'] as const;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly aliases: readonly string[],
  ) {}

  mapResource(mapping: StoredProviderMapping) {
    return { resourceId: mapping.providerResourceId, embedUrl: mapping.canonicalEmbedUrl };
  }

  async resolve(mapping: StoredProviderMapping, signal?: AbortSignal): Promise<ProviderResolution> {
    return legacyResolution(await resolveMegaPlayEmbed(mapping, signal));
  }
}

const visibleBackendUnknown =
  'The visible source label is confirmed, but its current backend and supported integration are not established.';

const ADAPTERS: ReadonlyMap<string, ProviderAdapter> = new Map<string, ProviderAdapter>([
  ['vidstream-2', new AnikotoMegaPlayEmbedAdapter('vidstream-2', 'Vidstream-2', ['Vidstream-2'])],
  ['hd-1', new AnikotoMegaPlayEmbedAdapter('hd-1', 'HD-1', ['HD-1'])],
  ['hd-2', new AnikotoMegaPlayEmbedAdapter('hd-2', 'HD-2', ['HD-2'])],
  [
    'vidplay-1',
    new UnavailableProviderAdapter(
      'vidplay-1',
      'VidPlay-1',
      ['VidPlay-1'],
      'unknown',
      visibleBackendUnknown,
    ),
  ],
  [
    'kiwi',
    new UnavailableProviderAdapter(
      'kiwi',
      'Kiwi',
      ['Kiwi'],
      'download',
      'Kiwi is observed as a download/source label; no supported application integration is established.',
    ),
  ],
]);

export function getProviderAdapter(providerId: string): ProviderAdapter {
  const adapter = ADAPTERS.get(providerId);
  if (!adapter)
    throw new AppError(422, 'UNAVAILABLE', 'No adapter is registered for this provider.', {
      providerId,
    });
  return adapter;
}

export function listProviderAdapters(): ProviderAdapter[] {
  return [...ADAPTERS.values()];
}
