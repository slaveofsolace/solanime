import { describe, expect, it } from 'vitest';
import { parseResolverPayload } from '../server/ingestion/episodeSourceResolution.ts';

describe('episode source resolution', () => {
  it('accepts only the matching provider route and language', () => {
    expect(parseResolverPayload({ status: 200, result: { url: 'https://megaplay.buzz/stream/s-2/169915/sub?s=tcdn' } }, 'sub', 'hd-1'))
      .toBe('https://megaplay.buzz/stream/s-2/169915/sub?s=tcdn');
    expect(() => parseResolverPayload({ status: 200, result: { url: 'https://evil.example/stream/s-2/169915/sub?s=tcdn' } }, 'sub', 'hd-1'))
      .toThrow('INVALID_PROVIDER_RESOURCE');
    expect(() => parseResolverPayload({ status: 200, result: { url: 'https://megaplay.buzz/stream/s-2/169915/dub?s=tcdn' } }, 'sub', 'hd-1'))
      .toThrow('INVALID_PROVIDER_RESOURCE');
  });

  it('rejects malformed resolver payloads', () => {
    expect(() => parseResolverPayload({ status: 500 }, 'sub', 'vidstream-2')).toThrow('UPSTREAM_SCHEMA_CHANGED');
  });
});
