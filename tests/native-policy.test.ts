import { describe, it, expect } from 'vitest';
import { enforceNativeResolution } from '../server/providers/playbackPolicy';
import { mediaIsSupported, playbackUrl } from '../src/lib/playerPolicy';
import type { StoredProviderMapping, ProviderResolution } from '../server/providers/contract';
const mapping: StoredProviderMapping = {
  mappingId: 1,
  providerId: 'hd-1',
  label: 'Test',
  language: 'sub',
  providerResourceId: null,
  canonicalEmbedUrl: null,
  availability: 'available',
  unavailableReason: null,
};
const source: ProviderResolution = {
  mappingId: 1,
  providerId: 'hd-1',
  delivery: 'native',
  playbackType: 'direct',
  url: 'https://media.example.test/owned.mp4',
  status: 'resolved',
};
describe('native-only contract', () => {
  it.each(['iframe', 'external', 'unknown'])('rejects %s at both client and server', (type) => {
    const changed = { ...source, playbackType: type } as ProviderResolution;
    expect(enforceNativeResolution(mapping, changed).status).toBe('unsupported');
    expect(mediaIsSupported(changed, 'https://solanime.test')).toBe(false);
  });
  it('rejects mismatched mapping identities', () => {
    expect(enforceNativeResolution(mapping, { ...source, mappingId: 2 }).status).toBe(
      'unsupported',
    );
    expect(enforceNativeResolution(mapping, { ...source, providerId: 'different' }).status).toBe(
      'unsupported',
    );
  });
  it('strips webpage and private header fields from native resolutions', () => {
    const result = enforceNativeResolution(mapping, {
      ...source,
      embedUrl: 'https://unwanted.test',
      headers: { Authorization: 'private' },
    });
    expect(result.status).toBe('resolved');
    expect(result.embedUrl).toBeUndefined();
    expect(result.headers).toBeUndefined();
  });
  it('never renders a resolver URL without a native delivery contract', () =>
    expect(mediaIsSupported({ ...source, delivery: undefined }, 'https://solanime.test')).toBe(
      false,
    ));
  it('accepts an absolute media URL independently of a relative base', () => {
    expect(playbackUrl(source.url!, 'direct', 'null')).toBe(source.url);
    expect(playbackUrl('/video.mp4', 'direct', 'null')).toBeNull();
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    'https://user:pass@media.test/one.mp4',
    'http://foreign.test/one.mp4',
  ])('refuses unsafe direct resource %s', (url) =>
    expect(playbackUrl(url, 'direct', 'https://solanime.test')).toBeNull(),
  );
});
