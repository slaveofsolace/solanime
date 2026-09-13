import { isMediaKind } from '../../shared/playback.ts';
import type { ProviderResolution, StoredProviderMapping } from './contract.ts';
import { megaPlayEmbedResult, validateMegaPlayEmbedUrl } from './embed.ts';
import { legacyResolution } from './native.ts';
import { providerSupportDiagnostic } from './support-diagnostics.ts';
export function unsupportedSource(
  mapping: Pick<StoredProviderMapping, 'mappingId' | 'providerId'>,
): ProviderResolution {
  const diagnostic = providerSupportDiagnostic(mapping);
  return {
    mappingId: mapping.mappingId,
    providerId: mapping.providerId,
    playbackType: 'unknown',
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

/** Only the reviewed MegaPlay embed contract may cross the provider-page boundary. */
export function enforcePlaybackResolution(
  mapping: StoredProviderMapping,
  value: ProviderResolution,
): ProviderResolution {
  if (value.kind !== 'embed' && value.delivery !== 'provider')
    return enforceNativeResolution(mapping, value);
  if (
    value.status !== 'resolved' ||
    value.kind !== 'embed' ||
    value.delivery !== 'provider' ||
    value.playbackType !== 'iframe' ||
    !value.embedUrl ||
    value.mappingId !== mapping.mappingId ||
    value.providerId !== mapping.providerId ||
    value.result?.kind !== 'embed' ||
    value.result.mappingId !== String(mapping.mappingId) ||
    value.result.providerId !== mapping.providerId ||
    value.result.language !== mapping.language ||
    value.result.embedUrl !== value.embedUrl
  )
    return unsupportedSource(mapping);
  try {
    validateMegaPlayEmbedUrl(value.embedUrl, mapping.language, mapping.providerId);
    // Rebuild all policy fields locally rather than trusting an extension or
    // upstream response to widen iframe permissions or accepted message origins.
    return legacyResolution(megaPlayEmbedResult(mapping, value.embedUrl));
  } catch {
    return unsupportedSource(mapping);
  }
}
