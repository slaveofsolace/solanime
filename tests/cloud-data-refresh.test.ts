import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { createAnikotoSyncHandlers } from '../server/cloud/data/anikoto-sync.ts';
import { createAnikotoRefreshRepository } from '../server/cloud/data/anikoto-refresh.ts';
import { consumeSyncMessage, createSyncRepository, SyncSourceError } from '../server/cloud/data/sync.ts';
import { withQueryBudget } from '../server/cloud/data/query-budget.ts';
import { applyImportBatch, importHash } from '../server/cloud/data/import.ts';
import { createCatalogueRepository } from '../server/cloud/data/catalogue.ts';
import type { ImportRow } from '../server/cloud/data/import-schema.ts';

let runtime: Miniflare; let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
const date = '2026-01-01T00:00:00.000Z';
function splitSql(sql: string) {
  const result: string[] = []; let current = ''; let quote = ''; let comment = false;
  for (let i = 0; i < sql.length; i++) { const ch = sql[i]; const next = sql[i + 1]; if (comment) { if (ch === '\n') { comment = false; current += ' '; } continue; } if (!quote && ch === '-' && next === '-') { comment = true; i++; continue; } if (quote) { current += ch; if (ch === quote) { if (next === quote) { current += next; i++; } else quote = ''; } continue; } if (ch === "'" || ch === '"') { quote = ch; current += ch; } else if (ch === ';') { if (current.trim()) result.push(current.trim()); current = ''; } else current += ch; }
  if (current.trim()) result.push(current.trim()); return result;
}
beforeAll(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ name: 'refresh-contracts', modules: true, script: 'export default {fetch(){return new Response("test-only")}}', compatibilityDate: '2026-09-12', d1Databases: { CATALOGUE: 'refresh-contracts' } })); db = await runtime.getD1Database('CATALOGUE');
  for (const file of readdirSync(new URL('../migrations/cloud/catalogue/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) for (const sql of splitSql(readFileSync(new URL(`../migrations/cloud/catalogue/${file}`, import.meta.url), 'utf8'))) await db.prepare(sql).run();
}, 60_000);
afterAll(async () => { await runtime?.dispose(); });
beforeEach(async () => {
  for (const table of ['cloud_snapshot_jobs', 'cloud_sync_payloads', 'episode_provider_mappings', 'episode_versions', 'episodes', 'title_aliases', 'title_genres', 'related_titles', 'titles', 'crawl_tasks', 'coverage_snapshots', 'crawl_runs', 'cloud_source_policy', 'cloud_budget_reservations', 'cloud_daily_budget', 'cloud_import_receipts', 'verification_observations']) await db.prepare(`DELETE FROM ${table}`).run();
  await createSyncRepository(db).setEnabled(true);
});
async function task(type: string, payload: unknown) {
  await db.prepare("INSERT INTO crawl_runs(id,source,mode,status,created_at,updated_at) VALUES(1,'test-only','incremental','running',?,?) ON CONFLICT(id) DO UPDATE SET status='running'").bind(date, date).run();
  const row = await db.prepare("INSERT INTO crawl_tasks(run_id,task_key,task_type,payload_json,status,available_at,created_at,updated_at) VALUES(1,?,?,?,'pending',?,?,?) RETURNING id").bind(crypto.randomUUID(), type, JSON.stringify(payload), date, date, date).first<{ id: number }>(); return row!.id;
}
const message = (id: number) => ({ body: { taskId: id }, ack() {}, retry() {} });
async function ready(id: number) { await db.prepare('UPDATE crawl_tasks SET available_at=? WHERE id=?').bind(date, id).run(); }
async function imported(table: string, rows: ImportRow[]) { return applyImportBatch(db, db, { version: 1, id: crypto.randomUUID(), snapshotId: 'refresh-fixture', target: 'catalogue', table, rows, contentHash: await importHash(rows) }); }
const card = '<div class="ani items"><div class="item"><div class="ani poster tip" data-tip="42"><a href="/watch/old-route"><img alt="Fixture title"></a></div><a class="name d-title" href="/watch/old-route" data-jp="Fixture alias">Fixture title</a><div class="genre"><a href="/genre/action">Action</a></div></div></div>';
const titleHtml = '<div id="watch-main" data-id="42" data-url="/watch/new-route"><h1 class="title" data-jp="Fixture alias">Updated fixture title</h1><p class="synopsis">Observed updated description.</p><div class="bmeta"><div class="meta"><div>Type: <span>TV</span></div><div>Status: <span>Releasing</span></div></div><a href="/genre/action">Action</a></div></div>';
const episodeHtml = (count: number) => Array.from({ length: count }, (_value, i) => `<a data-id="e${i + 1}" data-num="${i === 0 ? '12.5' : i + 1}" data-slug="${i === 0 ? 'special' : i + 1}" data-sub="1" data-dub="1" data-ids="reference-${i + 1}">${i === 0 ? '<span class="d-title">Verified first chapter</span>' : ''}</a>`).join('');
function source(responses: Record<string, string | Response>) {
  let time = Date.now(); const requests: string[] = []; const bodies = new WeakMap<Response, Promise<string>>();
  return { requests, options: { now: () => time += 3000, fetch: (async input => { const url = new URL(String(input)); requests.push(url.pathname + url.search); const value = responses[url.pathname + url.search] ?? responses[url.pathname]; if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /'); if (!value) throw new Error(`Unexpected source path ${url.pathname}`); if (typeof value === 'string') return new Response(value); let body = bodies.get(value); if (!body) { body = value.text(); bodies.set(value, body); } return new Response(await body, { status: value.status, headers: value.headers }); }) as typeof fetch } };
}
async function seedTitle() { await imported('titles', [{ id: 17, source: 'anikoto', source_id: '42', slug: 'old-route', canonical_url: 'https://anikototv.to/watch/old-route', name: 'Original fixture', description: 'Good original description', first_seen_at: date, last_seen_at: date, created_at: date, updated_at: date }]); }

describe('complete bounded cloud source refresh', () => {
  it('creates one resumable high-ID refresh run and preserves repeated ensure calls', async () => {
    const repo = createAnikotoRefreshRepository(db); const first = await repo.ensure({ key: 'test-day' });
    expect(first.status).toBe('created'); expect(Number(first.runId)).toBeGreaterThan(1_000_000_000);
    expect((await repo.ensure({ key: 'test-day' })).status).toBe('existing');
    expect((await db.prepare('SELECT task_type FROM crawl_tasks ORDER BY id').all()).results).toEqual([{ task_type: 'catalogue_page' }, { task_type: 'sitemap_index' }]);
  });
  it('reuses one active or paused refresh across daily keys and concurrent starts', async () => {
    const repo = createAnikotoRefreshRepository(db);
    const starts = await Promise.all([repo.ensure({ key: 'day-one' }), repo.ensure({ key: 'day-two' })]);
    expect(new Set(starts.map(start => start.runId)).size).toBe(1);
    expect((await db.prepare("SELECT COUNT(*) AS count FROM crawl_runs WHERE source LIKE 'anikoto-cloud:%'").first())?.count).toBe(1);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM crawl_tasks').first())?.count).toBe(2);
    await createSyncRepository(db).setRunPaused(starts[0].runId!, true);
    expect(await repo.ensure({ key: 'day-three' })).toMatchObject({ status: 'existing', runId: starts[0].runId, runStatus: 'paused' });
  }, 20_000);
  it('imports real-shaped catalogue cards, aliases and genres and creates durable title tasks', async () => {
    const fixture = source({ '/filter?page=1': card }); const id = await task('catalogue_page', { page: 1 }); const handlers = createAnikotoSyncHandlers(db, fixture.options);
    expect((await consumeSyncMessage(message(id), db, handlers)).status).toBe('checkpointed'); await ready(id);
    expect((await consumeSyncMessage(message(id), db, handlers)).status).toBe('completed');
    const catalogue = createCatalogueRepository(db); expect((await catalogue.browseTitles({ page: 1, pageSize: 24, sort: 'name' })).total).toBe(1);
    const title = await catalogue.getTitle('old-route'); expect(title.collectionState).toBe('pending'); expect(title.aliases).toHaveLength(1); expect(title.genres).toHaveLength(1);
    expect((await db.prepare("SELECT COUNT(*) AS count FROM crawl_tasks WHERE task_type='title_detail'").first())?.count).toBe(1);
  }, 20_000);
  it('refreshes canonical routes, irregular episodes and versions without changing existing title IDs', async () => {
    await seedTitle();
    const fixture = source({ '/watch/old-route': titleHtml, '/ajax/episode/list/42?vrf=': JSON.stringify({ status: 200, result: episodeHtml(9) }) });
    const id = await task('title_detail', { sourceId: '42' }); const handlers = createAnikotoSyncHandlers(db, fixture.options);
    for (let i = 0; i < 3; i++) { await ready(id); expect((await consumeSyncMessage(message(id), db, handlers)).status).toBe(i === 2 ? 'completed' : 'checkpointed'); }
    const title = await createCatalogueRepository(db).getTitle('new-route'); expect(title.title).toMatchObject({ id: '17' }); expect(title.episodes).toHaveLength(9);
    expect(title.episodes[0]).toMatchObject({ number: '2' });
    expect((await db.prepare("SELECT number_text FROM episodes WHERE source_id='e1'").first())?.number_text).toBe('12.5');
    expect((await db.prepare("SELECT label FROM episodes WHERE source_id='e1'").first())?.label).toBe('Verified first chapter');
    expect((await db.prepare('SELECT COUNT(*) AS count FROM episode_versions').first())?.count).toBe(18);
    expect((await db.prepare("SELECT COUNT(*) AS count FROM crawl_tasks WHERE task_type='episode_servers'").first())?.count).toBe(9);
    expect(fixture.requests).toContain('/ajax/episode/list/42?vrf=');
  }, 30_000);
  it('preserves good metadata on delayed episode payloads and does not accept truncated catalogue pages', async () => {
    await seedTitle(); const delayed = source({ '/watch/old-route': titleHtml, '/ajax/episode/list/42?vrf=': JSON.stringify({ status: 200, result: '<div class="skeleton">Loading episodes</div>' }) });
    const id = await task('title_detail', { sourceId: '42' }); expect((await consumeSyncMessage(message(id), db, createAnikotoSyncHandlers(db, delayed.options))).status).toBe('retry');
    expect((await db.prepare('SELECT slug,description FROM titles WHERE id=17').first())).toEqual({ slug: 'old-route', description: 'Good original description' });
    const bad = source({ '/filter?page=1': `${card}<a href="/filter?page=2">Last</a>` }); const catalogueTask = await task('catalogue_page', { page: 1 });
    expect((await consumeSyncMessage(message(catalogueTask), db, createAnikotoSyncHandlers(db, bad.options))).status).toBe('failed');
    expect((await db.prepare('SELECT COUNT(*) AS count FROM titles').first())?.count).toBe(1);
  }, 20_000);
  it('follows only observed allowlisted sitemap locations and retains non-watch exclusions', async () => {
    const fixture = source({ '/sitemap.xml': '<sitemapindex><sitemap><loc>https://anikototv.to/sitemap/pages.xml</loc></sitemap><sitemap><loc>https://other.invalid/hidden.xml</loc></sitemap></sitemapindex>', '/sitemap/pages.xml': '<urlset><url><loc>https://anikototv.to/watch/other-title/ep-1</loc></url><url><loc>https://anikototv.to/genre/action</loc></url></urlset>' });
    const handlers = createAnikotoSyncHandlers(db, fixture.options); const id = await task('sitemap_index', {});
    await consumeSyncMessage(message(id), db, handlers); await ready(id); await consumeSyncMessage(message(id), db, handlers);
    const child = await db.prepare("SELECT id FROM crawl_tasks WHERE task_type='sitemap_page'").first<{ id: number }>(); expect(child).not.toBeNull();
    await ready(child!.id); await consumeSyncMessage(message(child!.id), db, handlers); await ready(child!.id); await consumeSyncMessage(message(child!.id), db, handlers);
    const routes = (await db.prepare("SELECT payload_json FROM crawl_tasks WHERE task_type='sitemap_title'").all<{ payload_json: string }>()).results;
    expect(routes).toHaveLength(1); expect(JSON.parse(routes[0].payload_json).canonicalUrl).toBe('https://anikototv.to/watch/other-title');
    expect(fixture.requests.some(request => request.includes('other.invalid'))).toBe(false);
  }, 30_000);
  it('stores a 1,212-episode inventory in bounded durable fragments within invocation limits', async () => {
    await seedTitle(); const fixture = source({ '/watch/old-route': titleHtml, '/ajax/episode/list/42?vrf=': JSON.stringify({ status: 200, result: episodeHtml(1212) }) }); const id = await task('title_detail', { sourceId: '42' });
    const counter = { used: 0, maximum: 45 }; const limited = withQueryBudget(db, counter);
    expect((await consumeSyncMessage(message(id), limited, createAnikotoSyncHandlers(limited, fixture.options))).status).toBe('checkpointed');
    expect(counter.used + fixture.requests.length).toBeLessThanOrEqual(45);
    const parts = await db.prepare('SELECT COUNT(*) AS count,MAX(length(CAST(payload_json AS BLOB))) AS bytes FROM cloud_sync_payloads WHERE task_id=?').bind(id).first<{ count: number; bytes: number }>();
    expect(parts?.count).toBe(152); expect(parts!.bytes).toBeLessThan(50_000);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM episodes').first())?.count).toBe(0);
  }, 30_000);
  it('marks absent records stale in bounded passes without deleting their stable IDs', async () => {
    await seedTitle();
    await imported('episodes', [{ id: 20, title_id: 17, source_id: 'old-episode', number_text: '0', slug: 'ep-0', canonical_url: 'https://anikototv.to/watch/old-route/ep-0', first_seen_at: date, last_seen_at: date, created_at: date, updated_at: date }]);
    await imported('episode_versions', [{ id: 21, episode_id: 20, source_id: 'old-episode:sub', language: 'sub', first_seen_at: date, last_seen_at: date }]);
    await imported('episode_provider_mappings', [{ id: 22, version_id: 21, provider_id: 'hd-1', source_mapping_id: 'old-reference', first_seen_at: date, last_seen_at: date, updated_at: date }]);
    const id = await task('title_reconcile', { sourceId: '42', observedAt: new Date().toISOString(), episodeCount: 0 });
    const fixture = source({}); const handlers = createAnikotoSyncHandlers(db, fixture.options);
    for (let index = 0; index < 3; index++) { await ready(id); expect((await consumeSyncMessage(message(id), db, handlers)).status).toBe(index === 2 ? 'completed' : 'checkpointed'); }
    expect((await db.prepare('SELECT id,availability_state FROM episodes').first())).toEqual({ id: 20, availability_state: 'stale' });
    expect((await db.prepare('SELECT id,availability_state FROM episode_versions').first())).toEqual({ id: 21, availability_state: 'stale' });
    expect((await db.prepare('SELECT id,availability_state FROM episode_provider_mappings').first())).toEqual({ id: 22, availability_state: 'stale' });
    expect(fixture.requests).toEqual([]);
  }, 20_000);
  it('records a verified empty inventory only after successful acquisition and reconciliation', async () => {
    await seedTitle(); const fixture = source({ '/watch/old-route': titleHtml, '/ajax/episode/list/42?vrf=': JSON.stringify({ status: 200, result: '<div class="head"><div class="filter"></div></div><div class="body"><div class="episodes"></div></div>' }) });
    const id = await task('title_detail', { sourceId: '42' }); const handlers = createAnikotoSyncHandlers(db, fixture.options);
    await consumeSyncMessage(message(id), db, handlers); await ready(id); await consumeSyncMessage(message(id), db, handlers);
    expect((await createCatalogueRepository(db).getTitle('new-route')).collectionState).toBe('pending');
    const reconcile = await db.prepare("SELECT id FROM crawl_tasks WHERE task_type='title_reconcile'").first<{ id: number }>();
    for (let index = 0; index < 3; index++) { await ready(reconcile!.id); await consumeSyncMessage(message(reconcile!.id), db, handlers); }
    expect((await createCatalogueRepository(db).getTitle('new-route')).collectionState).toBe('complete');
    expect((await db.prepare('SELECT COUNT(*) AS count FROM cloud_sync_payloads').first())?.count).toBe(0);
  }, 30_000);
  it('pauses a refused source run and does not re-request another record through the access block', async () => {
    const fixture = source({ '/filter?page=1': new Response('forbidden', { status: 403 }) });
    const first = await task('catalogue_page', { page: 1 }); const handlers = createAnikotoSyncHandlers(db, fixture.options);
    expect((await consumeSyncMessage(message(first), db, handlers)).status).toBe('blocked');
    expect((await db.prepare('SELECT status FROM crawl_runs WHERE id=1').first())?.status).toBe('paused');
    expect(await createSyncRepository(db).retryRun(1)).toMatchObject({ retried: 1, remaining: 0, runStatus: 'queued' });
    expect((await consumeSyncMessage(message(first), db, handlers)).status).toBe('blocked');
    expect(fixture.requests).toEqual(['/robots.txt', '/filter?page=1']);
  }, 20_000);
  it('retries failed runs atomically while retaining checkpoints and operator evidence', async () => {
    const id = await task('catalogue_page', { page: 1 });
    const checkpoint = JSON.stringify({ phase: 'cards', nextPart: 7, observedAt: date });
    await db.prepare('UPDATE crawl_tasks SET checkpoint_json=? WHERE id=?').bind(checkpoint, id).run();
    const terminal = await consumeSyncMessage(message(id), db, { catalogue_page: async () => { throw new SyncSourceError('Malformed public response.', 'UPSTREAM_CHANGED', false); } });
    expect(terminal.status).toBe('failed');
    expect((await db.prepare('SELECT status,tasks_failed FROM crawl_runs WHERE id=1').first())).toEqual({ status: 'failed', tasks_failed: 1 });
    expect(await createSyncRepository(db).retryRun(1, { limit: 1, includeBlocked: false })).toEqual({ runId: 1, retried: 1, remaining: 0, runStatus: 'queued' });
    expect((await db.prepare('SELECT payload_json,checkpoint_json,status,attempt_count,last_error_code FROM crawl_tasks WHERE id=?').bind(id).first())).toEqual({ payload_json: '{"page":1}', checkpoint_json: checkpoint, status: 'retry', attempt_count: 0, last_error_code: 'UPSTREAM_CHANGED' });
    const evidence = await db.prepare("SELECT entity_id,details_json FROM verification_observations WHERE result='operator_retry'").first<{ entity_id: string; details_json: string }>();
    expect(evidence?.entity_id).toBe(String(id)); expect(JSON.parse(evidence!.details_json)).toMatchObject({ runId: 1, previousStatus: 'failed', previousCode: 'UPSTREAM_CHANGED', checkpointPreserved: true });
    expect(await createSyncRepository(db).retryRun(1)).toMatchObject({ retried: 0, runStatus: 'queued' });
    expect((await db.prepare("SELECT COUNT(*) AS count FROM verification_observations WHERE result='operator_retry'").first())?.count).toBe(1);
  }, 20_000);
  it('keeps cancelled runs protected and bounds retries without clearing unrelated tasks', async () => {
    const first = await task('catalogue_page', { page: 1 }); const second = await task('catalogue_page', { page: 2 });
    await db.prepare("UPDATE crawl_tasks SET status='failed',checkpoint_json='{\"saved\":true}' WHERE run_id=1").run();
    await db.prepare("UPDATE crawl_runs SET status='failed' WHERE id=1").run();
    expect(await createSyncRepository(db).retryRun(1, { limit: 1 })).toMatchObject({ retried: 1, remaining: 1 });
    expect((await db.prepare('SELECT id,status FROM crawl_tasks ORDER BY id').all()).results).toEqual([{ id: first, status: 'retry' }, { id: second, status: 'failed' }]);
    await db.prepare("UPDATE crawl_runs SET status='cancelled' WHERE id=1").run();
    await expect(createSyncRepository(db).retryRun(1)).rejects.toMatchObject({ status: 409, code: 'IMPORT_CONFLICT' });
    expect((await db.prepare('SELECT status,checkpoint_json FROM crawl_tasks WHERE id=?').bind(second).first())).toEqual({ status: 'failed', checkpoint_json: '{"saved":true}' });
  }, 20_000);
});
