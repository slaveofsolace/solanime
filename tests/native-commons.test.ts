import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMONS_PROVIDER_ALIASES, COMMONS_PROVIDER_ID, COMMONS_USER_AGENT, hasApprovedCommonsResource, resolveWikimediaCommons } from '../server/providers/commons.ts';
import type { ApprovedNativeResource } from '../server/providers/native.ts';
import type { StoredProviderMapping } from '../server/providers/contract.ts';

// Deterministic transport fixtures only. This file creates no production records
// and its fictional filename is never substituted for a real catalogue episode.
const title = "File:Test-only animator's silent film.webm";
const original = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Test-only_animator%27s_silent_film.webm';
const mapping: StoredProviderMapping = { mappingId: 70, providerId: COMMONS_PROVIDER_ID, label: 'Wikimedia Commons',
  language: 'silent', providerResourceId: title, canonicalEmbedUrl: null, availability: 'available', unavailableReason: null };
const approved: ApprovedNativeResource = { mapping_id: 70, provider_id: COMMONS_PROVIDER_ID, resource_id: title,
  language: 'silent', edition: 'Test-only silent edition', license: 'Public domain — test fixture',
  rights_evidence_url: 'https://commons.wikimedia.org/wiki/File:Test-only_animator%27s_silent_film.webm',
  identity_evidence_url: 'https://example.test/test-only-identity', approved_at: '2026-09-12T00:00:00Z', enabled: 1, content_sha1: 'a'.repeat(40) };
const rights = () => ({ LicenseShortName: { value: 'Public domain' }, UsageTerms: { value: 'Public domain' },
  Copyrighted: { value: 'False' }, Restrictions: { value: '' }, License: { value: 'pd' } });
const info = (patch: Record<string, unknown> = {}) => ({ canonicaltitle: title, mime: 'video/webm', size: 1000,
  url: original + '?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original', sha1: 'a'.repeat(40), extmetadata: rights(), ...patch });
const page = (patch: Record<string, unknown> = {}) => ({ pageid: 123, ns: 6, title, imageinfo: [info()], ...patch });
const metadata = (patch: Record<string, unknown> = {}) => Response.json({ query: { pages: [page(patch)] } });
const head = (headers: Record<string, string> = {}) => new Response(null, { headers: {
  'content-type': 'video/webm', 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', ...headers,
} });
const transport = (responses: Response[]) => vi.fn<typeof fetch>(async () => {
  const response = responses.shift(); if (!response) throw Error('Unexpected test request'); return response;
});
afterEach(() => vi.useRealTimers());

