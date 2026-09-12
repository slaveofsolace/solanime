import { isMediaKind, UNSUPPORTED_SOURCE } from '../../shared/playback.ts';
import type { ProviderResolution, StoredProviderMapping } from './contract.ts';
export function unsupportedSource(
  mapping: Pick<StoredProviderMapping, 'mappingId' | 'providerId'>,
): ProviderResolution {
  return {
    mappingId: mapping.mappingId,
    providerId: mapping.providerId,
    playbackType: 'unknown',
    status: 'unsupported',
    error: { code: 'UNSUPPORTED_SOURCE', message: UNSUPPORTED_SOURCE },
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
