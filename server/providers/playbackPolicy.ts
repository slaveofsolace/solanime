import { isMediaKind } from '../../shared/playback.ts';
import type { ProviderResolution, StoredProviderMapping } from './contract.ts';
import { providerSupportDiagnostic } from './support-diagnostics.ts';
import { sanitizeOfficialYouTubeResolution } from './youtubeOfficial.ts';
import { legacyResolution } from './native.ts';
import { hasSupportedMegaPlayEmbed, megaPlayEmbedResult } from './embed.ts';
export function unsupportedSource(
  mapping: Pick<StoredProviderMapping, 'mappingId' | 'providerId'>,
): ProviderResolution {
  const diagnostic = providerSupportDiagnostic(mapping);
  return {
    kind: 'unsupported',
    mappingId: mapping.mappingId,
    providerId: mapping.providerId,
    playbackType: diagnostic.state === 'documented-embed-only' ? 'iframe' : 'unknown',
    status: 'unsupported',
    error: {
      code: diagnostic.code,
      message: diagnostic.message,
      retryable: diagnostic.retryable,
    },
  };
}
/** A resolver extension cannot accidentally restore legacy iframe fallback. */
export function enforceNativeResolution(
  mapping: StoredProviderMapping,
  value: ProviderResolution,
): ProviderResolution {
  if (value.status !== 'resolved')
    return { ...value, url: undefined, embedUrl: undefined, headers: undefined };
  if (
    value.delivery !== 'native' ||
    !isMediaKind(value.playbackType) ||
    !value.url ||
    value.mappingId !== mapping.mappingId ||
    value.providerId !== mapping.providerId
  )
    return unsupportedSource(mapping);
  return { ...value, embedUrl: undefined, headers: undefined };
}

export function enforcePlaybackResolution(
  mapping: StoredProviderMapping,
  value: ProviderResolution,
): ProviderResolution {
  if (value.kind === 'official-youtube')
    return sanitizeOfficialYouTubeResolution(mapping, value);
  if (value.kind === 'embed' || value.delivery === 'provider' || value.playbackType === 'iframe') {
    if (
      value.kind !== 'embed' ||
      value.status !== 'resolved' ||
      value.delivery !== 'provider' ||
      value.playbackType !== 'iframe' ||
      value.mappingId !== mapping.mappingId ||
      value.providerId !== mapping.providerId ||
      !value.embedUrl ||
      !hasSupportedMegaPlayEmbed(mapping)
    ) return unsupportedSource(mapping);
    try {
      const canonical = mapping.canonicalEmbedUrl
        ? new URL(mapping.canonicalEmbedUrl).href
        : null;
      if (canonical && new URL(value.embedUrl).href !== canonical) return unsupportedSource(mapping);
      return legacyResolution(megaPlayEmbedResult(mapping, value.embedUrl));
    } catch {
      return unsupportedSource(mapping);
    }
  }
  return enforceNativeResolution(mapping, value);
}
