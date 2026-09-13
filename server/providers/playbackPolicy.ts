import { isMediaKind } from '../../shared/playback.ts';
import type { ProviderResolution, StoredProviderMapping } from './contract.ts';
import { providerSupportDiagnostic } from './support-diagnostics.ts';
import { sanitizeOfficialYouTubeResolution } from './youtubeOfficial.ts';
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

/**
 * Only native media crosses the application playback boundary.
 *
 * MegaPlay's documented page can be identified and resolved, but live browser
 * verification established that it refuses Solanime's restricted sandbox. The
 * unsandboxed form can open unrelated pages. Keep that mapping as evidence and
 * reject it here instead of advertising a non-working or unsafe player.
 */
export function enforcePlaybackResolution(
  mapping: StoredProviderMapping,
  value: ProviderResolution,
): ProviderResolution {
  if (value.kind === 'official-youtube')
    return sanitizeOfficialYouTubeResolution(mapping, value);
  if (value.kind === 'embed' || value.delivery === 'provider' || value.playbackType === 'iframe')
    return unsupportedSource(mapping);
  return enforceNativeResolution(mapping, value);
}
