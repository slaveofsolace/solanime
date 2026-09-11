from pathlib import Path
r=Path.cwd()
def w(path,text):
 p=r/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text.strip()+'\n')
w('public/_worker.js',r'''/** Optional Cloudflare Pages gateway. SQLite remains on the Node host. */
const publicRead = /^\/api\/(?:health|meta\/filters|titles(?:\/[^/]+)?|episodes\/\d+\/providers)$/;
const resolvePath = /^\/api\/providers\/\d+\/resolve$/;
const limit = 16 * 1024;
function problem(status, code, message) {
  return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' } });
}
export function apiOrigin(value, ownOrigin) {
  const target = new URL(value);
  if (target.protocol !== 'https:' || target.username || target.password || target.port || target.pathname !== '/' || target.search || target.hash || target.origin === ownOrigin) throw new Error('Invalid API origin');
  if (/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/i.test(target.hostname)) throw new Error('Private API origin');
  return target.origin;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const mutation = request.method === 'POST' && resolvePath.test(url.pathname);
    if (!(request.method === 'GET' && publicRead.test(url.pathname)) && !mutation) return problem(404, 'NOT_FOUND', 'This API route is not exposed by the public gateway.');
    let origin;
    try { origin = apiOrigin(env.SOLANIME_API_ORIGIN, url.origin); }
    catch { return problem(503, 'API_NOT_CONFIGURED', 'Configure SOLANIME_API_ORIGIN with the HTTPS origin of your running Solanime Node API.'); }
    const headers = new Headers({ accept: 'application/json' }); let body;
    if (mutation) {
      const caller = request.headers.get('origin'); const site = request.headers.get('sec-fetch-site');
      if ((caller && caller !== url.origin) || (site && site !== 'same-origin')) return problem(403, 'UNAUTHORIZED', 'Cross-origin playback requests are not accepted.');
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return problem(415, 'BAD_REQUEST', 'Use an application/json request body.');
      if (Number(request.headers.get('content-length') ?? 0) > limit) return problem(413, 'BAD_REQUEST', 'Request body is too large.');
      const reader = request.body?.getReader(); const chunks = []; let size = 0;
      if (reader) { try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); return problem(413, 'BAD_REQUEST', 'Request body is too large.'); } chunks.push(value); } } catch { return problem(400, 'BAD_REQUEST', 'Request body could not be read.'); } }
      body = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
      headers.set('content-type', 'application/json'); headers.set('origin', url.origin); headers.set('sec-fetch-site', 'same-origin');
    }
    try {
      const upstream = await fetch(`${origin}${url.pathname}${url.search}`, { method: request.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(55_000) });
      if (!upstream.headers.get('content-type')?.includes('application/json')) { await upstream.body?.cancel(); return problem(502, 'INVALID_UPSTREAM', 'The configured API did not return JSON. Check its origin and reverse-proxy routing.'); }
      const responseHeaders = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      const retry = upstream.headers.get('retry-after'); if (retry) responseHeaders.set('retry-after', retry);
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch { return problem(502, 'UPSTREAM_UNAVAILABLE', 'The catalogue API could not be reached. Check that the Node API is running.'); }
  },
};''')
w('public/_routes.json','{"version":1,"include":["/api/*"],"exclude":[]}')
w('public/_headers', '''/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https:; media-src 'self' https: blob:; worker-src 'self' blob:; frame-src 'self' https://megaplay.buzz; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
/assets/*
  Cache-Control: public, max-age=31536000, immutable''')
