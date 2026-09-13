import { isMediaKind } from '../../shared/playback.ts';
import type { ProviderResolution, StoredProviderMapping } from './contract.ts';
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
