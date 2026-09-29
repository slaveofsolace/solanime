import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Deployment entrypoint is tested against standard Web APIs.
import worker, { apiOrigin } from '../public/_worker.js';
const env = {
  SOLANIME_API_ORIGIN: 'https://api.example.com',
  ASSETS: { fetch: vi.fn(async () => new Response('asset')) },
};
afterEach(() => vi.unstubAllGlobals());
describe('optional Pages gateway', () => {
  it('returns JSON when the Node API is not configured', async () => {
    const result = await worker.fetch(new Request('https://solanime.example/api/titles'), {
      ASSETS: env.ASSETS,
    });
    expect(result.status).toBe(503);
    expect((await result.json()).error.code).toBe('API_NOT_CONFIGURED');
  });
  it('passes assets through and does not expose private endpoints', async () => {
    expect(
      await (await worker.fetch(new Request('https://solanime.example/catalogue'), env)).text(),
    ).toBe('asset');
    for (const path of [
      '/api/admin/backup',
      '/api/exports/catalogue.json',
      '/api/fetch?url=https://other.example',
    ])
      expect((await worker.fetch(new Request(`https://solanime.example${path}`), env)).status).toBe(
        404,
      );
  });
  it.each([
    'http://api.example.com',
    'https://user:secret@api.example.com',
    'https://api.example.com/path',
    'https://127.0.0.1',
    'https://[::1]',
    'https://solanime.example',
  ])('rejects unsafe origin %s', (url) => {
    expect(() => apiOrigin(url, 'https://solanime.example')).toThrow();
  });
  it('forwards only to the configured origin and strips private browser headers', async () => {
    const spy = vi.fn().mockResolvedValue(Response.json({ status: 'ok' }));
    vi.stubGlobal('fetch', spy);
    const result = await worker.fetch(
      new Request('https://solanime.example/api/titles?q=test', {
        headers: { cookie: 'session=private', 'x-admin-token': 'private' },
      }),
      env,
    );
    expect(result.status).toBe(200);
    expect(spy.mock.calls[0][0]).toBe('https://api.example.com/api/titles?q=test');
    expect(spy.mock.calls[0][1].headers.has('cookie')).toBe(false);
    expect(spy.mock.calls[0][1].headers.has('x-admin-token')).toBe(false);
    expect(spy.mock.calls[0][1].redirect).toBe('manual');
  });
  it('rejects foreign-origin POSTs and oversized bodies', async () => {
    expect(
      (
        await worker.fetch(
          new Request('https://solanime.example/api/providers/1/resolve', {
            method: 'POST',
            body: '{}',
            headers: { origin: 'https://other.example', 'content-type': 'application/json' },
          }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await worker.fetch(
          new Request('https://solanime.example/api/providers/1/resolve', {
            method: 'POST',
            body: 'x'.repeat(20000),
            headers: { 'content-type': 'application/json' },
          }),
          env,
        )
      ).status,
    ).toBe(413);
  });
  it('does not pass HTML backend failures off as data', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
        ),
    );
    expect(
      (await worker.fetch(new Request('https://solanime.example/api/health'), env)).status,
    ).toBe(502);
  });
});

describe('account gateway', () => {
  it('forwards only the application session cookie and approved CSRF headers', async () => {
    const token = 'a'.repeat(43);
    const spy = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { ok: true },
          {
            headers: {
              'set-cookie': `__Host-solanime_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict`,
            },
          },
        ),
      );
    vi.stubGlobal('fetch', spy);
    const response = await worker.fetch(
      new Request('https://solanime.example/api/account/profiles', {
        method: 'POST',
        headers: {
          origin: 'https://solanime.example',
          'content-type': 'application/json',
          cookie: `analytics=secret; __Host-solanime_session=${token}`,
          'x-csrf-token': 'csrf',
          'x-solanime-intent': 'account',
          'x-admin-token': 'do-not-forward',
        },
        body: '{}',
      }),
      env,
    );
    expect(response.status).toBe(200);
    const headers = spy.mock.calls[0][1].headers;
    expect(headers.get('cookie')).toBe(`__Host-solanime_session=${token}`);
    expect(headers.get('x-csrf-token')).toBe('csrf');
    expect(headers.has('x-admin-token')).toBe(false);
    expect(response.headers.get('set-cookie')).toContain('__Host-solanime_session=');
  });
  it('does not expose admin endpoints or forward insecure backend cookies', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { ok: true },
            { headers: { 'set-cookie': 'other_session=secret; Domain=example.com' } },
          ),
        ),
    );
    const response = await worker.fetch(
      new Request('https://solanime.example/api/account/session'),
      env,
    );
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