w('tests/client.test.ts', '''import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, readResponse } from '../src/lib/api';
import { decodeStored } from '../src/lib/storage';
afterEach(() => vi.unstubAllGlobals());
describe('API contracts', () => {
  it('rejects static-host HTML instead of rendering it as catalogue data', async () => { await expect(readResponse(new Response('<!doctype html><div id="root"></div>', { headers: { 'content-type': 'text/html' } }))).rejects.toMatchObject({ problem: { code: 'API_NOT_CONFIGURED' } }); });
  it.each(['null', '1', 'broken json'])('rejects incomplete JSON: %s', async (body) => { await expect(readResponse(new Response(body, { headers: { 'content-type': 'application/json' } }))).rejects.toBeInstanceOf(ApiError); });
  it('preserves an actionable backend error', async () => { await expect(readResponse(Response.json({ error: { code: 'UNAVAILABLE', message: 'No mapping found.' } }, { status: 404 }))).rejects.toMatchObject({ message: 'No mapping found.', problem: { status: 404 } }); });
  it.each(['catalogue', 'title', 'providers', 'filters'] as const)('validates the %s payload', async (kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})));
    const result = kind === 'catalogue' ? api.catalogue({}) : kind === 'title' ? api.title('test') : kind === 'providers' ? api.providers('1', 'sub') : api.filters();
    await expect(result).rejects.toMatchObject({ problem: { code: 'INVALID_RESPONSE' } });
  });
  it('explains connection failures and preserves caller cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline'))); await expect(api.title('test')).rejects.toMatchObject({ problem: { code: 'NETWORK_ERROR' } });
    const controller = new AbortController(); controller.abort(); const reason = new DOMException('Cancelled', 'AbortError'); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(reason));
    await expect(api.title('test', controller.signal)).rejects.toBe(reason);
  });
});
describe('saved browser data', () => {
  it.each([null, false, 1, {}, 'bad'])('recovers malformed watchlist: %j', (value) => { expect(decodeStored('watchlist-records', value, [])).toEqual([]); });
  it('filters bad entries and deduplicates without losing valid titles', () => {
    const title = { id: '1', slug: 'test', name: 'A title', genres: [null, 'Drama'], releaseYear: 'wrong' };
    const result = decodeStored<any[]>('watchlist-records', [null, { id: 'invalid' }, title, title], []);
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ id: '1', name: 'A title', genres: ['Drama'] });
  });
  it('merges valid legacy preferences with safe defaults', () => { expect(decodeStored('preferences', { theme: 'light', preferredLanguage: 'dub', autoplayNext: 'true' }, {})).toMatchObject({ theme: 'light', preferredLanguage: 'dub', autoplayNext: false, rememberProgress: true }); });
  it.each([-1, Number.NaN, Infinity, '20'])('discards invalid progress: %s', (value) => { expect(decodeStored('progress:1:sub:test', value, 0)).toBe(0); });
  it('keeps finite progress and ignores malformed history', () => { expect(decodeStored('progress:1:sub:test', 22.5, 0)).toBe(22.5); expect(decodeStored('history', [null, { title: 'incomplete' }], [])).toEqual([]); });
});''')
w('tests/gateway.test.ts', '''import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Deployment entrypoint is tested against standard Web APIs.
import worker, { apiOrigin } from '../public/_worker.js';
const env = { SOLANIME_API_ORIGIN: 'https://api.example.com', ASSETS: { fetch: vi.fn(async () => new Response('asset')) } };
afterEach(() => vi.unstubAllGlobals());
describe('optional Pages gateway', () => {
  it('returns JSON when the Node API is not configured', async () => { const result = await worker.fetch(new Request('https://solanime.example/api/titles'), { ASSETS: env.ASSETS }); expect(result.status).toBe(503); expect((await result.json()).error.code).toBe('API_NOT_CONFIGURED'); });
  it('passes assets through and does not expose private endpoints', async () => {
    expect(await (await worker.fetch(new Request('https://solanime.example/catalogue'), env)).text()).toBe('asset');
    for (const path of ['/api/admin/backup', '/api/exports/catalogue.json', '/api/fetch?url=https://other.example']) expect((await worker.fetch(new Request(`https://solanime.example${path}`), env)).status).toBe(404);
  });
  it.each(['http://api.example.com', 'https://user:secret@api.example.com', 'https://api.example.com/path', 'https://127.0.0.1', 'https://[::1]', 'https://solanime.example'])('rejects unsafe origin %s', (url) => { expect(() => apiOrigin(url, 'https://solanime.example')).toThrow(); });
  it('forwards only to the configured origin and strips private browser headers', async () => {
    const spy = vi.fn().mockResolvedValue(Response.json({ status: 'ok' })); vi.stubGlobal('fetch', spy);
    const result = await worker.fetch(new Request('https://solanime.example/api/titles?q=test', { headers: { cookie: 'session=private', 'x-admin-token': 'private' } }), env);
    expect(result.status).toBe(200); expect(spy.mock.calls[0][0]).toBe('https://api.example.com/api/titles?q=test'); expect(spy.mock.calls[0][1].headers.has('cookie')).toBe(false); expect(spy.mock.calls[0][1].headers.has('x-admin-token')).toBe(false); expect(spy.mock.calls[0][1].redirect).toBe('error');
  });
  it('rejects foreign-origin POSTs and oversized bodies', async () => {
    expect((await worker.fetch(new Request('https://solanime.example/api/providers/1/resolve', { method: 'POST', body: '{}', headers: { origin: 'https://other.example', 'content-type': 'application/json' } }), env)).status).toBe(403);
    expect((await worker.fetch(new Request('https://solanime.example/api/providers/1/resolve', { method: 'POST', body: 'x'.repeat(20000), headers: { 'content-type': 'application/json' } }), env)).status).toBe(413);
  });
  it('does not pass HTML backend failures off as data', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }))); expect((await worker.fetch(new Request('https://solanime.example/api/health'), env)).status).toBe(502); });
});''')
w('tests/runtime-regressions.test.ts', '''import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app'; import { openDatabase, migrate } from '../server/db'; import { requireSafeMutation } from '../server/security';
const disposers: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose(); vi.unstubAllEnvs(); });
function temp() { const dir = mkdtempSync(join(tmpdir(), 'solanime-regression-')); disposers.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }
async function runtime() {
  const root = temp(); const dist = join(root, 'dist'); mkdirSync(dist); mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Sol Anime</title><div id="root"></div>'); writeFileSync(join(dist, 'assets', 'app-test.js'), 'console.log("asset")');
  writeFileSync(join(dist, '.env'), 'SECRET=private'); writeFileSync(join(root, 'outside.js'), 'private'); symlinkSync(join(root, 'outside.js'), join(dist, 'leak.js'));
  const db = openDatabase(':memory:'); migrate(db); const server = createApp(db, { staticDirectory: dist });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  disposers.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
describe('production runtime', () => {
  it('serves deep links, HEAD, and conditional requests', async () => {
    const origin = await runtime(); const response = await fetch(`${origin}/watch/title/1?language=sub`); expect(response.status).toBe(200); expect(await response.text()).toContain('<title>Sol Anime'); expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const asset = await fetch(`${origin}/assets/app-test.js`); expect(asset.headers.get('cache-control')).toContain('immutable'); expect((await fetch(`${origin}/assets/app-test.js`, { headers: { 'if-none-match': asset.headers.get('etag')! } })).status).toBe(304);
    const head = await fetch(`${origin}/catalogue`, { method: 'HEAD' }); expect(head.status).toBe(200); expect(await head.text()).toBe('');
  });
  it('does not serve API failures, missing assets, dotfiles or escaping symlinks as HTML', async () => {
    const origin = await runtime(); for (const path of ['/api/not-real', '/assets/missing.js', '/.env', '/leak.js', '/%5c..%5c.env', '/_worker.js']) { const response = await fetch(origin + path); expect(response.status, path).toBe(404); expect(response.headers.get('content-type')).toContain('application/json'); }
  });
  it('detects LFS pointers without overwriting them', () => {
    const path = join(temp(), 'data.sqlite'); const pointer = 'version https://git-lfs.github.com/spec/v1\\noid sha256:' + 'a'.repeat(64) + '\\nsize 1234\\n'; writeFileSync(path, pointer); expect(() => openDatabase(path)).toThrow(/lfs/i); expect(readFileSync(path, 'utf8')).toBe(pointer);
  });
});
describe('mutation origins', () => {
  it('does not trust another localhost port', () => { expect(() => requireSafeMutation({ host: '127.0.0.1:8787', origin: 'http://127.0.0.1:9999', 'content-type': 'application/json' }, { requireJson: true })).toThrow(); });
  it('allows an exact origin or configured gateway', () => {
    expect(() => requireSafeMutation({ host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' }, { requireJson: true })).not.toThrow();
    vi.stubEnv('SOLANIME_ALLOWED_ORIGINS', 'https://solanime.pages.dev'); expect(() => requireSafeMutation({ host: 'api.example.com', origin: 'https://solanime.pages.dev', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, { requireJson: true })).not.toThrow();
  });
});''')
