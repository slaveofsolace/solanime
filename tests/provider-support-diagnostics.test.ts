import { describe, expect, it } from 'vitest';
import { providerSupportDiagnostic } from '../server/providers/support-diagnostics.ts';

describe('provider support diagnostics', () => {
  it.each(['vidstream-2', 'hd-1', 'hd-2'])(
    'preserves %s as documented embed-only evidence without claiming native playback',
    (providerId) => {
      expect(providerSupportDiagnostic({ providerId })).toEqual({
        code: 'PROVIDER_EMBED_ONLY',
        message:
          'This mapping has a documented provider-hosted iframe, but no verified native-media interface. Solanime’s native player does not load provider webpages.',
        retryable: false,
        state: 'documented-embed-only',
      });
    },
  );

  it('distinguishes download-only, unresolved-backend and unknown mappings', () => {
    expect(providerSupportDiagnostic({ providerId: 'kiwi' })).toMatchObject({
      code: 'DOWNLOAD_ONLY_SOURCE',
      state: 'download-only',
    });
    expect(providerSupportDiagnostic({ providerId: 'vidplay-1' })).toMatchObject({
      code: 'PROVIDER_BACKEND_UNVERIFIED',
      state: 'backend-unverified',
    });
    expect(providerSupportDiagnostic({ providerId: 'future-source' })).toMatchObject({
      code: 'NATIVE_INTEGRATION_UNAVAILABLE',
      state: 'native-unverified',
    });
  });
});
