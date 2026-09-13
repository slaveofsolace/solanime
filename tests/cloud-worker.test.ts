import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleCloudRequest, isReadOnlyReviewRoute } from '../server/cloud/worker';
import { RELEASE } from '../shared/release';
import { importHash } from '../server/cloud/data/import';
import { IMPORT_TABLES } from '../server/cloud/data/import-schema';
import { NATIVE_RESEARCH_RECORDS } from '../server/providers/native-registry';
import {
  OFFICIAL_YOUTUBE_EMBED_BASIS,
  REMOW_PUBLISHER,
} from '../server/providers/youtubeOfficial';
import { encodeBytes } from '../server/cloud/auth/crypto';
import { generatedTestApiKey } from './helpers/auth-material';

// These rows live only in isolated, ephemeral D1 databases. They are transport and
// SQL fixtures, not imported catalogue records or evidence of live media playback.
const origin = 'https://worker-contract.example.test';
const operatorToken = 'test-only-operator-token-with-at-least-32-characters';
const observed = '2026-09-12T00:00:00.000Z';
let runtime: Miniflare;
let env: CloudEnv;
let schemaVersion: number;

function statements(sql: string): string[] {
  const result: string[] = []; let current = ''; let quote = ''; let comment = false;
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index]; const next = sql[index + 1];
    if (comment) { if (char === '\n') { comment = false; current += ' '; } continue; }
    if (!quote && char === '-' && next === '-') { comment = true; index++; continue; }
    if (quote) { current += char; if (char === quote) { if (next === quote) { current += next; index++; } else quote = ''; } continue; }
    if (char === "'" || char === '"') { quote = char; current += char; continue; }
    if (char === ';') { if (current.trim()) result.push(current.trim()); current = ''; } else current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function accountStatements(sql: string): string[] {
  const result: string[] = [];
  const trigger = /CREATE\s+TRIGGER[\s\S]*?\bEND\s*;/gi;
  let offset = 0;
  for (const match of sql.matchAll(trigger)) {
    result.push(...statements(sql.slice(offset, match.index)));
    result.push(match[0].trim().replace(/;\s*$/, ''));
    offset = (match.index ?? 0) + match[0].length;
  }
  result.push(...statements(sql.slice(offset)));
  return result;
}

