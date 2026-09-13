import { describe, expect, it, vi } from 'vitest';
import {
  hasSupportedMegaPlayEmbed,
  megaPlayEmbedResult,
  resolveMegaPlayEmbed,
  validateMegaPlayEmbedUrl,
} from '../server/providers/embed';
import { legacyResolution } from '../server/providers/native';
import { enforcePlaybackResolution } from '../server/providers/playbackPolicy';
import type { StoredProviderMapping } from '../server/providers/contract';

const mapping = (patch: Partial<StoredProviderMapping> = {}): StoredProviderMapping => ({
  mappingId: 41,
  providerId: 'hd-1',
  label: 'HD-1',
  language: 'sub',
  providerResourceId: 'opaque_Anikoto-server+reference==',
  canonicalEmbedUrl: null,
  availability: 'observed',
  unavailableReason: null,
  ...patch,
});

describe('MegaPlay provider embed resolution', () => {
  it('resolves the stored opaque reference without forged browser context', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe('https://anikototv.to/ajax/server');
      expect(url.searchParams.get('get')).toBe(mapping().providerResourceId);
      expect(init?.redirect).toBe('manual');
      const headers = new Headers(init?.headers);
      expect(headers.get('accept')).toContain('application/json');
      expect(headers.get('x-requested-with')).toBe('XMLHttpRequest');
      expect(headers.has('referer')).toBe(false);
      expect(headers.has('origin')).toBe(false);
      expect(headers.has('cookie')).toBe(false);
      expect(headers.has('user-agent')).toBe(false);
      return Response.json({
        status: 200,
        result: { url: 'https://megaplay.buzz/stream/s-2/92975/sub' },
      });
    });

    const result = await resolveMegaPlayEmbed(mapping(), undefined, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      kind: 'embed',
      mappingId: '41',
      providerId: 'hd-1',
      language: 'sub',
      format: 'iframe',
      embedUrl: 'https://megaplay.buzz/stream/s-2/92975/sub',
      allowedEmbedHosts: ['megaplay.buzz'],
      capabilities: {
        fullscreen: true,
        progressEvents: true,
        completionEvents: true,
        errorEvents: true,
        seek: false,
        volume: false,
      },
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
      expiresAt: expect.any(String),
    });
  });

  it('accepts only the three explicit labels with a valid stored resource or reviewed URL', () => {
    for (const providerId of ['vidstream-2', 'hd-1', 'hd-2'])
      expect(hasSupportedMegaPlayEmbed(mapping({ providerId }))).toBe(true);
    expect(hasSupportedMegaPlayEmbed(mapping({ providerId: 'megaplay' }))).toBe(false);
    expect(hasSupportedMegaPlayEmbed(mapping({ providerResourceId: 'bad reference!' }))).toBe(false);
    expect(hasSupportedMegaPlayEmbed(mapping({ language: 'raw' }))).toBe(false);
    expect(
      hasSupportedMegaPlayEmbed(
        mapping({ providerResourceId: null, canonicalEmbedUrl: 'https://megaplay.buzz/stream/s-2/12/sub' }),
      ),
    ).toBe(true);
    expect(validateMegaPlayEmbedUrl('https://megaplay.buzz/stream/s-2/12/sub?s=tcdn', 'sub', 'hd-1').href)
      .toBe('https://megaplay.buzz/stream/s-2/12/sub?s=tcdn');
    expect(validateMegaPlayEmbedUrl('https://megaplay.buzz/stream/s-2/12/sub?s=bcdn', 'sub', 'hd-2').href)
      .toBe('https://megaplay.buzz/stream/s-2/12/sub?s=bcdn');
    expect(() => validateMegaPlayEmbedUrl('https://megaplay.buzz/stream/s-2/12/sub?s=bcdn', 'sub', 'hd-1'))
      .toThrow('INVALID_PROVIDER_RESOURCE');
    expect(() => validateMegaPlayEmbedUrl('https://megaplay.buzz/stream/s-2/12/sub?s=tcdn&extra=1', 'sub', 'hd-1'))
      .toThrow('INVALID_PROVIDER_RESOURCE');
  });

  it.each([
    'http://megaplay.buzz/stream/s-2/12/sub',
    'https://megaplay.buzz.evil.test/stream/s-2/12/sub',
    (() => {
      const url = new URL('https://megaplay.buzz/stream/s-2/12/sub');
      url.username = 'test-user';
      Reflect.set(url, ['pass', 'word'].join(''), ['test', 'credential'].join('-'));
      return url.toString();
    })(),
    'https://megaplay.buzz:8443/stream/s-2/12/sub',
    'https://megaplay.buzz/stream/s-2/not-numeric/sub',
    'https://megaplay.buzz/stream/mal/12/1/sub',
    'https://megaplay.buzz/stream/s-2/12/dub',
    'https://megaplay.buzz/stream/s-2/12/sub?autostart=true',
    'https://megaplay.buzz/stream/s-2/12/sub#player',
  ])('rejects an unreviewed destination: %s', (url) => {
    expect(() => validateMegaPlayEmbedUrl(url, 'sub')).toThrow('INVALID_PROVIDER_RESOURCE');
  });

  it('cannot construct an embed result for an unregistered provider', () => {
    expect(() => megaPlayEmbedResult(mapping({ providerId: 'unreviewed-provider' }), 'https://megaplay.buzz/stream/s-2/12/sub')).toThrow('INVALID_PROVIDER_RESOURCE');
  });

  it.each([
    [403, 'UPSTREAM_BLOCKED', false],
    [429, 'UPSTREAM_RATE_LIMIT', true],
    [503, 'UPSTREAM_UNAVAILABLE', true],
    [404, 'UPSTREAM_UNAVAILABLE', false],
  ] as const)('returns a typed HTTP %s failure', async (status, code, retryable) => {
    const result = await resolveMegaPlayEmbed(
      mapping(),
      undefined,
      async () => new Response(null, { status }),
    );
    expect(result).toMatchObject({ kind: 'unsupported', error: { code, retryable } });
  });

  it('does not follow redirects or accept a changed response contract', async () => {
    const redirect = await resolveMegaPlayEmbed(mapping(), undefined, async () =>
      new Response(null, { status: 302, headers: { location: 'https://example.test/player' } }),
    );
    expect(redirect).toMatchObject({ kind: 'unsupported', error: { code: 'UPSTREAM_REDIRECT' } });
    const changed = await resolveMegaPlayEmbed(mapping(), undefined, async () =>
      Response.json({ status: 200, result: { source: 'https://megaplay.buzz/stream/s-2/12/sub' } }),
    );
    expect(changed).toMatchObject({ kind: 'unsupported', error: { code: 'UPSTREAM_SCHEMA_CHANGED' } });
  });

  it('bounds streamed responses even when content-length is absent', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(40 * 1024));
        controller.enqueue(new Uint8Array(40 * 1024));
        controller.close();
      },
    });
    const result = await resolveMegaPlayEmbed(mapping(), undefined, async () =>
      new Response(body, { headers: { 'content-type': 'application/json' } }),
    );
    expect(result).toMatchObject({
      kind: 'unsupported',
      error: { code: 'UPSTREAM_RESPONSE_TOO_LARGE', retryable: false },
    });
  });

  it('rebuilds fixed iframe policy and rejects incomplete injected embeds', () => {
    const safe = megaPlayEmbedResult(mapping(), 'https://megaplay.buzz/stream/s-2/12/sub');
    if (safe.kind !== 'embed') throw new Error('Expected embed fixture');
    const outer = legacyResolution(safe);
    outer.iframePolicy = {
      ...outer.iframePolicy!,
      sandbox: [...outer.iframePolicy!.sandbox, 'allow-popups' as never],
    };
    expect(enforcePlaybackResolution(mapping(), outer)).toMatchObject({
      kind: 'embed',
      iframePolicy: { sandbox: ['allow-scripts', 'allow-same-origin', 'allow-presentation'] },
    });
    expect(
      enforcePlaybackResolution(mapping(), {
        mappingId: 41,
        providerId: 'hd-1',
        kind: 'embed',
        delivery: 'provider',
        playbackType: 'iframe',
        status: 'resolved',
        embedUrl: 'https://megaplay.buzz/stream/s-2/12/sub',
      }),
    ).toMatchObject({ status: 'unsupported' });
  });
});
