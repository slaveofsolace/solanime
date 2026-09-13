import { describe, expect, it, vi } from 'vitest';
import { resolveInternetArchive, legacyResolution, boundedPublicJson, type ApprovedNativeResource } from '../server/providers/native.ts';
import type { StoredProviderMapping } from '../server/providers/contract.ts';

// Deterministic transport fixtures only; no test resource enters the catalogue.
const mapping: StoredProviderMapping = { mappingId: 22, providerId: 'internet-archive', label: 'Internet Archive', language: 'silent', providerResourceId: 'test-only-film', canonicalEmbedUrl: null, availability: 'available', unavailableReason: null };
const approved: ApprovedNativeResource = { mapping_id: 22, provider_id: 'internet-archive', resource_id: 'test-only-film', language: 'silent', edition: 'Test-only silent edition', license: 'test-only permission', rights_evidence_url: 'https://example.test/rights', identity_evidence_url: 'https://example.test/identity', approved_at: '2026-09-12T00:00:00Z', enabled: 1 };
const metadata = (extra: Record<string, unknown> = {}) => Response.json({ metadata: { identifier: 'test-only-film' }, files: [{ name: 'film.mp4', format: 'h.264 IA' }], ...extra });
const transport = (responses: Response[]) => vi.fn(async () => responses.shift()!) as unknown as typeof fetch;

describe('reviewed Internet Archive native adapter', () => {
  it('resolves stable item IDs through metadata and validated redirects without copying media', async () => {
    const fetcher = transport([metadata(), new Response(null, { status: 302, headers: { Location: 'https://dn720400.ca.archive.org/0/items/test-only-film/film.mp4' } }), new Response(null, { headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' } })]);
    const result = await resolveInternetArchive(mapping, approved, undefined, fetcher);
    expect(result).toMatchObject({ kind: 'native', mappingId: '22', language: 'silent', format: 'direct', mediaCrossOrigin: 'none', captions: [], capabilities: { seek: true, progressEvents: true, subtitles: false } });
    expect(vi.mocked(fetcher).mock.calls.map(call => call[1]?.method ?? 'GET')).toEqual(['GET', 'HEAD', 'HEAD']);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe('https://archive.org/metadata/test-only-film');
    expect(vi.mocked(fetcher).mock.calls[0][1]?.redirect).toBe('manual');
    if (result.kind !== 'native') throw new Error('Expected native result');
    expect(Date.parse(result.expiresAt!) - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(legacyResolution(result)).toMatchObject({ kind: 'native', delivery: 'native', attribution: { label: 'Internet Archive · Test-only silent edition' } });
  });
  it.each(['http://127.0.0.1/private', 'https://archive.org.evil.test/film', 'https://archive.org@evil.test/film', 'https://archive.org:444/film', 'https://other.archive.org/film'])('rejects unsafe redirect %s before making contact', async location => {
    const fetcher = transport([metadata(), new Response(null, { status: 302, headers: { Location: location } })]);
    expect(await resolveInternetArchive(mapping, approved, undefined, fetcher)).toMatchObject({ kind: 'unsupported', error: { code: 'UNSAFE_MEDIA_DESTINATION', retryable: false } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects approval and mapping identity conflicts without network traffic', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(await resolveInternetArchive(mapping, { ...approved, language: 'dub' }, undefined, fetcher)).toMatchObject({ error: { code: 'RESOURCE_IDENTITY_MISMATCH' } });
    expect(await resolveInternetArchive(mapping, { ...approved, enabled: 0 }, undefined, fetcher)).toMatchObject({ error: { code: 'RESOURCE_NOT_APPROVED' } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [{ metadata: { identifier: 'another-film' } }, 'UPSTREAM_SCHEMA_CHANGED'],
    [{ is_dark: true }, 'RESOURCE_RESTRICTED'],
    [{ files: [{ name: 'film.mp4', format: 'h.264 IA', private: true }] }, 'NATIVE_FORMAT_UNAVAILABLE'],
    [{ files: [{ name: '../film.mp4', format: 'h.264 IA' }] }, 'NATIVE_FORMAT_UNAVAILABLE'],
    [{ files: [] }, 'NATIVE_FORMAT_UNAVAILABLE'],
  ] as const)('preserves structured upstream failure %s', async (value, code) => {
    expect(await resolveInternetArchive(mapping, approved, undefined, transport([metadata(value)]))).toMatchObject({ kind: 'unsupported', error: { code } });
  });
  it('distinguishes access blocks, missing resources, malformed media and rate limits', async () => {
    for (const [status, code] of [[403, 'UPSTREAM_BLOCKED'], [404, 'RESOURCE_NOT_FOUND'], [429, 'UPSTREAM_RATE_LIMIT']] as const)
      expect(await resolveInternetArchive(mapping, approved, undefined, transport([new Response(null, { status })]))).toMatchObject({ kind: 'unsupported', error: { code } });
    expect(await resolveInternetArchive(mapping, approved, undefined, transport([metadata(), new Response(null, { headers: { 'Content-Type': 'text/html' } })]))).toMatchObject({ error: { code: 'MEDIA_TYPE_CHANGED' } });
  });
  it('bounds responses and propagates cancellation without returning a stale resolution', async () => {
    await expect(boundedPublicJson(new Response('{'.repeat(30), { headers: { 'Content-Type': 'application/json' } }), 20)).rejects.toThrow('UPSTREAM_RESPONSE_TOO_LARGE');
    const cancel = new AbortController();
    const fetcher: typeof fetch = async (_url, init) => {
      cancel.abort(new DOMException('Changed episode', 'AbortError'));
      init?.signal?.throwIfAborted();
      return metadata();
    };
    await expect(resolveInternetArchive(mapping, approved, cancel.signal, fetcher)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
