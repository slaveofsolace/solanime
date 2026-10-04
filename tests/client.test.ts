import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, readResponse } from '../src/lib/api';
import { decodeStored } from '../src/lib/storage';
import type { TitleSummary } from '../src/types';
afterEach(() => vi.unstubAllGlobals());
describe('API contracts', () => {
  it('rejects static-host HTML instead of rendering it as catalogue data', async () => {
    await expect(
      readResponse(
        new Response('<!doctype html><div id="root"></div>', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
    ).rejects.toMatchObject({ problem: { code: 'API_NOT_CONFIGURED' } });
  });
  it.each(['null', '1', 'broken json'])('rejects incomplete JSON: %s', async (body) => {
    await expect(
      readResponse(new Response(body, { headers: { 'content-type': 'application/json' } })),
    ).rejects.toBeInstanceOf(ApiError);
  });
  it('preserves an actionable backend error', async () => {
    await expect(
      readResponse(
        Response.json(
          { error: { code: 'UNAVAILABLE', message: 'No mapping found.' } },
          { status: 404 },
        ),
      ),
    ).rejects.toMatchObject({ message: 'No mapping found.', problem: { status: 404 } });
  });
  it.each(['catalogue', 'title', 'providers', 'filters'] as const)(
    'validates the %s payload',
    async (kind) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})));
      const result =
        kind === 'catalogue'
          ? api.catalogue({})
          : kind === 'title'
            ? api.title('test')
            : kind === 'providers'
              ? api.providers('1', 'sub')
              : api.filters();
      await expect(result).rejects.toMatchObject({ problem: { code: 'INVALID_RESPONSE' } });
    },
  );
  it('explains connection failures and preserves caller cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(api.title('test')).rejects.toMatchObject({ problem: { code: 'NETWORK_ERROR' } });
    const controller = new AbortController();
    controller.abort();
    const reason = new DOMException('Cancelled', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(reason));
    await expect(api.title('test', controller.signal)).rejects.toBe(reason);
  });
});
describe('saved browser data', () => {
  it.each([null, false, 1, {}, 'bad'])('recovers malformed watchlist: %j', (value) => {
    expect(decodeStored('watchlist-records', value, [])).toEqual([]);
  });
  it('filters bad entries and deduplicates without losing valid titles', () => {
    const title = {
      id: '1',
      slug: 'test',
      name: 'A title',
      genres: [null, 'Drama'],
      releaseYear: 'wrong',
    };
    const result = decodeStored<any[]>(
      'watchlist-records',
      [null, { id: 'invalid' }, title, title],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: '1', name: 'A title', genres: ['Drama'] });
  });
  it('retains saved landscape artwork on reload while rejecting malformed optional backdrops', () => {
    const saved = {
      id: 'saved-landscape', slug: 'saved-landscape', name: 'Saved title',
      imageUrl: 'https://images.example.test/original.jpg',
      posterUrl: 'https://images.example.test/poster.jpg',
      backdropUrl: 'https://images.example.test/backdrop.jpg',
    };
    const serialized = JSON.parse(JSON.stringify([
      saved,
      { id: 'legacy', slug: 'legacy', name: 'Older saved title' },
      { id: 'malformed', slug: 'malformed', name: 'Malformed artwork', backdropUrl: { url: saved.backdropUrl } },
    ]));
    const restored = decodeStored<TitleSummary[]>('watchlist-records', serialized, []);
    expect(restored).toHaveLength(3);
    expect(restored[0]).toMatchObject(saved);
    expect(restored[1]).toMatchObject({ id: 'legacy', backdropUrl: null });
    expect(restored[2]).toMatchObject({ id: 'malformed', backdropUrl: null });
  });
  it('merges valid legacy preferences with safe defaults', () => {
    expect(
      decodeStored(
        'preferences',
        { theme: 'light', preferredLanguage: 'dub', autoplayNext: 'true' },
        {},
      ),
    ).toMatchObject({
      theme: 'light',
      preferredLanguage: 'dub',
      autoplayNext: false,
      rememberProgress: true,
    });
  });
  it.each([-1, Number.NaN, Infinity, '20'])('discards invalid progress: %s', (value) => {
    expect(decodeStored('progress:1:sub:test', value, 0)).toBe(0);
  });
  it('keeps finite progress and ignores malformed history', () => {
    expect(decodeStored('progress:1:sub:test', 22.5, 0)).toBe(22.5);
    expect(decodeStored('history', [null, { title: 'incomplete' }], [])).toEqual([]);
  });
});
