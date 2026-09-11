import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnikotoSourceClient, SourceRequestError } from '../server/ingestion/source.ts';

describe('public source cancellation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves caller cancellation as AbortError during an active request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('cancelled', 'AbortError')),
              { once: true },
            );
          }),
      ),
    );
    const controller = new AbortController();
    const request = new AnikotoSourceClient().text(
      '/ajax/server?get=test',
      'json',
      controller.signal,
    );
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a redirect outside the public source allowlist without retrying it as a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(null, { status: 302, headers: { location: 'https://example.com/private' } }),
      ),
    );
    const request = new AnikotoSourceClient().text('/filter?page=1', 'html');
    await expect(request).rejects.toMatchObject({ code: 'UPSTREAM_CHANGED', retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves a bounded one-hour Retry-After value for the host gate and durable queue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('slow down', { status: 429, headers: { 'retry-after': '3600' } }),
      ),
    );
    try {
      await new AnikotoSourceClient().text('/filter?page=1', 'html');
      throw new Error('Expected source request to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(SourceRequestError);
      expect((error as SourceRequestError).retryAfterMs).toBe(3_600_000);
    }
  });
});
