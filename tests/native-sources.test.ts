import { describe, it, expect } from 'vitest';
import {
  nativeSourceResolver,
  validateNativeSources,
  type NativeSource,
} from '../server/providers/nativeSources';
import type { StoredProviderMapping } from '../server/providers/contract';
const item: NativeSource = {
  mappingId: 1,
  language: 'sub',
  type: 'hls',
  url: 'https://media.example.com/one.m3u8',
  allowedHosts: ['media.example.com'],
};
const mapping: StoredProviderMapping = {
  mappingId: 1,
  providerId: 'hd-1',
  label: 'HD-1',
  language: 'sub',
  providerResourceId: 'test',
  canonicalEmbedUrl: null,
  availability: 'available',
  unavailableReason: null,
};
describe('built-in native source registration', () => {
  it('chooses a registered resource without loading a third-party player document', () => {
    const result = nativeSourceResolver([item])(mapping);
    expect(result).toMatchObject({
      playbackType: 'hls',
      delivery: 'native',
      status: 'resolved',
      url: item.url,
    });
    expect(result?.embedUrl).toBeUndefined();
  });
  it('does not invent a native resource for an unregistered mapping', () => {
    expect(nativeSourceResolver()(mapping)).toBeNull();
  });
  it('keeps expiry and language mismatches explicit', () => {
    expect(nativeSourceResolver([{ ...item, expiresAt: '2020-01-01' }])(mapping)?.status).toBe(
      'unavailable',
    );
    expect(nativeSourceResolver([item])({ ...mapping, language: 'dub' })?.status).toBe(
      'unavailable',
    );
  });
  it.each([
    'http://media.example.com/a',
    'https://user:pass@media.example.com/a',
    'https://127.0.0.1/a',
    'https://[::1]/a',
  ])('rejects unsafe source %s', (url) => {
    expect(() => validateNativeSources([{ ...item, url }])).toThrow();
  });
  it('requires exact allowed media hosts and unique mappings', () => {
    expect(() =>
      validateNativeSources([{ ...item, allowedHosts: ['other.example.com'] }]),
    ).toThrow();
    expect(() => validateNativeSources([item, item])).toThrow();
  });
});