describe('reviewed Wikimedia Commons native adapter', () => {
  it('resolves a stable File title through the fixed imageinfo API and anonymous HEAD, without tracking or copied media', async () => {
    const fetcher = transport([metadata(), head()]);
    const result = await resolveWikimediaCommons(mapping, approved, undefined, fetcher);
    expect(hasApprovedCommonsResource(mapping, approved)).toBe(true);
    expect(COMMONS_PROVIDER_ALIASES).toContain('Commons');
    expect(result).toMatchObject({ kind: 'native', mappingId: '70', providerId: 'wikimedia-commons', language: 'silent',
      format: 'direct', url: original, mediaCrossOrigin: 'anonymous', allowedMediaHosts: ['upload.wikimedia.org'],
      captions: [], capabilities: { seek: true, progressEvents: true, subtitles: false, qualitySelection: false },
      attribution: { label: 'Wikimedia Commons · Test-only silent edition', url: approved.rights_evidence_url } });
    expect(fetcher.mock.calls.map(call => call[1]?.method ?? 'GET')).toEqual(['GET', 'HEAD']);
    const request = new URL(String(fetcher.mock.calls[0][0]));
    expect(request.origin + request.pathname).toBe('https://commons.wikimedia.org/w/api.php');
    expect(Object.fromEntries(request.searchParams)).toEqual({ action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo',
      iiprop: 'url|mime|size|extmetadata|sha1|canonicaltitle', titles: title });
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.redirect).toBe('manual');
      expect(new Headers(init?.headers).get('authorization')).toBeNull();
      expect(new Headers(init?.headers).get('cookie')).toBeNull();
      expect(new Headers(init?.headers).get('user-agent')).toBe(COMMONS_USER_AGENT);
      expect(init?.body).toBeUndefined();
    }
    expect(COMMONS_USER_AGENT).toMatch(/^Solanime\/[^\s]+ \(https:\/\/solanime\.pages\.dev;/);
    expect(COMMONS_USER_AGENT).not.toMatch(/Mozilla|Chrome|Safari|Googlebot/);
    expect(String(fetcher.mock.calls[1][0])).toBe(original);
    if (result.kind !== 'native') throw Error('Expected native test result');
    expect(Date.parse(result.expiresAt!) - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(JSON.stringify(result)).not.toMatch(/utm_|captured|iframe/);
  });

  it('preserves only MediaWiki underscore/space aliases and validates every bounded redirect before contacting it', async () => {
    const fetcher = transport([metadata(), new Response(null, { status: 302, headers: { location: original + '?utm_source=test' } }), head()]);
    expect(await resolveWikimediaCommons({ ...mapping, providerResourceId: title.replaceAll(' ', '_') }, approved, undefined, fetcher))
      .toMatchObject({ kind: 'native', url: original });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([
    [{ mapping_id: 71 }, 'RESOURCE_IDENTITY_MISMATCH'], [{ provider_id: 'internet-archive' }, 'RESOURCE_IDENTITY_MISMATCH'],
    [{ resource_id: 'File:Another edition.webm' }, 'RESOURCE_IDENTITY_MISMATCH'], [{ language: 'dub' }, 'RESOURCE_IDENTITY_MISMATCH'],
    [{ enabled: 0 }, 'RESOURCE_NOT_APPROVED'], [{ approved_at: '' }, 'RESOURCE_NOT_APPROVED'], [{ edition: '' }, 'RESOURCE_NOT_APPROVED'],
    [{ license: '' }, 'RESOURCE_NOT_APPROVED'], [{ rights_evidence_url: 'https://example.test/permission' }, 'RESOURCE_NOT_APPROVED'],
    [{ rights_evidence_url: 'https://commons.wikimedia.org/wiki/File:Another_edition.webm' }, 'RESOURCE_NOT_APPROVED'],
    [{ identity_evidence_url: 'javascript:alert(1)' }, 'RESOURCE_NOT_APPROVED'],
    [{ content_sha1: null }, 'RESOURCE_NOT_APPROVED'], [{ content_sha1: 'unreviewed' }, 'RESOURCE_NOT_APPROVED'],
  ] as const)('keeps selectors and resolution fail-closed for approval mismatch %s', async (patch, code) => {
    const resource = { ...approved, ...patch }; const fetcher = vi.fn<typeof fetch>();
    expect(hasApprovedCommonsResource(mapping, resource)).toBe(false);
    expect(await resolveWikimediaCommons(mapping, resource, undefined, fetcher)).toMatchObject({ kind: 'unsupported', error: { code, retryable: false } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['https://example.test/film.webm', 'File:../film.webm', 'File:film.webm?token=test', 'File:film\u0000.webm'])('rejects invalid File identifiers without requests: %s', async resource => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await resolveWikimediaCommons({ ...mapping, providerResourceId: resource }, { ...approved, resource_id: resource }, undefined, fetcher))
      .toMatchObject({ error: { code: 'INVALID_RESOURCE_ID', retryable: false } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [{ missing: true }, 'RESOURCE_NOT_FOUND'], [{ invalid: true }, 'INVALID_RESOURCE_ID'], [{ ns: 0 }, 'RESOURCE_IDENTITY_CHANGED'],
    [{ title: 'File:Different movie.webm' }, 'RESOURCE_IDENTITY_CHANGED'], [{ imageinfo: [] }, 'UPSTREAM_SCHEMA_CHANGED'],
    [{ imageinfo: [info({ canonicaltitle: 'File:Different edition.webm' })] }, 'RESOURCE_IDENTITY_CHANGED'],
    [{ imageinfo: [info({ mime: 'text/html' })] }, 'NATIVE_FORMAT_UNAVAILABLE'], [{ imageinfo: [info({ size: 0 })] }, 'UPSTREAM_SCHEMA_CHANGED'],
    [{ imageinfo: [info({ sha1: 'not-a-file-hash' })] }, 'UPSTREAM_SCHEMA_CHANGED'],
    [{ imageinfo: [info({ sha1: 'b'.repeat(40) })] }, 'RESOURCE_EDITION_CHANGED'],
  ] as const)('does not silently substitute changed or missing upstream file data: %s', async (patch, code) => {
    const fetcher = transport([metadata(patch)]);
    expect(await resolveWikimediaCommons(mapping, approved, undefined, fetcher)).toMatchObject({ kind: 'unsupported', error: { code } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { LicenseShortName: { value: 'CC BY-SA 4.0' } }, { UsageTerms: { value: 'All rights reserved' } },
    { Copyrighted: { value: 'True' } }, { Restrictions: { value: 'Noncommercial use only' } },
    { Restrictions: undefined }, { License: { value: 'unknown' } },
  ])('requires the reviewed public-domain declaration and no new restriction: %s', async patch => {
    const fetcher = transport([metadata({ imageinfo: [info({ extmetadata: { ...rights(), ...patch } })] })]);
    expect(await resolveWikimediaCommons(mapping, approved, undefined, fetcher)).toMatchObject({ error: { code: 'RESOURCE_RIGHTS_CHANGED', retryable: false } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    'http://127.0.0.1/private', original.replace('upload.wikimedia.org', 'upload.wikimedia.org.evil.test'),
    original.replace('https://', 'https://user:password@'), original.replace('upload.wikimedia.org', 'upload.wikimedia.org:444'),
    original.replace('/wikipedia/commons/', '/wikipedia/en/'), original.replace('silent_film', 'another_edition'),
    original + '?token=unreviewed', original + '#fragment', 'https://upload.wikimedia.org/wikipedia/commons/a/ab/%2e%2e/private.webm',
  ])('rejects unreviewed media URLs from metadata and redirects before contact: %s', async url => {
    const fromMetadata = transport([metadata({ imageinfo: [info({ url })] })]);
    expect(await resolveWikimediaCommons(mapping, approved, undefined, fromMetadata)).toMatchObject({ error: { code: 'UNSAFE_MEDIA_DESTINATION', retryable: false } });
    expect(fromMetadata).toHaveBeenCalledTimes(1);
    const redirect = transport([metadata(), new Response(null, { status: 302, headers: { location: url } })]);
    expect(await resolveWikimediaCommons(mapping, approved, undefined, redirect)).toMatchObject({ error: { code: 'UNSAFE_MEDIA_DESTINATION', retryable: false } });
    expect(redirect).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ 'content-type': 'video/mp4' }, 'MEDIA_TYPE_CHANGED'], [{ 'access-control-allow-origin': '' }, 'MEDIA_CORS_RESTRICTED'],
    [{ 'access-control-allow-origin': 'https://some-other-site.example' }, 'MEDIA_CORS_RESTRICTED'], [{ 'accept-ranges': 'none' }, 'MEDIA_RANGE_UNAVAILABLE'],
  ] as const)('requires actual anonymous WebM and range headers: %s', async (headers, code) => {
    expect(await resolveWikimediaCommons(mapping, approved, undefined, transport([metadata(), head(headers)])))
      .toMatchObject({ kind: 'unsupported', error: { code, retryable: false } });
  });

  it('distinguishes metadata/media restrictions, rate limits, missing files, malformed responses and redirect loops', async () => {
    for (const [status, metadataCode, mediaCode] of [[403, 'UPSTREAM_BLOCKED', 'MEDIA_RESTRICTED'], [404, 'RESOURCE_NOT_FOUND', 'MEDIA_NOT_FOUND'],
      [429, 'UPSTREAM_RATE_LIMIT', 'UPSTREAM_RATE_LIMIT'], [503, 'UPSTREAM_UNAVAILABLE', 'MEDIA_UNAVAILABLE']] as const) {
      expect(await resolveWikimediaCommons(mapping, approved, undefined, transport([new Response(null, { status })]))).toMatchObject({ error: { code: metadataCode } });
      expect(await resolveWikimediaCommons(mapping, approved, undefined, transport([metadata(), new Response(null, { status })]))).toMatchObject({ error: { code: mediaCode } });
    }
    expect(await resolveWikimediaCommons(mapping, approved, undefined, transport([new Response('{broken', { headers: { 'content-type': 'application/json' } })])))
      .toMatchObject({ error: { code: 'UPSTREAM_SCHEMA_CHANGED' } });
    expect(await resolveWikimediaCommons(mapping, approved, undefined, transport([new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } })])))
      .toMatchObject({ error: { code: 'UPSTREAM_RESPONSE_TOO_LARGE' } });
    const redirect = transport([new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })]);
    expect(await resolveWikimediaCommons(mapping, approved, undefined, redirect)).toMatchObject({ error: { code: 'UPSTREAM_REDIRECT' } });
    expect(redirect).toHaveBeenCalledTimes(1);
    const loop = transport([metadata(), ...Array.from({ length: 4 }, () => new Response(null, { status: 302, headers: { location: original } }))]);
    expect(await resolveWikimediaCommons(mapping, approved, undefined, loop)).toMatchObject({ error: { code: 'MEDIA_REDIRECT_LIMIT' } });
    expect(loop).toHaveBeenCalledTimes(5);
  });

  it('propagates episode cancellation, rejects stale completions, and bounds a nonresponsive transport to 12 seconds', async () => {
    const aborted = new AbortController(); aborted.abort(new DOMException('Changed episode', 'AbortError'));
    const unused = vi.fn<typeof fetch>();
    await expect(resolveWikimediaCommons(mapping, approved, aborted.signal, unused)).rejects.toMatchObject({ name: 'AbortError' });
    expect(unused).not.toHaveBeenCalled();
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === 'HEAD') controller.abort(new DOMException('Changed provider', 'AbortError'));
      return init?.method === 'HEAD' ? head() : metadata();
    });
    await expect(resolveWikimediaCommons(mapping, approved, controller.signal, fetcher)).rejects.toMatchObject({ name: 'AbortError' });
    vi.useFakeTimers();
    const pending = resolveWikimediaCommons(mapping, approved, undefined, () => new Promise<Response>(() => {}));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await pending).toMatchObject({ kind: 'unsupported', error: { code: 'UPSTREAM_TIMEOUT', retryable: true } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not expose arbitrary transport error details', async () => {
    const result = await resolveWikimediaCommons(mapping, approved, undefined, async () => { throw Error('private diagnostic test-value'); });
    expect(result).toMatchObject({ kind: 'unsupported', error: { code: 'UPSTREAM_UNAVAILABLE' } });
    expect(JSON.stringify(result)).not.toContain('private diagnostic');
  });
});
