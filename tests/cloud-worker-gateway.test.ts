import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error The Pages JavaScript deployment entrypoint is exercised with standard Web APIs.
import pages from '../public/_worker.js';

const origin = 'https://gateway-contract.example.test';
const sessionToken = 's'.repeat(43);
const accountCookie = `__Host-solanime_session=${sessionToken}; Path=/; Secure; HttpOnly; SameSite=Lax`;
let runtime: Miniflare;

beforeAll(async () => {
  const cacheRoot = fileURLToPath(new URL('../.cache/cloud-worker-gateway/', import.meta.url));
  mkdirSync(cacheRoot, { recursive: true });
  // Both sides execute inside workerd. This detects differences between Node's
  // Request/AbortSignal implementation and actual Worker service bindings.
  runtime = new Miniflare({ ...convertV4MiniflareOptions({ workers: [
    { name: 'test-pages', modules: true, script: readFileSync(new URL('../public/_worker.js', import.meta.url), 'utf8'),
      compatibilityDate: '2026-09-12', compatibilityFlags: ['nodejs_compat'], serviceBindings: { SOLANIME_API: 'test-api', ASSETS: 'test-assets' } },
    { name: 'test-api', modules: true, compatibilityDate: '2026-09-12', script: `export default { async fetch(request) {
      const url = new URL(request.url);
      if (url.searchParams.get('redirect') === 'true') return Response.redirect('https://unexpected.example.test', 302);
      return Response.json({ reached: true, url: request.url, method: request.method,
        headers: Object.fromEntries(request.headers), body: request.method === 'POST' ? await request.text() : null,
        signalPresent: !!request.signal, redirectPolicy: request.redirect });
    } }` },
    { name: 'test-assets', modules: true, compatibilityDate: '2026-09-12', script: 'export default { fetch() { return new Response("test-only asset") } }' },
  ] }), resourceTmpPath: mkdtempSync(cacheRoot + 'runtime-') });
}, 30_000);
afterAll(async () => { await runtime?.dispose(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup(upstream: (request: Request) => Promise<Response> = async () => Response.json({ ok: true })) {
  const service = vi.fn(upstream);
  const assets = vi.fn(async () => new Response('asset'));
  const externalFetch = vi.fn(async () => { throw new Error('No external fallback is allowed in bound mode'); });
  vi.stubGlobal('fetch', externalFetch);
  return { env: { SOLANIME_API: { fetch: service }, ASSETS: { fetch: assets }, SOLANIME_GATEWAY_TOKEN: 'server-only-test-gateway-secret' }, service, assets, externalFetch };
}
function post(path: string, data: unknown = {}, headers: HeadersInit = {}) {
  const combined = new Headers({ origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' });
  new Headers(headers).forEach((value, name) => combined.set(name, value));
  return new Request(origin + path, { method: 'POST', headers: combined, body: JSON.stringify(data) });
}

describe('Pages service binding in the actual Worker runtime', () => {
  it('reaches the bound API with JSON instead of silently falling back to HTML assets or public HTTP', async () => {
    const response = await runtime.dispatchFetch(origin + '/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reached: true, url: origin + '/api/health', method: 'GET', redirectPolicy: 'manual' });
    expect(response.headers.get('content-type')).toContain('application/json');
  }, 20_000);

  it('forwards same-origin JSON mutations through a real service binding', async () => {
    const response = await runtime.dispatchFetch(origin + '/api/providers/31/resolve', {
      method: 'POST', headers: { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: '{"language":"sub"}',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reached: true, method: 'POST', body: '{"language":"sub"}', headers: { origin, 'sec-fetch-site': 'same-origin' } });
  });

  it('does not follow a bound API redirect to another origin', async () => {
    const response = await runtime.dispatchFetch(origin + '/api/health?redirect=true');
    expect(response.status).toBe(502);
    expect(await response.json()).toHaveProperty('error.code');
  });
});

describe('private Pages gateway forwarding contract', () => {
  it('limits official YouTube review deployments to public catalogue reads and playback resolution', async () => {
    const { env, service, assets } = setup();
    const review = { ...env, SOLANIME_REVIEW_MODE: 'youtube-official' };
    expect((await pages.fetch(new Request(origin + '/api/titles'), review)).status).toBe(200);
    expect((await pages.fetch(post('/api/providers/31/resolve', { language: 'sub' }), review)).status).toBe(200);
    for (const path of ['/api/account/session', '/api/episodes/152288/comments', '/api/admin/sources', '/api/exports/catalogue.json'])
      expect((await pages.fetch(new Request(origin + path), review)).status).toBe(404);
    expect((await pages.fetch(post('/api/account/login'), review)).status).toBe(404);
    expect((await pages.fetch(post('/api/episodes/152288/comments'), review)).status).toBe(404);
    expect((await pages.fetch(post('/api/admin/sync/start'), review)).status).toBe(404);
    expect(service).toHaveBeenCalledTimes(2);
    expect(assets).not.toHaveBeenCalled();
  });

  it('forwards only the approved-session cookie on catalogue reads, dropping other credentials and upstream cookies', async () => {
    const { env, service, externalFetch } = setup(async () => Response.json({ items: [] }, { headers: { 'set-cookie': accountCookie, 'x-private-debug': 'test-private', 'content-disposition': 'attachment; filename=private.json' } }));
    const response = await pages.fetch(new Request(origin + '/api/titles?q=literal%25&page=2', { headers: {
      cookie: `tracking=secret; __Host-solanime_session=${sessionToken}`, authorization: 'Bearer test-private-auth',
      'x-admin-token': 'test-private-admin', 'x-csrf-token': 'test-private-csrf', 'x-solanime-intent': 'mutate',
      'x-solanime-gateway': 'caller-forgery', 'x-solanime-client-ip': 'caller-ip', 'cf-connecting-ip': '192.0.2.5',
      referer: origin + '/private', origin,
    } }), env);
    expect(response.status).toBe(200); expect(service).toHaveBeenCalledTimes(1); expect(externalFetch).not.toHaveBeenCalled();
    const sent = service.mock.calls[0][0];
    expect(sent.url).toBe(origin + '/api/titles?q=literal%25&page=2');
    expect(Object.fromEntries(sent.headers)).toEqual({ accept: 'application/json', 'cf-connecting-ip': '192.0.2.5',
      cookie: '__Host-solanime_session=' + sessionToken });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-private-debug')).toBeNull();
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('forwards a single session cookie to provider resolution but not to health or operator routes', async () => {
    const { env, service } = setup();
    await pages.fetch(post('/api/providers/31/resolve', { language: 'sub' }, {
      cookie: `tracking=ignore; __Host-solanime_session=${sessionToken}`, 'x-csrf-token': 'discard',
    }), env);
    expect(service.mock.calls[0][0].headers.get('cookie')).toBe('__Host-solanime_session=' + sessionToken);
    expect(service.mock.calls[0][0].headers.get('x-csrf-token')).toBeNull();
    await pages.fetch(new Request(origin + '/api/health', { headers: { cookie: '__Host-solanime_session=' + sessionToken } }), env);
    expect(service.mock.calls[1][0].headers.get('cookie')).toBeNull();
  });

  it('forwards only the single valid account cookie and permitted intent headers on account routes', async () => {
    const { env, service } = setup(async () => Response.json({ authenticated: true }, { headers: { 'set-cookie': accountCookie } }));
    const response = await pages.fetch(post('/api/account/logout', {}, {
      cookie: `tracking=ignore; __Host-solanime_session=${sessionToken}`, 'x-csrf-token': 'test-csrf', 'x-solanime-intent': 'mutate',
      authorization: 'Bearer discard', 'x-admin-token': 'discard', 'x-solanime-gateway': 'forged', 'x-solanime-client-ip': 'forged', 'cf-connecting-ip': '192.0.2.6',
    }), env);
    expect(response.status).toBe(200);
    const sent = service.mock.calls[0][0];
    expect(sent.headers.get('cookie')).toBe('__Host-solanime_session=' + sessionToken);
    expect(sent.headers.get('x-csrf-token')).toBe('test-csrf');
    expect(sent.headers.get('x-solanime-intent')).toBe('mutate');
    expect(sent.headers.get('x-solanime-gateway')).toBe(env.SOLANIME_GATEWAY_TOKEN);
    expect(sent.headers.get('x-solanime-client-ip')).toBe('192.0.2.6');
    expect(sent.headers.get('authorization')).toBeNull(); expect(sent.headers.get('x-admin-token')).toBeNull();
    expect(response.headers.get('set-cookie')).toBe(accountCookie);
  });

  it('forwards public episode comments and authenticated comment mutations without opening a generic proxy', async () => {
    const { env, service } = setup();
    const episodePath = '/api/episodes/152288/comments';
    const read = await pages.fetch(new Request(origin + episodePath, {
      headers: { cookie: `tracking=ignore; __Host-solanime_session=${sessionToken}` },
    }), env);
    expect(read.status).toBe(200);
    expect(service.mock.calls[0][0].headers.get('cookie')).toBe('__Host-solanime_session=' + sessionToken);

    const created = await pages.fetch(post(episodePath, { profileId: 'p'.repeat(36), body: 'Hello' }, {
      cookie: `__Host-solanime_session=${sessionToken}`, 'x-csrf-token': 'test-csrf', 'x-solanime-intent': 'account',
    }), env);
    expect(created.status).toBe(200);
    expect(service.mock.calls[1][0].method).toBe('POST');

    const itemPath = episodePath + '/123e4567-e89b-42d3-a456-426614174000';
    for (const method of ['PATCH', 'DELETE']) {
      const response = await pages.fetch(new Request(origin + itemPath, {
        method, headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', cookie: `__Host-solanime_session=${sessionToken}`, 'x-csrf-token': 'test-csrf', 'x-solanime-intent': 'account' }, body: JSON.stringify({ profileId: 'p'.repeat(36), revision: 1 }),
      }), env);
      expect(response.status).toBe(200);
      expect(service.mock.calls.at(-1)?.[0].method).toBe(method);
    }
    expect((await pages.fetch(new Request(origin + '/api/episodes/152288/comments/not-a-comment'), env)).status).toBe(404);
  });

  it('rejects ambiguous session cookies on both account and catalogue routes', async () => {
    const { env, service } = setup();
    const ambiguous = `__Host-solanime_session=${sessionToken}; solanime_session=${'x'.repeat(43)}`;
    await pages.fetch(new Request(origin + '/api/account/session', { headers: { cookie: ambiguous } }), env);
    expect(service.mock.calls[0][0].headers.get('cookie')).toBeNull();
    await pages.fetch(new Request(origin + '/api/titles', { headers: { cookie: ambiguous } }), env);
    expect(service.mock.calls[1][0].headers.get('cookie')).toBeNull();
  });

  it('keeps operator routes protected and strips cookies even from authorized research requests', async () => {
    const { env, service } = setup();
    expect((await pages.fetch(new Request(origin + '/api/admin/sources'), env)).status).toBe(401);
    expect((await pages.fetch(new Request(origin + '/api/admin/sources', { headers: { 'x-admin-token': 'x'.repeat(257) } }), env)).status).toBe(401);
    expect(service).not.toHaveBeenCalled();
    await pages.fetch(new Request(origin + '/api/admin/sources?q=test', { headers: { 'x-admin-token': 'test-operator', cookie: '__Host-solanime_session=' + sessionToken, authorization: 'discard' } }), env);
    expect(service.mock.calls[0][0].headers.get('x-admin-token')).toBe('test-operator');
    expect(service.mock.calls[0][0].headers.get('cookie')).toBeNull();
    expect(service.mock.calls[0][0].headers.get('authorization')).toBeNull();
  });

  it('forwards MyAnimeList profile routes as account routes and nothing broader', async () => {
    const { env, service } = setup();
    const profile = '/api/account/profiles/00000000-0000-4000-8000-000000000000/mal/';
    const headers = { cookie: '__Host-solanime_session=' + sessionToken, 'x-csrf-token': 'test-csrf', 'x-solanime-intent': 'mutate' };
    for (const action of ['status', 'list'])
      expect((await pages.fetch(new Request(origin + profile + action, { headers }), env)).status).toBe(200);
    for (const action of ['connect', 'complete', 'sync', 'update', 'disconnect'])
      expect((await pages.fetch(post(profile + action, {}, headers), env)).status).toBe(200);
    expect(service).toHaveBeenCalledTimes(7);
    expect(service.mock.calls[0][0].headers.get('cookie')).toBe('__Host-solanime_session=' + sessionToken);
    expect((await pages.fetch(new Request(origin + profile + 'tokens', { headers }), env)).status).toBe(404);
    expect((await pages.fetch(post(profile + 'status', {}, headers), env)).status).toBe(404);
  });

  it('forwards the operator artwork refresh route', async () => {
    const { env, service } = setup();
    expect((await pages.fetch(post('/api/admin/artwork/refresh', {}, { 'x-admin-token': 'test-operator' }), env)).status).toBe(200);
    expect(service).toHaveBeenCalledTimes(1);
  });

  it('exposes only the exact operator account-approval routes through the gateway', async () => {
    const { env, service } = setup();
    const pending = '/api/admin/accounts/pending';
    const decision = '/api/admin/accounts/account-1/decision';
    expect((await pages.fetch(new Request(origin + pending), env)).status).toBe(401);
    expect((await pages.fetch(post(decision, { decision: 'approved' }), env)).status).toBe(401);
    expect(service).not.toHaveBeenCalled();
    expect((await pages.fetch(new Request(origin + pending, {
      headers: { 'x-admin-token': 'test-operator', cookie: '__Host-solanime_session=' + sessionToken },
    }), env)).status).toBe(200);
    expect((await pages.fetch(post(decision, { decision: 'approved' }, {
      'x-admin-token': 'test-operator', cookie: '__Host-solanime_session=' + sessionToken,
    }), env)).status).toBe(200);
    expect(service.mock.calls[0][0].headers.get('cookie')).toBeNull();
    expect(service.mock.calls[1][0].headers.get('cookie')).toBeNull();
    expect((await pages.fetch(new Request(origin + '/api/admin/accounts/account-1'), env)).status).toBe(404);
    expect((await pages.fetch(post('/api/admin/accounts/account-1/delete', {}, { 'x-admin-token': 'test-operator' }), env)).status).toBe(404);
  });

  it('forwards native verification only as an explicit operator mutation without account credentials', async () => {
    const { env, service } = setup();
    const path = '/api/admin/providers/31/verification';
    expect((await pages.fetch(post(path), env)).status).toBe(401);
    expect((await pages.fetch(post(path, {}, { 'x-admin-token': 'test-operator', origin: 'https://foreign.example.test' }), env)).status).toBe(403);
    expect(service).not.toHaveBeenCalled();
    expect((await pages.fetch(post(path, { language: 'sub', progressFrom: 0, progressTo: 12 }, {
      'x-admin-token': 'test-operator', cookie: '__Host-solanime_session=' + sessionToken, authorization: 'discard',
    }), env)).status).toBe(200);
    const forwarded = service.mock.calls[0][0];
    expect(forwarded.url).toBe(origin + path);
    expect(forwarded.headers.get('x-admin-token')).toBe('test-operator');
    expect(forwarded.headers.get('cookie')).toBeNull();
    expect(forwarded.headers.get('authorization')).toBeNull();
    expect(await forwarded.json()).toEqual({ language: 'sub', progressFrom: 0, progressTo: 12 });
  });

  it.each(['/api/account/logout', '/api/admin/sources/test-source/review', '/api/providers/31/resolve'])('rejects originless mutations without synthesizing origin authorization: %s', async path => {
    const { env, service } = setup();
    const request = new Request(origin + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': 'test-operator' }, body: '{}' });
    expect((await pages.fetch(request, env)).status).toBe(403);
    expect(service).not.toHaveBeenCalled();
  });

  it('rejects cross-origin writes and limits bodies before dispatching to the private binding', async () => {
    const { env, service } = setup();
    expect((await pages.fetch(post('/api/providers/31/resolve', {}, { origin: 'https://foreign.example.test' }), env)).status).toBe(403);
    expect((await pages.fetch(post('/api/providers/31/resolve', {}, { 'sec-fetch-site': 'cross-site' }), env)).status).toBe(403);
    expect((await pages.fetch(post('/api/providers/31/resolve', 'x'.repeat(17000)), env)).status).toBe(413);
    expect((await pages.fetch(post('/api/providers/31/resolve', {}, { 'content-type': 'text/plain' }), env)).status).toBe(415);
    expect(service).not.toHaveBeenCalled();
  });

  it('permits CSV only on protected export routes and preserves retry semantics', async () => {
    const { env, service } = setup(async () => new Response('metric,count\ntitles,2', { headers: { 'content-type': 'text/csv', 'retry-after': '60' } }));
    const csv = await pages.fetch(new Request(origin + '/api/exports/coverage.csv', { headers: { 'x-admin-token': 'test-operator' } }), env);
    expect(csv.status).toBe(200); expect(csv.headers.get('content-type')).toContain('text/csv'); expect(csv.headers.get('retry-after')).toBe('60');
    expect((await pages.fetch(new Request(origin + '/api/titles'), env)).status).toBe(502);
    expect(service).toHaveBeenCalledTimes(2);
  });

  it('preserves catalogue export schema and continuation headers only for protected CSV downloads', async () => {
    const { env } = setup(async () => new Response('id,name\r\n"1","Test"', {
      headers: { 'content-type': 'text/csv', 'x-export-schema-version': '2', 'x-next-cursor': '1' },
    }));
    const response = await pages.fetch(new Request(origin + '/api/exports/catalogue.csv?limit=1', { headers: { 'x-admin-token': 'test-operator' } }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-export-schema-version')).toBe('2');
    expect(response.headers.get('x-next-cursor')).toBe('1');
  });

  it('returns safe typed errors for HTML, redirects, transport failures and nonexistent proxy routes', async () => {
    const { env, service, externalFetch, assets } = setup(async () => new Response('<html>wrong deployment</html>', { headers: { 'content-type': 'text/html' } }));
    expect(await (await pages.fetch(new Request(origin + '/api/health'), env)).json()).toMatchObject({ error: { code: 'INVALID_UPSTREAM' } });
    service.mockRejectedValueOnce(new Error('test-private-provider-token must not escape'));
    const failed = await pages.fetch(new Request(origin + '/api/health'), env);
    expect(failed.status).toBe(502); expect(await failed.text()).not.toContain('test-private-provider-token');
    expect((await pages.fetch(new Request(origin + '/api/proxy?url=http://127.0.0.1/private'), env)).status).toBe(404);
    expect((await pages.fetch(new Request(origin + '/api'), env)).status).toBe(404);
    expect(assets).not.toHaveBeenCalled(); expect(externalFetch).not.toHaveBeenCalled();
    expect((await pages.fetch(new Request(origin + '/watch/test/1'), env)).status).toBe(200); expect(assets).toHaveBeenCalledTimes(1);
  });

  it('passes bounded cancellation to the binding and tolerates Worker requests without a signal', async () => {
    const controller = new AbortController();
    const { env, service } = setup(async request => {
      expect(request.signal).toBeInstanceOf(AbortSignal);
      expect(request.redirect).toBe('manual');
      return Response.json({ cancelled: request.signal.aborted });
    });
    controller.abort();
    const cancelled = await pages.fetch(new Request(origin + '/api/health', { signal: controller.signal }), env);
    expect(await cancelled.json()).toEqual({ cancelled: true });
    const noSignal = new Request(origin + '/api/health');
    Object.defineProperty(noSignal, 'signal', { value: undefined });
    expect((await pages.fetch(noSignal, env)).status).toBe(200);
    expect(service).toHaveBeenCalledTimes(2);
  });

  it('propagates cancellation during an in-flight binding call without exposing its private abort reason', async () => {
    const controller = new AbortController();
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const { env } = setup(async request => {
      ready();
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
      });
    });
    const pending = pages.fetch(new Request(origin + '/api/health', { signal: controller.signal }), env);
    await started;
    controller.abort(new Error('test-private-abort-detail'));
    const response = await pending;
    expect(response.status).toBe(502);
    const result = await response.json();
    expect(result).toMatchObject({ error: { code: 'UPSTREAM_UNAVAILABLE' } });
    expect(JSON.stringify(result)).not.toContain('test-private-abort-detail');
  });
});
