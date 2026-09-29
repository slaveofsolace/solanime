import type { StoredProviderMapping } from './contract.ts';

export type ProviderSupportState =
  | 'documented-embed-only'
  | 'download-only'
  | 'backend-unverified'
  | 'native-unverified';

export interface ProviderSupportDiagnostic {
  code:
    | 'PROVIDER_EMBED_ONLY'
    | 'DOWNLOAD_ONLY_SOURCE'
    | 'PROVIDER_BACKEND_UNVERIFIED'
    | 'NATIVE_INTEGRATION_UNAVAILABLE';
  message: string;
  retryable: false;
  state: ProviderSupportState;
}

const MEGAPLAY_EMBED_PROVIDERS = new Set(['vidstream-2', 'hd-1', 'hd-2']);

/**
 * Explains why a preserved source mapping cannot be offered by the native player.
 *
 * This is deliberately a closed provider-ID classification. Hostnames, labels and
 * resource strings cannot promote an unreviewed mapping to a supported capability.
 */
export function providerSupportDiagnostic(
  mapping: Pick<StoredProviderMapping, 'providerId'>,
): ProviderSupportDiagnostic {
  const providerId = mapping.providerId.trim().toLowerCase();
  if (MEGAPLAY_EMBED_PROVIDERS.has(providerId))
    return {
      code: 'PROVIDER_EMBED_ONLY',
      message:
        'This mapping has a documented provider-hosted iframe, but no verified native-media interface. Solanime’s native player does not load provider webpages.',
      retryable: false,
      state: 'documented-embed-only',
    };
  if (providerId === 'kiwi')
    return {
      code: 'DOWNLOAD_ONLY_SOURCE',
      message:
        'This mapping was observed as a download option, not as a supported streaming integration.',
      retryable: false,
      state: 'download-only',
    };
  if (providerId === 'vidplay-1')
    return {
      code: 'PROVIDER_BACKEND_UNVERIFIED',
      message:
        'The visible provider label is preserved, but its current backend and supported integration are not verified.',
      retryable: false,
      state: 'backend-unverified',
    };
  return {
    code: 'NATIVE_INTEGRATION_UNAVAILABLE',
    message: 'No verified native playback connection is available for this source.',
    retryable: false,
    state: 'native-unverified',
  };
}
