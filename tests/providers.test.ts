import { describe, expect, it } from 'vitest';
import { getProviderAdapter } from '../server/providers/adapters.ts';

describe('provider adapters', () => {
  for (const providerId of ['vidstream-2', 'hd-1', 'hd-2']) {
    it(`${providerId} accepts only its observed MegaPlay embed route`, async () => {
      const result = await getProviderAdapter(providerId).resolve({
        mappingId: 1,
        providerId,
        label: providerId,
        language: 'sub',
        providerResourceId: null,
        canonicalEmbedUrl: 'https://megaplay.buzz/stream/s-2/123/sub',
        availability: 'observed',
        unavailableReason: null,
      });
      expect(result).toMatchObject({
        kind: 'embed',
        status: 'resolved',
        delivery: 'provider',
        playbackType: 'iframe',
        allowedEmbedHosts: ['megaplay.buzz'],
        iframePolicy: {
          sandbox: ['allow-scripts', 'allow-same-origin', 'allow-presentation'],
          allow: ['autoplay', 'fullscreen'],
          referrerPolicy: 'no-referrer',
        },
        messageProtocol: {
          origin: 'https://megaplay.buzz',
          channel: 'megacloud',
          events: ['time', 'complete', 'error'],
          types: ['watching-log'],
        },
      });
    });
  }

  it('does not substitute media for an unsupported provider', async () => {
    const result = await getProviderAdapter('kiwi').resolve({
      mappingId: 2,
      providerId: 'kiwi',
      label: 'Kiwi',
      language: 'sub',
      providerResourceId: null,
      canonicalEmbedUrl: null,
      availability: 'observed',
      unavailableReason: null,
    });
    expect(result.status).toBe('unavailable');
    expect(result.embedUrl).toBeUndefined();
  });

  it('returns a structured unavailable result for an unapproved embed host', async () => {
    const result = await getProviderAdapter('hd-1').resolve({
      mappingId: 3,
      providerId: 'hd-1',
      label: 'HD-1',
      language: 'sub',
      providerResourceId: null,
      canonicalEmbedUrl: 'https://example.com/not-the-player',
      availability: 'observed',
      unavailableReason: null,
    });
    expect(result).toMatchObject({
      status: 'unsupported',
      error: { code: 'INVALID_PROVIDER_RESOURCE' },
    });
  });
});