type WorkerOverrides = Partial<CloudEnv> & { SOLANIME_READ_ONLY_REVIEW?: string };
function request(path: string, init: RequestInit = {}, overrides: WorkerOverrides = {}) {
  return handleCloudRequest(new Request(origin + path, init), { ...env, ...overrides });
}
function mutation(value: unknown, headers: HeadersInit = {}): RequestInit {
  const combined = new Headers({ origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' });
  new Headers(headers).forEach((value, key) => combined.set(key, value));
  return { method: 'POST', headers: combined, body: JSON.stringify(value) };
}
function operator(headers: HeadersInit = {}): Headers {
  const result = new Headers(headers); result.set('x-admin-token', operatorToken); return result;
}

beforeAll(async () => {
  const cacheRoot = fileURLToPath(new URL('../.cache/cloud-worker-contract/', import.meta.url));
  mkdirSync(cacheRoot, { recursive: true });
  runtime = new Miniflare({ ...convertV4MiniflareOptions({ name: 'cloud-worker-contract', modules: true,
    script: 'export default { fetch() { return new Response("test-only") } }',
    compatibilityDate: '2026-09-12', compatibilityFlags: ['nodejs_compat'],
    d1Databases: { CATALOGUE: 'worker-test-catalogue', ACCOUNTS: 'worker-test-private', RESEARCH: 'worker-test-research', EMPTY: 'worker-test-unmigrated' },
  }), resourceTmpPath: mkdtempSync(cacheRoot + 'runtime-') });
  const catalogue = await runtime.getD1Database('CATALOGUE');
  const research = await runtime.getD1Database('RESEARCH');
  const accounts = await runtime.getD1Database('ACCOUNTS');
  const migrations = readdirSync(new URL('../migrations/cloud/catalogue/', import.meta.url)).filter(file => file.endsWith('.sql')).sort();
  // Wrangler owns this migration ledger in hosted D1; mirror it while applying
  // the exact checked-in migrations manually in this isolated test database.
  await catalogue.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)').run();
  for (const file of migrations) {
    for (const sql of statements(readFileSync(new URL(`../migrations/cloud/catalogue/${file}`, import.meta.url), 'utf8'))) await catalogue.prepare(sql).run();
    await catalogue.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(file).run();
  }
  schemaVersion = migrations.length;
  for (const sql of statements(readFileSync(new URL('../migrations/cloud/research/001_research.sql', import.meta.url), 'utf8'))) await research.prepare(sql).run();
  const accountMigrations = readdirSync(new URL('../migrations/cloud/accounts/', import.meta.url)).filter(file => file.endsWith('.sql')).sort();
  for (const file of accountMigrations) {
    const migration = readFileSync(new URL(`../migrations/cloud/accounts/${file}`, import.meta.url), 'utf8');
    for (const sql of accountStatements(migration)) await accounts.prepare(sql).run();
  }
  env = {
    CATALOGUE: catalogue, RESEARCH: research, ACCOUNTS: accounts,
    API_LIMITER: { async limit() { return { success: true }; } },
    RESOLVE_LIMITER: { async limit() { return { success: true }; } },
    SYNC_QUEUE: {
      async metrics() { return { backlogCount: 0, backlogBytes: 0 }; },
      async send() { return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } }; },
      async sendBatch() { return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } }; },
    },
    IMPORT_ASSETS: {
      async fetch() { return new Response('No snapshot assets in this isolated test', { status: 404 }); },
      connect() { throw Error('Socket connections are outside this test'); },
    },
    SOLANIME_APP_ORIGIN: origin, SOLANIME_ALLOWED_ORIGINS: '', SOLANIME_REGISTRATION: 'closed',
    SOLANIME_ADMIN_TOKEN: operatorToken, FIREBASE_PROJECT_ID: '', FIREBASE_API_KEY: '',
    FIREBASE_SERVICE_ACCOUNT_JSON: '', AUTH_CREDENTIAL_KEY: '', RELEASE_CHANNEL: 'test',
    SYNC_ENABLED: 'false', SYNC_DAILY_WRITE_BUDGET: '75000', SYNC_DAILY_QUEUE_BUDGET: '2500',
    SOURCE_REFRESH_ENABLED: 'false', IMPORT_MANIFEST_PATH: '/test-only-manifest.json', IMPORT_MANIFEST_SHA256: '0'.repeat(64),
    CATALOGUE_BASELINE_ENABLED: 'false', CATALOGUE_BASELINE_ID: '0'.repeat(64),
    CATALOGUE_BASELINE_MANIFEST_SHA256: '0'.repeat(64),
  };
  for (const [id, name] of [[1, 'Contract Alpha'], [2, 'Contract Beta']] as const) {
    await catalogue.prepare('INSERT INTO titles(id,source_id,slug,canonical_url,name,description,format,status,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, `test-${id}`, `test-${id}`, `https://example.test/test-${id}`, name, 'Test-only metadata', 'Movie', 'Finished Airing', observed, observed, observed, observed).run();
  }
  await catalogue.prepare("INSERT INTO title_aliases(title_id,alias,language) VALUES(1,'Literal_%_Alias','en')").run();
  await catalogue.prepare("INSERT INTO genres(id,slug,name) VALUES(1,'test-genre','Test Genre')").run();
  await catalogue.prepare('INSERT INTO title_genres(title_id,genre_id) VALUES(1,1)').run();
  await catalogue.prepare('INSERT INTO episodes(id,title_id,source_id,number_text,number_sort,slug,canonical_url,first_seen_at,last_seen_at,created_at,updated_at) VALUES(10,1,?,?,?,?,?,?,?,?,?)')
    .bind('test-special', 'Special 0.5', 0.5, 'special', 'https://example.test/test-1/special', observed, observed, observed, observed).run();
  await catalogue.prepare('INSERT INTO episode_versions(id,episode_id,source_id,language,first_seen_at,last_seen_at) VALUES(20,10,?,?,?,?),(21,10,?,?,?,?)')
    .bind('test-sub', 'sub', observed, observed, 'test-dub', 'dub', observed, observed).run();
  await catalogue.prepare("INSERT INTO providers(id,label,identity_state,playback_type,adapter_state,updated_at) VALUES('internet-archive','Internet Archive','confirmed','direct','implemented',?)").bind(observed).run();
  for (const [id, version, provider, resource] of [[30, 20, 'hd-1', 'PRIVATE_STABLE_REFERENCE'], [31, 20, 'internet-archive', 'test-public-item'], [32, 21, 'hd-2', 'private-dub-ref']] as const) {
    await catalogue.prepare('INSERT INTO episode_provider_mappings(id,version_id,provider_id,source_mapping_id,provider_resource_id,first_seen_at,last_seen_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(id, version, provider, `test-mapping-${id}`, resource, observed, observed, observed).run();
  }
  await catalogue.prepare('INSERT INTO native_resources(mapping_id,provider_id,resource_id,language,edition,license,rights_evidence_url,identity_evidence_url,approved_at,enabled) VALUES(31,?,?,?,?,?,?,?,?,1)')
    .bind('internet-archive', 'test-public-item', 'sub', 'Test edition', 'Test rights declaration', 'https://example.test/rights', 'https://example.test/identity', observed).run();
  await research.prepare('INSERT INTO research_records(id,collection,source_id,name,kind,url,research_status,evidence_class,provenance_path,record_json,record_hash,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('test-source', 'sites', 'test-source', 'Research-only source', 'site', 'https://example.test', 'unverified', 'public_reference', 'test-only/evidence.json', '{"claim":"iframe-only","runtime_verified":false}', 'a'.repeat(64), observed).run();
  await research.prepare("INSERT INTO research_categories(record_id,category) VALUES('test-source','anime')").run();
}, 60_000);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(async () => { await runtime?.dispose(); });

describe('Worker API against actual D1', () => {
  it('returns versioned JSON health without waiting for unconfigured managed authentication', async () => {
    const response = await request('/api/health', { headers: { cookie: '__Host-solanime_session=' + 'a'.repeat(43), authorization: 'Bearer test-private-token' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', release: RELEASE, runtime: 'cloudflare-workers', database: 'connected', schemaVersion, titles: 2 });
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const session = await request('/api/account/session');
    expect(session.status).toBe(503);
    expect(await session.json()).toMatchObject({ error: { code: 'UNAVAILABLE', details: { reason: 'AUTH_NOT_CONFIGURED' } } });
  });

  it('makes read-only review a default-deny surface and resolves without recording evidence', async () => {
    const review = { SOLANIME_READ_ONLY_REVIEW: 'true' };
    expect([
      ['GET', '/api/health'], ['GET', '/api/meta/filters'], ['GET', '/api/titles'],
      ['GET', '/api/titles/test-1'], ['GET', '/api/episodes/10/providers'], ['POST', '/api/providers/31/resolve'],
    ].every(([method, path]) => isReadOnlyReviewRoute(method, path))).toBe(true);
    expect([
      ['GET', '/api/account/session'], ['POST', '/api/account/register'], ['POST', '/api/account/login'],
      ['POST', '/api/account/recover'], ['POST', '/api/account/logout'], ['POST', '/api/account/revoke-other-sessions'],
      ['POST', '/api/account/password'], ['POST', '/api/account/recovery-code'], ['POST', '/api/account/delete'],
      ['POST', '/api/account/profiles'], ['POST', '/api/episodes/10/comments'], ['DELETE', '/api/episodes/10/comments/11111111-1111-4111-8111-111111111111'],
      ['POST', '/api/admin/providers/31/verification'], ['POST', '/api/admin/sources/test-source/review'],
      ['POST', '/api/admin/import/start'], ['POST', '/api/admin/import/batch'], ['POST', '/api/admin/import/dispatch'],
      ['POST', '/api/admin/import/1/pause'], ['POST', '/api/admin/import/1/resume'], ['POST', '/api/admin/import/1/retry'],
      ['POST', '/api/admin/sync/start'], ['POST', '/api/admin/sync/control'], ['POST', '/api/admin/artwork/refresh'],
      ['GET', '/api/admin/sources'], ['GET', '/api/exports/catalogue.json'], ['DELETE', '/api/health'],
    ].some(([method, path]) => isReadOnlyReviewRoute(method, path))).toBe(false);
    for (const [method, path] of [
      ['POST', '/api/account/register'], ['POST', '/api/episodes/10/comments'], ['POST', '/api/admin/import/batch'],
      ['POST', '/api/admin/sync/control'], ['POST', '/api/admin/providers/31/verification'], ['GET', '/api/exports/catalogue.json'],
    ]) {
      const response = await request(path, method === 'GET' ? { method } : mutation({ enabled: true }), review);
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    const before = await env.CATALOGUE.prepare('SELECT last_successful_resolution_at,last_playback_verification_at,resolution_evidence_state FROM episode_provider_mappings WHERE id=31').first();
    const send = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === 'https://archive.org/metadata/test-public-item') return Response.json({ metadata: { identifier: 'test-public-item' }, files: [{ name: 'test movie.mp4', format: 'h.264 IA' }] });
      expect(init?.method).toBe('HEAD'); return new Response(null, { headers: { 'content-type': 'video/mp4' } });
    });
    vi.stubGlobal('fetch', send);
    const resolution = await request('/api/providers/31/resolve', mutation({ language: 'sub' }), review);
    expect(resolution.status).toBe(200);
    expect(await resolution.json()).toMatchObject({ mappingId: '31', kind: 'native', status: 'resolved' });
    expect(await env.CATALOGUE.prepare('SELECT last_successful_resolution_at,last_playback_verification_at,resolution_evidence_state FROM episode_provider_mappings WHERE id=31').first()).toEqual(before);
  });

  it('routes public episode community reads through the private accounts database with catalogue validation', async () => {
    const configured = {
      FIREBASE_PROJECT_ID: 'solanime-community-contract',
      FIREBASE_API_KEY: generatedTestApiKey(),
      AUTH_CREDENTIAL_KEY: encodeBytes(new Uint8Array(32).fill(21)),
    };
    const response = await request('/api/episodes/10/comments?page=1&pageSize=20', {}, configured);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], total: 0, page: 1, pageSize: 20, pages: 1 });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await request('/api/episodes/999/comments', {}, configured)).status).toBe(404);
    expect((await env.ACCOUNTS.prepare('SELECT version FROM account_schema ORDER BY version').all()).results)
      .toEqual([{ version: 1 }, { version: 2 }]);
  });

  it('uses database search, shareable filters and genuine pagination exhaustion', async () => {
    const search = await request('/api/titles?q=Literal_%25_Alias&genre=test-genre&type=movie&language=sub&pageSize=1&facets=false');
    expect(await search.json()).toMatchObject({ total: 1, page: 1, pages: 1, items: [{ id: '1', slug: 'test-1', episodeCount: 1 }] });
    expect(await (await request('/api/titles?page=2&pageSize=1&facets=false')).json()).toMatchObject({ total: 2, items: [{ id: '2' }] });
    expect(await (await request('/api/titles?page=3&pageSize=1')).json()).toMatchObject({ total: 2, items: [] });
    expect(await (await request('/api/meta/filters')).json()).toMatchObject({ genres: [{ value: 'test-genre', count: 1 }], languages: [{ value: 'dub' }, { value: 'sub' }] });
    expect(await (await request('/api/titles?q=' + encodeURIComponent("' OR 1=1 --"))).json()).toMatchObject({ total: 0, items: [] });
  });

  it('uses only the configured private asset binding for an enabled catalogue baseline', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await request('/api/titles?facets=false', {}, {
      IMPORT_ASSETS: { fetch, connect() { throw Error('No sockets in fixture.'); } },
      CATALOGUE_BASELINE_ENABLED: 'true',
      CATALOGUE_BASELINE_ID: 'a'.repeat(64),
      CATALOGUE_BASELINE_MANIFEST_SHA256: 'b'.repeat(64),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'UNAVAILABLE' } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`https://assets.local/__private-baseline/${'a'.repeat(64)}/manifest.json`, { redirect: 'manual' });
  });

  it.each(['/api/titles?page=0', '/api/titles?pageSize=101', '/api/titles?page=1.5', '/api/titles?q=%00', '/api/titles?q=' + 'x'.repeat(201), '/api/titles/%E0%A4%A', '/api/episodes/9007199254740992/providers'])('rejects malformed input: %s', async path => {
    const response = await request(path); expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error.code');
  });

  it('keeps irregular episodes and sub/dub mappings distinct without returning private resource references', async () => {
    const detail = await (await request('/api/titles/test-1')).json();
    expect(detail).toMatchObject({ title: { id: '1' }, episodes: [{ id: '10', number: 'Special 0.5', versions: [{ id: '21', language: 'dub', providerCount: 1 }, { id: '20', language: 'sub', providerCount: 2 }] }] });
    const choices = await (await request('/api/episodes/10/providers?language=sub')).json();
    expect(choices).toMatchObject({ version: { id: '20', language: 'sub' }, providers: [{ mappingId: '30', providerId: 'hd-1', supported: false, kind: 'unsupported', playbackType: 'iframe', reasonCode: 'PROVIDER_EMBED_ONLY' }, { mappingId: '31', providerId: 'internet-archive', supported: true, kind: 'native' }] });
    expect(JSON.stringify(choices)).not.toContain('PRIVATE_STABLE_REFERENCE');
    expect(JSON.stringify(choices)).not.toContain('test-public-item');
    expect(await (await request('/api/episodes/10/providers?language=dub')).json()).toMatchObject({ providers: [{ mappingId: '32', providerId: 'hd-2', supported: false, kind: 'unsupported', playbackType: 'iframe', reasonCode: 'PROVIDER_EMBED_ONLY' }] });
    expect((await request('/api/episodes/10/providers?language=other')).status).toBe(404);
  });

  it('does not advertise an enabled but unrelated provider approval as supported playback', async () => {
    await env.CATALOGUE.prepare('INSERT INTO native_resources(mapping_id,provider_id,resource_id,language,edition,license,rights_evidence_url,identity_evidence_url,approved_at,enabled) VALUES(30,?,?,?,?,?,?,?,?,1)')
      .bind('internet-archive', 'test-public-item', 'sub', 'Wrong mapping', 'Test', 'https://example.test/rights', 'https://example.test/identity', observed).run();
    try {
      const choices = await (await request('/api/episodes/10/providers?language=sub')).json() as { providers: Array<{ mappingId: string; supported: boolean; status: string }> };
      expect(choices.providers.find((provider: { mappingId: string }) => provider.mappingId === '30')).toMatchObject({ supported: false, kind: 'unsupported', status: 'unsupported', playbackType: 'iframe' });
    } finally { await env.CATALOGUE.prepare('DELETE FROM native_resources WHERE mapping_id=30').run(); }
  });

  it.each([
    ['resource_id', 'different-item', 'test-public-item'],
    ['provider_id', 'hd-1', 'internet-archive'],
    ['language', 'dub', 'sub'],
    ['approved_at', '', observed],
    ['license', '', 'Test rights declaration'],
    ['rights_evidence_url', 'http://example.test/rights', 'https://example.test/rights'],
    ['identity_evidence_url', '', 'https://example.test/identity'],
    ['enabled', 0, 1],
  ] as const)('keeps provider choices consistent with native resolver checks for %s', async (column, invalid, original) => {
    // Column names come exclusively from the test matrix, never an API parameter.
    await env.CATALOGUE.prepare(`UPDATE native_resources SET ${column}=? WHERE mapping_id=31`).bind(invalid).run();
    try {
      const choices = await (await request('/api/episodes/10/providers?language=sub')).json() as { providers: Array<{ mappingId: string; supported: boolean; status: string }> };
      expect(choices.providers.find(provider => provider.mappingId === '31')).toMatchObject({ supported: false, status: 'unsupported' });
    } finally { await env.CATALOGUE.prepare(`UPDATE native_resources SET ${column}=? WHERE mapping_id=31`).bind(original).run(); }
  });

  it('requires explicit same-origin mutation intent and enforces bounded JSON requests', async () => {
    expect((await request('/api/providers/31/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await request('/api/providers/31/resolve', mutation({}, { origin: 'https://foreign.example.test' }))).status).toBe(403);
    expect((await request('/api/providers/31/resolve', mutation({}, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect((await request('/api/providers/31/resolve', mutation({}, { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await request('/api/providers/31/resolve', mutation('x'.repeat(17000)))).status).toBe(413);
    expect((await request('/api/providers/31/resolve', mutation([]))).status).toBe(400);
    expect((await request('/api/providers/31/resolve', mutation({ language: 'dub' }))).status).toBe(400);
  });

  it('rejects a documented provider embed without fetching or exposing it', async () => {
    const send = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe('https://anikototv.to/ajax/server');
      expect(url.searchParams.get('get')).toBe('PRIVATE_STABLE_REFERENCE');
      expect(init?.redirect).toBe('manual');
      const headers = new Headers(init?.headers);
      expect(headers.get('x-requested-with')).toBe('XMLHttpRequest');
      expect(headers.has('referer')).toBe(false);
      expect(headers.has('origin')).toBe(false);
      return Response.json({ status: 200, result: { url: 'https://megaplay.buzz/stream/s-2/123/sub' } });
    });
    vi.stubGlobal('fetch', send);
    const response = await request('/api/providers/30/resolve', mutation({ language: 'sub', url: 'http://127.0.0.1/private' }));
    expect(response.status).toBe(422);
    const result = await response.json();
    expect(result).toMatchObject({ mappingId: '30', kind: 'unsupported', status: 'unsupported', error: { code: 'PROVIDER_EMBED_ONLY' } });
    expect(result).not.toHaveProperty('embedUrl');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_STABLE_REFERENCE');
    expect(send).not.toHaveBeenCalled();
    const stored = await env.CATALOGUE.prepare('SELECT last_successful_resolution_at,last_playback_verification_at,resolution_evidence_state FROM episode_provider_mappings WHERE id=30').first();
    expect(stored).toMatchObject({ last_successful_resolution_at: null, last_playback_verification_at: null });
  });

  it('resolves an approved identity via metadata plus HEAD, without persisting temporary URLs or claiming playback', async () => {
    const send = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === 'https://archive.org/metadata/test-public-item') return Response.json({ metadata: { identifier: 'test-public-item' }, files: [{ name: 'test movie.mp4', format: 'h.264 IA' }] });
      expect(String(input)).toBe('https://archive.org/download/test-public-item/test%20movie.mp4');
      expect(init?.method).toBe('HEAD');
      return new Response(null, { headers: { 'content-type': 'video/mp4' } });
    });
    vi.stubGlobal('fetch', send);
    const response = await request('/api/providers/31/resolve', mutation({ language: 'sub', url: 'http://127.0.0.1/ignored' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mappingId: '31', kind: 'native', result: { format: 'direct', providerId: 'internet-archive', allowedMediaHosts: ['archive.org'], captions: [], capabilities: { seek: true, progressEvents: true } } });
    expect(send).toHaveBeenCalledTimes(2);
    const persisted = await env.CATALOGUE.prepare('SELECT * FROM episode_provider_mappings WHERE id=31').first();
    expect(persisted).toMatchObject({ resolution_evidence_state: 'resolved', last_playback_verification_at: null });
    expect(persisted?.last_successful_resolution_at).toEqual(expect.any(String));
    expect(JSON.stringify(persisted)).not.toContain('test%20movie.mp4');
  });

  it('fails closed on malformed upstream metadata and rejects redirects to private destinations before requesting them', async () => {
    const malformed = vi.fn<typeof fetch>(async () => Response.json({ files: [] })); vi.stubGlobal('fetch', malformed);
    let response = await request('/api/providers/31/resolve', mutation({ language: 'sub' }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ result: { kind: 'unsupported', error: { code: 'UPSTREAM_SCHEMA_CHANGED' } } });
    const unsafe = vi.fn<typeof fetch>(async input => String(input).includes('/metadata/')
      ? Response.json({ metadata: { identifier: 'test-public-item' }, files: [{ name: 'movie.mp4', format: 'MPEG4' }] })
      : new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
    vi.stubGlobal('fetch', unsafe);
    response = await request('/api/providers/31/resolve', mutation({}));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ result: { error: { code: 'UNSAFE_MEDIA_DESTINATION' } } });
    expect(unsafe).toHaveBeenCalledTimes(2);
    expect(unsafe.mock.calls.every(([input]) => new URL(String(input)).hostname === 'archive.org')).toBe(true);
  });

  it('keeps the exact official YouTube approval playable through D1 without exposing a media URL', async () => {
    const videoId = '_3Gcm-iGAQk';
    await env.CATALOGUE.prepare("INSERT INTO providers(id,label,identity_state,playback_type,adapter_state,hostname,updated_at) VALUES('youtube-official','YouTube · Official publisher','confirmed','iframe','implemented','www.youtube-nocookie.com',?)").bind(observed).run();
    await env.CATALOGUE.prepare("INSERT INTO episode_provider_mappings(id,version_id,provider_id,source_mapping_id,provider_resource_id,first_seen_at,last_seen_at,updated_at) VALUES(34,20,'youtube-official','test-remow-b-project',?,?,?,?)")
      .bind(videoId, observed, observed, observed).run();
    await env.CATALOGUE.prepare('INSERT INTO native_resources(mapping_id,provider_id,resource_id,language,edition,license,rights_evidence_url,identity_evidence_url,approved_at,enabled) VALUES(34,?,?,?,?,?,?,?,?,1)')
      .bind('youtube-official', videoId, 'sub', 'Test-only REMOW reviewed episode', OFFICIAL_YOUTUBE_EMBED_BASIS,
        `https://www.youtube.com/watch?v=${videoId}`, REMOW_PUBLISHER.channelUrl, observed).run();
    try {
      const choices = await (await request('/api/episodes/10/providers?language=sub')).json() as { providers: Array<{ mappingId: string; supported: boolean; kind: string }> };
      expect(choices.providers.find(provider => provider.mappingId === '34')).toMatchObject({
        supported: true,
        kind: 'official-youtube',
      });
      const network = vi.fn();
      vi.stubGlobal('fetch', network);
      const response = await request('/api/providers/34/resolve', mutation({ language: 'sub' }));
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toMatchObject({
        mappingId: '34',
        kind: 'official-youtube',
        providerId: 'youtube-official',
        delivery: 'provider',
        playbackType: 'iframe',
        videoId,
        allowedEmbedHosts: ['www.youtube-nocookie.com'],
        publisher: REMOW_PUBLISHER,
      });
      expect(result).not.toHaveProperty('url');
      expect(result).not.toHaveProperty('embedUrl');
      expect(network).not.toHaveBeenCalled();
      expect(await env.CATALOGUE.prepare('SELECT resolution_evidence_state,last_playback_verification_at FROM episode_provider_mappings WHERE id=34').first())
        .toMatchObject({ resolution_evidence_state: 'resolved', last_playback_verification_at: null });
      await env.CATALOGUE.prepare("UPDATE native_resources SET identity_evidence_url='https://www.youtube.com/channel/UC-not-allowlisted' WHERE mapping_id=34").run();
      const rejected = await (await request('/api/episodes/10/providers?language=sub')).json() as { providers: Array<{ mappingId: string; supported: boolean }> };
      expect(rejected.providers.find(provider => provider.mappingId === '34')).toMatchObject({ supported: false });
    } finally {
      await env.CATALOGUE.prepare('DELETE FROM native_resources WHERE mapping_id=34').run();
      await env.CATALOGUE.prepare('DELETE FROM episode_provider_mappings WHERE id=34').run();
      await env.CATALOGUE.prepare("DELETE FROM providers WHERE id='youtube-official'").run();
    }
  });

  it('routes Commons through its own reviewed file/hash approval and does not confuse resolution with playback', async () => {
    const title = 'File:Contract silent film.webm';
    const media = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Contract_silent_film.webm';
    await env.CATALOGUE.prepare("INSERT INTO providers(id,label,identity_state,playback_type,adapter_state,updated_at) VALUES('wikimedia-commons','Wikimedia Commons','confirmed','direct','implemented',?)").bind(observed).run();
    await env.CATALOGUE.prepare("INSERT INTO episode_provider_mappings(id,version_id,provider_id,source_mapping_id,provider_resource_id,first_seen_at,last_seen_at,updated_at) VALUES(33,20,'wikimedia-commons','test-commons',?,?,?,?)")
      .bind(title, observed, observed, observed).run();
    await env.CATALOGUE.prepare('INSERT INTO native_resources(mapping_id,provider_id,resource_id,language,edition,license,rights_evidence_url,identity_evidence_url,approved_at,enabled,content_sha1) VALUES(33,?,?,?,?,?,?,?,?,1,?)')
      .bind('wikimedia-commons', title, 'sub', 'Test silent edition', 'Public domain', 'https://commons.wikimedia.org/wiki/File:Contract_silent_film.webm', 'https://example.test/identity', observed, 'a'.repeat(40)).run();
    const choices = async () => {
      const body = await (await request('/api/episodes/10/providers?language=sub')).json() as { providers: Array<{ mappingId: string; providerId: string; supported: boolean }> };
      return body.providers.find(provider => provider.mappingId === '33');
    };
    try {
      expect(await choices()).toMatchObject({ providerId: 'wikimedia-commons', supported: true });
      await env.CATALOGUE.prepare('UPDATE native_resources SET content_sha1=NULL WHERE mapping_id=33').run();
      expect(await choices()).toMatchObject({ supported: false });
      const unused = vi.fn(); vi.stubGlobal('fetch', unused);
      expect((await request('/api/providers/33/resolve', mutation({ language: 'sub' }))).status).toBe(422);
      expect(unused).not.toHaveBeenCalled();
      await env.CATALOGUE.prepare('UPDATE native_resources SET content_sha1=? WHERE mapping_id=33').bind('a'.repeat(40)).run();
      const send = vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(String(input));
        if (url.hostname === 'commons.wikimedia.org') {
          expect(url.pathname).toBe('/w/api.php'); expect(url.searchParams.get('titles')).toBe(title);
          return Response.json({ query: { pages: [{ ns: 6, title, imageinfo: [{ canonicaltitle: title, mime: 'video/webm', size: 1000,
            sha1: 'a'.repeat(40), url: media + '?utm_source=test-only', extmetadata: { LicenseShortName: { value: 'Public domain' },
              UsageTerms: { value: 'Public domain' }, Copyrighted: { value: 'False' }, Restrictions: { value: '' }, License: { value: 'pd' } } }] }] } });
        }
        expect(url.href).toBe(media); expect(init?.method).toBe('HEAD');
        return new Response(null, { headers: { 'content-type': 'video/webm', 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' } });
      });
      vi.stubGlobal('fetch', send);
      const response = await request('/api/providers/33/resolve', mutation({ language: 'sub' }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ mappingId: '33', result: { kind: 'native', providerId: 'wikimedia-commons', url: media, mediaCrossOrigin: 'anonymous' } });
      expect(send).toHaveBeenCalledTimes(2);
      const stored = await env.CATALOGUE.prepare('SELECT * FROM episode_provider_mappings WHERE id=33').first();
      expect(stored).toMatchObject({ resolution_evidence_state: 'resolved', last_playback_verification_at: null });
      expect(JSON.stringify(stored)).not.toContain('upload.wikimedia.org');
      await env.CATALOGUE.prepare("UPDATE native_resources SET language='dub' WHERE mapping_id=33").run();
      expect(await choices()).toMatchObject({ supported: false });
    } finally {
      await env.CATALOGUE.prepare('DELETE FROM native_resources WHERE mapping_id=33').run();
      await env.CATALOGUE.prepare('DELETE FROM episode_provider_mappings WHERE id=33').run();
      await env.CATALOGUE.prepare("DELETE FROM providers WHERE id='wikimedia-commons'").run();
    }
  });

  it.each(['/api/admin/sources', '/api/admin/sources/test-source', '/api/admin/sources/coverage', '/api/admin/import/status', '/api/admin/sync/status', '/api/exports/catalogue.json', '/api/exports/catalogue.csv', '/api/exports/coverage.csv'])('protects operator data: %s', async path => {
    const response = await request(path); expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('shows restricted research evidence and reviews without promoting declarations into enabled capabilities', async () => {
    const headers = operator();
    expect(await (await request('/api/admin/sources?q=Research&category=anime', { headers })).json()).toMatchObject({ total: 1, items: [{ id: 'test-source', hasImplementedCapability: 0 }] });
    expect(await (await request('/api/admin/sources/test-source', { headers })).json()).toMatchObject({ evidence: { claim: 'iframe-only', runtime_verified: false }, capabilities: [] });
    expect((await request('/api/admin/sources/test-source/review', mutation({ action: 'reviewed' }))).status).toBe(401);
    expect((await request('/api/admin/sources/test-source/review', mutation({ action: 'reviewed' }, operator({ origin: 'https://foreign.example.test' })))).status).toBe(403);
    expect(await (await request('/api/admin/sources/test-source/review', mutation({ action: 'reviewed', note: 'Test-only review' }, headers))).json()).toMatchObject({ capabilitiesChanged: false, action: 'reviewed' });
    expect((await request('/api/admin/sources/test-source/review', mutation({ action: 'enable_playback' }, headers))).status).toBe(400);
    expect(await (await request('/api/admin/sources/coverage', { headers })).json()).toMatchObject({ counts: { implementedCapabilities: 0, verifiedPlaybackCapabilities: 0 } });
  });

  it('rejects malformed research route encoding as a client error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await request('/api/admin/sources/%E0%A4%A', { headers: operator() });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });

  it('keeps raw evidence fragments restricted, ordered and bounded with explicit pagination exhaustion', async () => {
    const path = '/api/admin/sources/test-source/evidence';
    expect((await request(path)).status).toBe(401);
    const fragments = ['{"private":"', 'RESEARCH_', 'EVIDENCE_', 'TEST_', 'ONLY', '"}'];
    await env.RESEARCH.batch(fragments.map((content, index) => env.RESEARCH.prepare('INSERT INTO research_record_fragments(record_id,fragment_index,content) VALUES(?,?,?)')
      .bind('test-source', index, content)));
    try {
      const first = await (await request(path + '?offset=0', { headers: operator() })).json() as { items: Array<{ fragmentIndex: number; content: string }>; nextOffset: number | null };
      expect(first.items.map(item => item.fragmentIndex)).toEqual([0, 1, 2, 3]); expect(first.nextOffset).toBe(4);
      const second = await (await request(path + '?offset=4', { headers: operator() })).json() as typeof first;
      expect(second.items.map(item => item.fragmentIndex)).toEqual([4, 5]); expect(second.nextOffset).toBeNull();
      expect(JSON.parse([...first.items, ...second.items].map(item => item.content).join(''))).toEqual({ private: 'RESEARCH_EVIDENCE_TEST_ONLY' });
      expect(await (await request(path + '?offset=6', { headers: operator() })).json()).toMatchObject({ items: [], nextOffset: null });
      for (const offset of ['-1', '1.5', 'NaN', '100001', '9007199254740992'])
        expect((await request(path + '?offset=' + offset, { headers: operator() })).status).toBe(400);
      expect(await (await request('/api/titles')).text()).not.toContain('RESEARCH_EVIDENCE_TEST_ONLY');
    } finally { await env.RESEARCH.prepare("DELETE FROM research_record_fragments WHERE record_id='test-source'").run(); }
  });

  it('exports paginated catalogue metadata and numeric coverage, without private credentials or resolver resources', async () => {
    const response = await request('/api/exports/catalogue.json?limit=1', { headers: operator() });
    expect(response.status).toBe(200);
    const exported = await response.json();
    expect(exported).toMatchObject({ exportSchemaVersion: 2, items: [{ id: 1 }], nextCursor: 1 });
    expect(JSON.stringify(exported)).not.toMatch(/PRIVATE_STABLE_REFERENCE|password_hash|credential_cipher|test-public-item/);
    const next = await (await request('/api/exports/catalogue.json?limit=1&after=1', { headers: operator() })).json();
    expect(next).toMatchObject({ items: [{ id: 2 }], nextCursor: null });
    const csv = await request('/api/exports/coverage.csv', { headers: operator() });
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(await csv.text()).toContain('titles,2');
  });

  it('bounds CSV pages, quotes embedded CSV syntax and neutralizes spreadsheet formula prefixes', async () => {
    const value = '=HYPERLINK("https://example.test","test")\r\nwith,comma';
    await env.CATALOGUE.prepare('UPDATE titles SET name=? WHERE id=1').bind(value).run();
    try {
      const response = await request('/api/exports/catalogue.csv?limit=1', { headers: operator() });
      expect(response.status).toBe(200);
      expect(response.headers.get('x-export-schema-version')).toBe('2');
      expect(response.headers.get('x-next-cursor')).toBe('1');
      const csv = await response.text();
      expect(csv).toContain('"\'=HYPERLINK(""https://example.test"",""test"")\r\nwith,comma"');
      expect(csv).not.toContain('Contract Beta');
      expect(csv).not.toMatch(/PRIVATE_STABLE_REFERENCE|credential_cipher|password_hash/);
      const next = await request('/api/exports/catalogue.csv?limit=1&after=1', { headers: operator() });
      expect(next.headers.get('x-next-cursor')).toBe(''); expect(await next.text()).toContain('Contract Beta');
      for (const query of ['limit=0', 'limit=101', 'after=-1', 'after=NaN'])
        expect((await request('/api/exports/catalogue.csv?' + query, { headers: operator() })).status).toBe(400);
    } finally { await env.CATALOGUE.prepare("UPDATE titles SET name='Contract Alpha' WHERE id=1").run(); }
  });

  it('preserves rows and gives a bounded Retry-After when an import exhausts its configured allowance', async () => {
    const rows = [{ id: 99, source_id: 'test-import', slug: 'test-import', canonical_url: 'https://example.test/test-import', name: 'Test import',
      first_seen_at: observed, last_seen_at: observed, created_at: observed, updated_at: observed }];
    const batch = { version: 1, id: 'test-quota-batch', table: 'titles', target: 'catalogue', snapshotId: 'test-only', rows, contentHash: await importHash(rows) };
    const response = await request('/api/admin/import/batch', mutation(batch, operator()), { SYNC_DAILY_WRITE_BUDGET: '1' });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: 'IMPORT_QUOTA_PAUSED' } });
    const retry = Number(response.headers.get('retry-after')); expect(retry).toBeGreaterThan(0); expect(retry).toBeLessThanOrEqual(86400);
    expect(await env.CATALOGUE.prepare('SELECT id FROM titles WHERE id=99').first()).toBeNull();
    expect((await env.CATALOGUE.prepare('SELECT COUNT(*) AS count FROM titles').first())?.count).toBe(2);
    expect(await env.CATALOGUE.prepare('SELECT id FROM cloud_import_receipts WHERE id=?').bind(batch.id).first()).toBeNull();
  });

  it('honors API and resolution limits without fetching providers', async () => {
    const denied = { async limit() { return { success: false }; } };
    const first = await request('/api/titles', {}, { API_LIMITER: denied });
    expect(first.status).toBe(429); expect(first.headers.get('retry-after')).toBe('60');
    const send = vi.fn(); vi.stubGlobal('fetch', send);
    const second = await request('/api/providers/31/resolve', mutation({}), { RESOLVE_LIMITER: denied });
    expect(second.status).toBe(429); expect(send).not.toHaveBeenCalled();
  });

  it('requires operator refresh flags and valid input, preserves the snapshot barrier, then creates only one durable seeded run', async () => {
    const path = '/api/admin/sync/start';
    const enabled = { SYNC_ENABLED: 'true', SOURCE_REFRESH_ENABLED: 'true' };
    const value = { key: 'worker-contract-refresh', includeProviders: false };
    expect((await request(path, mutation(value), enabled)).status).toBe(401);
    expect((await request(path, mutation(value, operator({ origin: 'https://foreign.example.test' })), enabled)).status).toBe(403);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const flags of [{}, { SYNC_ENABLED: 'true' }, { SOURCE_REFRESH_ENABLED: 'true' }])
      expect((await request(path, mutation(value, operator()), flags)).status).toBe(503);
    for (const patch of [{ key: 12 }, { key: '' }, { key: '../escape' }, { key: 'x'.repeat(81) }, { includeProviders: 'yes' }])
      expect((await request(path, mutation({ ...value, ...patch }, operator()), enabled)).status).toBe(400);
    await env.CATALOGUE.prepare("INSERT INTO crawl_runs(id,source,mode,status,created_at,updated_at) VALUES(90,'test-only-snapshot','full','running',?,?)").bind(observed, observed).run();
    await env.CATALOGUE.prepare("INSERT INTO crawl_tasks(id,run_id,task_key,task_type,payload_json,status,available_at,created_at,updated_at,checkpoint_json) VALUES(91,90,'snapshot','snapshot_import','{}','pending',?,?,?,'{\"nextBatch\":7}')").bind(observed, observed, observed).run();
    await env.CATALOGUE.prepare('INSERT INTO cloud_snapshot_jobs(id,manifest_path,manifest_hash,source_manifest_hash,run_id,task_id,total_batches,total_rows,created_at) VALUES(?,?,?,?,90,91,10,100,?)')
      .bind('test-only-job', '/test-only.json', 'a'.repeat(64), 'b'.repeat(64), observed).run();
    const send = vi.spyOn(env.SYNC_QUEUE, 'send');
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    try {
      expect((await request('/api/admin/sync/control', mutation({ enabled: true }, operator()), enabled)).status).toBe(200);
      const blocked = await request(path, mutation(value, operator()), enabled);
      expect(blocked.status).toBe(202); expect(await blocked.json()).toMatchObject({ job: { status: 'snapshot_pending' } });
      expect(send).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
      expect(await env.CATALOGUE.prepare('SELECT status,checkpoint_json FROM crawl_tasks WHERE id=91').first()).toEqual({ status: 'pending', checkpoint_json: '{"nextBatch":7}' });
      expect((await env.CATALOGUE.prepare("SELECT COUNT(*) AS count FROM crawl_runs WHERE source LIKE 'anikoto-cloud:%'").first())?.count).toBe(0);
      await env.CATALOGUE.prepare("UPDATE crawl_tasks SET status='completed' WHERE id=91").run();
      const created = await request(path, mutation(value, operator()), enabled);
      expect(created.status).toBe(200);
      const job = await created.json() as { job: { status: string; runId: number } };
      expect(job.job.status).toBe('created'); expect(job.job.runId).toBeGreaterThan(1_000_000_000);
      const repeat = await (await request(path, mutation(value, operator()), enabled)).json();
      expect(repeat).toMatchObject({ job: { status: 'existing', runId: job.job.runId } });
      const tasks = await env.CATALOGUE.prepare('SELECT task_type,payload_json FROM crawl_tasks WHERE run_id=? ORDER BY id').bind(job.job.runId).all<{ task_type: string; payload_json: string }>();
      expect(tasks.results.map(task => task.task_type)).toEqual(['catalogue_page', 'sitemap_index']);
      expect(tasks.results.every(task => JSON.parse(task.payload_json).includeProviders === false)).toBe(true);
      expect(send.mock.calls.length).toBeGreaterThan(0); expect(network).not.toHaveBeenCalled();
      for (const [message] of send.mock.calls) expect(Object.keys(message as object)).toEqual(['taskId']);
    } finally {
      await env.CATALOGUE.prepare("DELETE FROM cloud_snapshot_jobs WHERE id='test-only-job'").run();
      await env.CATALOGUE.prepare("DELETE FROM crawl_tasks WHERE run_id=90 OR run_id IN(SELECT id FROM crawl_runs WHERE source='anikoto-cloud:worker-contract-refresh')").run();
      await env.CATALOGUE.prepare("DELETE FROM crawl_runs WHERE id=90 OR source='anikoto-cloud:worker-contract-refresh'").run();
      await env.CATALOGUE.prepare('UPDATE cloud_sync_control SET enabled=0 WHERE id=1').run();
    }
  });

  it('requires operator authorization and demonstrable, finite native mapping metrics before recording playback evidence', async () => {
    const evidence = { language: 'sub', evidenceRef: 'docs/cloud-release-checklist.md#native-playback',
      progressFrom: 0, progressTo: 12, duration: 260, seekFrom: 12, seekTo: 60, restoredTime: 59 };
    const path = '/api/admin/providers/31/verification';
    expect((await request(path, mutation(evidence))).status).toBe(401);
    expect((await request(path, mutation(evidence, operator({ origin: 'https://foreign.example.test' })))).status).toBe(403);
    const invalid = [
      { duration: 0 }, { progressTo: 0 }, { progressTo: Infinity }, { progressFrom: NaN }, { restoredTime: -1 },
      { seekTo: 12 }, { seekTo: 261 }, { language: 'dub' }, { evidenceRef: 'https://example.test/claimed-video.mp4' },
      { evidenceRef: 'docs/../private/account.json' },
    ];
    for (const patch of invalid) expect((await request(path, mutation({ ...evidence, ...patch }, operator()))).status).toBe(400);
    expect((await request('/api/admin/providers/30/verification', mutation(evidence, operator()))).status).toBe(400);
    expect((await env.CATALOGUE.prepare("SELECT COUNT(*) AS count FROM verification_observations WHERE stage='playback_verified'").first())?.count).toBe(0);
    expect((await env.CATALOGUE.prepare('SELECT last_playback_verification_at FROM episode_provider_mappings WHERE id=31').first())?.last_playback_verification_at).toBeNull();
    const send = vi.fn(); vi.stubGlobal('fetch', send);
    const result = await request(path, mutation({ ...evidence, url: 'https://example.test/temporary-secret-media.mp4' }, operator()));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ mappingId: 31, stage: 'playback_verified', observedAt: expect.any(String) });
    expect(send).not.toHaveBeenCalled(); // The operator supplied separately observed evidence, not a fabricated probe.
    const observations = await env.CATALOGUE.prepare("SELECT * FROM verification_observations WHERE stage='playback_verified'").all<{ id: number; entity_id: string; details_json: string }>();
    expect(observations.results).toHaveLength(1);
    expect(observations.results[0].id).toBeGreaterThan(1_000_000_000);
    expect(observations.results[0].entity_id).toBe('31');
    expect(JSON.parse(observations.results[0].details_json)).toMatchObject({ ...evidence, mappingId: 31, providerId: 'internet-archive', origin });
    expect(observations.results[0].details_json).not.toContain('temporary-secret-media');
    const mappings = await env.CATALOGUE.prepare('SELECT id,last_playback_verification_at,resolution_evidence_state FROM episode_provider_mappings ORDER BY id').all();
    expect(mappings.results).toMatchObject([
      { id: 30, last_playback_verification_at: null },
      { id: 31, last_playback_verification_at: expect.any(String), resolution_evidence_state: 'playback_verified' },
      { id: 32, last_playback_verification_at: null },
    ]);
    // The canonical research record is not in this partial fixture inventory.
    // Verification must keep its catalogue evidence without inventing a research record.
    expect((await env.RESEARCH.prepare('SELECT COUNT(*) AS count FROM research_capabilities').first())?.count).toBe(0);
  });

  it('associates operator playback proof only with the fixed canonical research record, never a supplied or same-host alias', async () => {
    expect(NATIVE_RESEARCH_RECORDS).toEqual({ 'internet-archive': 'site-f1023afdb569da2f', 'wikimedia-commons': 'site-43817f8d8c7ba5ba' });
    const archiveId = NATIVE_RESEARCH_RECORDS['internet-archive'];
    const commonsId = NATIVE_RESEARCH_RECORDS['wikimedia-commons'];
    const aliasId = 'test-same-host-research-alias';
    const recordIds = [archiveId, commonsId, aliasId];
    const before = await env.CATALOGUE.prepare('SELECT last_successful_resolution_at,last_playback_verification_at,resolution_evidence_state FROM episode_provider_mappings WHERE id=31')
      .first<{ last_successful_resolution_at: string | null; last_playback_verification_at: string | null; resolution_evidence_state: string }>();
    const previousObservation = await env.CATALOGUE.prepare('SELECT COALESCE(MAX(id),0) AS id FROM verification_observations').first<{ id: number }>();
    await env.RESEARCH.batch(recordIds.map(id => env.RESEARCH.prepare('INSERT INTO research_records(id,collection,source_id,name,kind,url,provenance_path,record_json,record_hash,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .bind(id, 'test-only', id, 'Test native research relationship', 'site', id === commonsId ? 'https://commons.wikimedia.org' : 'https://archive.org', 'test-only/fixture.json', '{}', 'd'.repeat(64), observed)));
    try {
      const send = vi.fn<typeof fetch>(async (input, init) => {
        if (String(input) === 'https://archive.org/metadata/test-public-item')
          return Response.json({ metadata: { identifier: 'test-public-item' }, files: [{ name: 'test movie.mp4', format: 'h.264 IA' }] });
        expect(init?.method).toBe('HEAD');
        return new Response(null, { headers: { 'content-type': 'video/mp4' } });
      });
      vi.stubGlobal('fetch', send);
      expect((await request('/api/providers/31/resolve', mutation({ language: 'sub' }))).status).toBe(200);
      expect((await env.RESEARCH.prepare('SELECT COUNT(*) AS count FROM research_capabilities').first())?.count).toBe(0);
      const evidence = { language: 'sub', evidenceRef: 'docs/cloud-release-checklist.md#native-playback',
        progressFrom: 0, progressTo: 12, duration: 260, seekFrom: 12, seekTo: 60, restoredTime: 59,
        recordId: commonsId, sourceId: aliasId, url: 'https://example.test/do-not-store-this-url' };
      const path = '/api/admin/providers/31/verification';
      expect((await request(path, mutation(evidence))).status).toBe(401);
      expect((await request(path, mutation({ ...evidence, progressTo: 0 }, operator()))).status).toBe(400);
      expect((await env.RESEARCH.prepare('SELECT COUNT(*) AS count FROM research_capabilities').first())?.count).toBe(0);
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await request(path, mutation(evidence, operator()));
        expect(response.status).toBe(200);
        const capabilities = await env.RESEARCH.prepare('SELECT * FROM research_capabilities').all<{ record_id: string; capability: string; implementation_state: string; runtime_verified: number; evidence_json: string }>();
        expect(capabilities.results).toHaveLength(1);
        expect(capabilities.results[0]).toMatchObject({ record_id: archiveId, capability: 'playback', implementation_state: 'implemented', runtime_verified: 1 });
        const catalogueProof = await env.CATALOGUE.prepare("SELECT details_json FROM verification_observations WHERE entity_type='mapping' AND entity_id='31' AND stage='playback_verified' ORDER BY id DESC LIMIT 1")
          .first<{ details_json: string }>();
        expect(capabilities.results[0].evidence_json).toBe(catalogueProof?.details_json);
        expect(JSON.parse(capabilities.results[0].evidence_json)).toMatchObject({ mappingId: 31, providerId: 'internet-archive', language: 'sub', origin });
        expect(capabilities.results[0].evidence_json).not.toContain(aliasId);
        expect(capabilities.results[0].evidence_json).not.toContain('do-not-store-this-url');
      }
      expect(send).toHaveBeenCalledTimes(2); // Metadata/HEAD only, no fabricated playback probe.
    } finally {
      for (const id of recordIds) {
        await env.RESEARCH.prepare('DELETE FROM research_capabilities WHERE record_id=?').bind(id).run();
        await env.RESEARCH.prepare('DELETE FROM research_records WHERE id=?').bind(id).run();
      }
      await env.CATALOGUE.prepare("DELETE FROM verification_observations WHERE id>? AND entity_type='mapping' AND entity_id='31'").bind(previousObservation?.id ?? 0).run();
      await env.CATALOGUE.prepare('UPDATE episode_provider_mappings SET last_successful_resolution_at=?,last_playback_verification_at=?,resolution_evidence_state=? WHERE id=31')
        .bind(before?.last_successful_resolution_at ?? null, before?.last_playback_verification_at ?? null, before?.resolution_evidence_state ?? 'not_attempted').run();
    }
  });

  it('returns sanitized JSON failures and keeps disabled synchronization non-operational', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unconfigured = await request('/api/admin/sources', { headers: operator() }, { SOLANIME_ADMIN_TOKEN: '' });
    expect(unconfigured.status).toBe(503);
    const empty = await runtime.getD1Database('EMPTY');
    const failure = await request('/api/health', {}, { CATALOGUE: empty });
    expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'The server could not complete the request.' } });
    expect(log.mock.calls.flat().every(value => !String(value).includes(operatorToken) && !String(value).includes('SELECT'))).toBe(true);
    expect((await request('/api/admin/import/dispatch', mutation({}, operator()))).status).toBe(503);
    expect((await request('/api/proxy?url=http://127.0.0.1/private')).status).toBe(404);
    expect((await request('/api/health', { method: 'DELETE' })).status).toBe(404);
  });

  it('rejects a newer import that retargets an existing approved native mapping to another episode', async () => {
    await env.CATALOGUE.prepare('INSERT INTO episodes(id,title_id,source_id,number_text,number_sort,slug,canonical_url,first_seen_at,last_seen_at,created_at,updated_at) VALUES(11,2,?,?,?,?,?,?,?,?,?)')
      .bind('test-other-episode', '1', 1, 'one', 'https://example.test/test-2/one', observed, observed, observed, observed).run();
    await env.CATALOGUE.prepare('INSERT INTO episode_versions(id,episode_id,source_id,language,first_seen_at,last_seen_at) VALUES(22,11,?,?,?,?)')
      .bind('test-other-version', 'sub', observed, observed).run();
    const stored = await env.CATALOGUE.prepare('SELECT * FROM episode_provider_mappings WHERE id=31').first<Record<string, string | number | null>>();
    if (!stored) throw Error('Missing test mapping');
    const original = Object.fromEntries(IMPORT_TABLES.episode_provider_mappings.columns.map(key => [key, stored[key]]));
    const rows = [{ ...original, version_id: 22, updated_at: '2030-01-01T00:00:00.000Z' }];
    const batch = { version: 1, id: 'test-mapping-retarget', snapshotId: 'test-only-conflicting-delta', target: 'catalogue',
      table: 'episode_provider_mappings', rows, contentHash: await importHash(rows) };
    try {
      const response = await request('/api/admin/import/batch', mutation(batch, operator()));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: 'IMPORT_IDENTITY_CONFLICT' } });
      expect((await env.CATALOGUE.prepare('SELECT version_id FROM episode_provider_mappings WHERE id=31').first())?.version_id).toBe(20);
      const choices = await (await request('/api/episodes/11/providers?language=sub')).json();
      expect(choices).toMatchObject({ providers: [] });
      expect(await env.CATALOGUE.prepare('SELECT id FROM cloud_import_receipts WHERE id=?').bind(batch.id).first()).toBeNull();
    } finally {
      // Keep this isolated runtime usable even while reproducing the old bug.
      await env.CATALOGUE.prepare('UPDATE episode_provider_mappings SET version_id=20,updated_at=? WHERE id=31').bind(String(original.updated_at)).run();
      await env.CATALOGUE.prepare('DELETE FROM cloud_import_receipts WHERE id=?').bind(batch.id).run();
      await env.CATALOGUE.prepare('DELETE FROM episode_versions WHERE id=22').run();
      await env.CATALOGUE.prepare('DELETE FROM episodes WHERE id=11').run();
    }
  });
});
