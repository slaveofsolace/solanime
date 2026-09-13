import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createCatalogueRepository } from '../server/cloud/data/catalogue.ts';
import { createResearchRepository } from '../server/cloud/data/research.ts';
import { applyImportBatch, importHash, validateImportBatch } from '../server/cloud/data/import.ts';
import { getWriteBudget, reserveWriteBudget, settleWriteBudget } from '../server/cloud/data/budget.ts';
import { createSyncRepository, dispatchSyncTasks, consumeSyncMessage, SyncSourceError } from '../server/cloud/data/sync.ts';
import type { ImportBatch, ImportRow } from '../server/cloud/data/import-schema.ts';
import { createAnikotoSyncHandlers, parseRobotsPolicy, robotsAllows, parseServerObservations } from '../server/cloud/data/anikoto-sync.ts';
import { createSnapshotImportRepository, createSnapshotImportHandlers } from '../server/cloud/data/snapshot.ts';
import type { SnapshotAssetManifest } from '../server/cloud/data/snapshot-schema.ts';
import { withQueryBudget } from '../server/cloud/data/query-budget.ts';

let runtime: Miniflare;
let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
let research: Awaited<ReturnType<Miniflare['getD1Database']>>;
function statements(sql: string) {
  const items: string[] = []; let current = ''; let quote = ''; let comment = false;
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index]; const next = sql[index + 1];
    if (comment) { if (char === '\n') { comment = false; current += ' '; } continue; }
    if (!quote && char === '-' && next === '-') { comment = true; index++; continue; }
    if (quote) { current += char; if (char === quote) { if (next === quote) { current += next; index++; } else quote = ''; } continue; }
    if (char === "'" || char === '"') { quote = char; current += char; continue; }
    if (char === ';') { if (current.trim()) items.push(current.trim()); current = ''; } else current += char;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}
beforeAll(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ name: 'data-contracts', modules: true, script: 'export default { fetch() { return new Response("test-only") } }', compatibilityDate: '2026-09-12', d1Databases: { CATALOGUE: 'data-contract-test', RESEARCH: 'research-contract-test' } }));
  db = await runtime.getD1Database('CATALOGUE'); research = await runtime.getD1Database('RESEARCH');
  for (const file of readdirSync(new URL('../migrations/cloud/catalogue/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()) {
    for (const sql of statements(readFileSync(new URL(`../migrations/cloud/catalogue/${file}`, import.meta.url), 'utf8'))) await db.prepare(sql).run();
  }
  for (const sql of statements(readFileSync(new URL('../migrations/cloud/research/001_research.sql', import.meta.url), 'utf8'))) await research.prepare(sql).run();
}, 60_000);
afterAll(async () => { await runtime?.dispose(); });
beforeEach(async () => {
  for (const table of ['episode_provider_mappings', 'episode_versions', 'episodes', 'related_titles', 'title_genres', 'title_aliases', 'titles', 'cloud_snapshot_jobs', 'crawl_tasks', 'coverage_snapshots', 'crawl_runs', 'cloud_budget_reservations', 'cloud_daily_budget', 'cloud_import_receipts', 'cloud_snapshot_sources', 'cloud_source_policy']) await db.prepare(`DELETE FROM ${table}`).run();
  for (const table of ['research_reviews', 'research_capabilities', 'research_categories', 'research_record_fragments', 'research_relationships', 'research_aliases', 'research_records', 'cloud_import_receipts']) await research.prepare(`DELETE FROM ${table}`).run();
  await db.prepare('UPDATE cloud_sync_control SET enabled=0').run();
});

describe('private Worker snapshot assets and durable D1 cursors', () => {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  async function fixtureAssets(batches: ImportBatch[]) {
    const snapshot = hash(JSON.stringify(batches)); const prefix = `/__private-import/${snapshot}`;
    const bundle = JSON.stringify({ version: 1, snapshot, startBatch: 0, batches: batches.map(data => ({ sha256: hash(JSON.stringify(data)), data })) });
    const manifest: SnapshotAssetManifest = { version: 1, kind: 'solanime-private-import', id: snapshot, sourceManifestSha256: snapshot, totalBatches: batches.length, totalRows: batches.reduce((sum, entry) => sum + entry.rows.length, 0), totalEstimatedWrites: 1000, catalogueCounts: {}, researchCounts: {}, bundles: [{ path: `${prefix}/bundles/000000.json`, sha256: hash(bundle), bytes: Buffer.byteLength(bundle), startBatch: 0, batches: batches.length, rows: batches.reduce((sum, entry) => sum + entry.rows.length, 0) }] };
    const text = JSON.stringify(manifest); const contents = new Map([[`${prefix}/manifest.json`, text], [`${prefix}/bundles/000000.json`, bundle]]); const requests: string[] = [];
    const assets = { async fetch(input: string) { const url = new URL(input); requests.push(input); if (url.origin !== 'https://assets.local') throw new Error('Unexpected network destination'); const body = contents.get(url.pathname); return new Response(body ?? 'missing', { status: body ? 200 : 404 }); } } as Parameters<typeof createSnapshotImportRepository>[1];
    return { assets, contents, requests, pin: { manifestPath: `${prefix}/manifest.json`, manifestSha256: hash(text) } };
  }
  it('pins a complete asset set and advances catalogue/research batches using task-ID messages only', async () => {
    await seedTask('old_local_task');
    const fixture = await fixtureAssets([await batch('titles', [titleRow(1)]), await batch('titles', [titleRow(2)]), await batch('cloud_snapshot_sources', [{ id: 'research-fixture', source: 'fmhy', content_hash: 'a'.repeat(64), counts_json: '{}', observation_date: date, imported_at: date }], undefined, 'research')]);
    const repository = createSnapshotImportRepository(db, fixture.assets);
    const job = await repository.ensure(fixture.pin); expect(Number(job.taskId)).toBeGreaterThan(1_000_000_000); expect(Number(job.runId)).toBeGreaterThan(1_000_000_000);
    expect((await repository.ensure(fixture.pin)).created).toBe(false);
    const sent: unknown[] = []; const queue = { async send(body: unknown) { sent.push(body); return { metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } } }; } };
    await dispatchSyncTasks(db, queue, undefined, 5, new Date(), ['snapshot_import']); expect(sent).toEqual([{ taskId: job.taskId }]);
    const handlers = createSnapshotImportHandlers(db, research, fixture.assets);
    for (let index = 0; index < 2; index++) {
      await db.prepare('UPDATE crawl_tasks SET available_at=? WHERE id=?').bind(date, Number(job.taskId)).run();
      expect((await consumeSyncMessage(message({ taskId: job.taskId }), db, handlers)).status).toBe(index === 1 ? 'completed' : 'checkpointed');
    }
    expect((await db.prepare('SELECT COUNT(*) AS count FROM titles').first())?.count).toBe(2);
    expect((await research.prepare('SELECT source FROM cloud_snapshot_sources WHERE id=\'research-fixture\'').first())?.source).toBe('fmhy');
    expect((await repository.status()).jobs[0]).toMatchObject({ status: 'completed', importedBatches: 3, totalBatches: 3 });
    expect((await db.prepare('SELECT task_type FROM crawl_tasks WHERE id=1').first())?.task_type).toBe('old_local_task');
    expect(fixture.requests.every(url => url.startsWith('https://assets.local/__private-import/'))).toBe(true);
  }, 20_000);
  it('replays the committed receipt after interruption between import and cursor persistence', async () => {
    const fixture = await fixtureAssets([await batch('titles', [titleRow(1)])]); const job = await createSnapshotImportRepository(db, fixture.assets).ensure(fixture.pin);
    await createSyncRepository(db).setEnabled(true);
    let interrupt = true;
    const interruptedDb: typeof db = { prepare(sql: string) {
      const statement = db.prepare(sql);
      if (!sql.startsWith('UPDATE crawl_tasks SET checkpoint_json=')) return statement;
      return new Proxy(statement, { get(target, key) {
        if (key === 'bind') return (...args: unknown[]) => { const bound = target.bind(...args); return new Proxy(bound, { get(inner, method) { if (method === 'run') return async () => { if (interrupt) { interrupt = false; throw new Error('test-only interrupted cursor write'); } return inner.run(); }; const value = Reflect.get(inner, method, inner); return typeof value === 'function' ? value.bind(inner) : value; } }); };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
    }, batch: db.batch.bind(db) } as typeof db;
    const interrupted = await consumeSyncMessage(message({ taskId: job.taskId }), db, createSnapshotImportHandlers(interruptedDb, research, fixture.assets));
    expect(interrupted.status).toBe('retry'); expect((await db.prepare('SELECT COUNT(*) AS count FROM titles').first())?.count).toBe(1);
    await db.prepare('UPDATE crawl_tasks SET available_at=? WHERE id=?').bind(date, Number(job.taskId)).run();
    expect((await consumeSyncMessage(message({ taskId: job.taskId }), db, createSnapshotImportHandlers(db, research, fixture.assets))).status).toBe('completed');
    const checkpoint = await db.prepare('SELECT checkpoint_json FROM crawl_tasks WHERE id=?').bind(Number(job.taskId)).first<{ checkpoint_json: string }>();
    expect(JSON.parse(checkpoint!.checkpoint_json)).toMatchObject({ nextBatch: 1, lastResult: 'already_imported' });
    expect((await db.prepare('SELECT COUNT(*) AS count FROM titles').first())?.count).toBe(1);
  });
  it('fails closed on changed assets without importing a row or advancing the cursor', async () => {
    const fixture = await fixtureAssets([await batch('titles', [titleRow(1)])]); const job = await createSnapshotImportRepository(db, fixture.assets).ensure(fixture.pin);
    await createSyncRepository(db).setEnabled(true);
    fixture.contents.set(fixture.pin.manifestPath.replace('manifest.json', 'bundles/000000.json'), '{"corrupted":true}');
    expect((await consumeSyncMessage(message({ taskId: job.taskId }), db, createSnapshotImportHandlers(db, research, fixture.assets))).status).toBe('failed');
    expect((await db.prepare('SELECT COUNT(*) AS count FROM titles').first())?.count).toBe(0);
    expect((await createSnapshotImportRepository(db, fixture.assets).status()).jobs[0].importedBatches).toBe(0);
    await expect(createSnapshotImportRepository(db, fixture.assets).ensure({ manifestPath: 'https://other.invalid/file', manifestSha256: 'a'.repeat(64) })).rejects.toMatchObject({ status: 400 });
  });
  it('keeps full-sized normalized imports below 45 queries and asset reads per queue invocation', async () => {
    const batches: ImportBatch[] = [];
    for (let group = 0; group < 5; group++) batches.push(await batch('titles', Array.from({ length: 35 }, (_value, index) => titleRow(group * 35 + index + 1))));
    const fixture = await fixtureAssets(batches); const job = await createSnapshotImportRepository(db, fixture.assets).ensure(fixture.pin);
    await createSyncRepository(db).setEnabled(true);
    const queries = { used: 0, maximum: 45 }; const boundedCatalogue = withQueryBudget(db, queries); const boundedResearch = withQueryBudget(research, queries);
    fixture.requests.length = 0;
    expect((await consumeSyncMessage(message({ taskId: job.taskId }), boundedCatalogue, createSnapshotImportHandlers(boundedCatalogue, boundedResearch, fixture.assets))).status).toBe('checkpointed');
    expect(queries.used + fixture.requests.length).toBeLessThanOrEqual(45);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM titles').first())?.count).toBe(70);
    expect((await createSnapshotImportRepository(db, fixture.assets).status()).jobs[0].importedBatches).toBe(2);
  }, 20_000);
  it('resumes the same cursor in the next UTC quota window without a PC-side uploader', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
      const fixture = await fixtureAssets([await batch('titles', [titleRow(1)])]); const job = await createSnapshotImportRepository(db, fixture.assets).ensure(fixture.pin);
      await createSyncRepository(db).setEnabled(true);
      const budget = { dailyWrittenRows: 300, dailyQueueOperations: 20 };
      await reserveWriteBudget(db, 'other-import', 200, 0, budget);
      const handlers = createSnapshotImportHandlers(db, research, fixture.assets, budget);
      expect((await consumeSyncMessage(message({ taskId: job.taskId }), db, handlers, budget)).status).toBe('quota_paused');
      expect((await db.prepare('SELECT COUNT(*) AS count FROM titles').first())?.count).toBe(0);
      vi.setSystemTime(new Date('2026-09-13T00:01:00Z'));
      expect((await consumeSyncMessage(message({ taskId: job.taskId }), db, handlers, budget)).status).toBe('completed');
      expect((await db.prepare('SELECT COUNT(*) AS count FROM titles').first())?.count).toBe(1);
    } finally { vi.useRealTimers(); }
  });
});
const date = '2026-09-12T00:00:00.000Z';
const titleRow = (id: number, name = 'Test Alpha'): ImportRow => ({ id, source: 'anikoto', source_id: `fixture-${id}`, slug: `fixture-${id}`, canonical_url: `https://anikototv.to/watch/fixture-${id}`, name, description: 'Good original metadata', format: 'Movie', status: 'Finished Airing', first_seen_at: date, last_seen_at: date, last_successful_import_at: date, created_at: date, updated_at: date });
async function batch(table: string, rows: ImportRow[], id: string = crypto.randomUUID(), target: 'catalogue' | 'research' = 'catalogue'): Promise<ImportBatch> { return { version: 1, id, table, rows, target, snapshotId: 'test-only-snapshot', contentHash: await importHash(rows) }; }
async function seedTitle() { await applyImportBatch(db, db, await batch('titles', [titleRow(1)])); }
async function seedTask(type = 'verified_test_handler', payload: unknown = {}) {
  await db.prepare("INSERT INTO crawl_runs(id,source,mode,status,created_at,updated_at) VALUES(1,'anikoto','incremental','queued',?,?)").bind(date, date).run();
  await db.prepare("INSERT INTO crawl_tasks(id,run_id,task_key,task_type,payload_json,status,available_at,created_at,updated_at) VALUES(1,1,'test',?,?,'pending',?,?,?)").bind(type, JSON.stringify(payload), date, date, date).run();
  await db.prepare('UPDATE cloud_sync_control SET enabled=1').run();
}
function message(body: unknown = { taskId: 1 }) { let acked = 0; let retried = 0; return { body, ack() { acked++; }, retry() { retried++; }, get acked() { return acked; }, get retried() { return retried; } }; }

describe('asynchronous catalogue repository on real local D1', () => {
  it('preserves ID shapes and searches literal aliases beyond the D1 LIKE limit', async () => {
    await seedTitle();
    const query = `literal_%_${'x'.repeat(65)}`;
    await db.prepare('INSERT INTO title_aliases(id,title_id,alias,language) VALUES(1,1,?,\'\')').bind(query).run();
    const repository = createCatalogueRepository(db);
    const result = await repository.browseTitles({ q: query, page: 1, pageSize: 20, sort: 'name' });
    expect(result.total).toBe(1); expect(result.items[0].id).toBe('1'); expect(result.items[0].episodeCount).toBe(0);
    expect((await repository.browseTitles({ q: '_no_match', page: 1, pageSize: 20, sort: 'name' })).total).toBe(0);
    expect((await repository.browseTitles({ page: 2, pageSize: 20, sort: 'name' })).items).toEqual([]);
    await expect(repository.browseTitles({ page: 0, pageSize: 20, sort: 'name' })).rejects.toMatchObject({ status: 400 });
  });
  it('returns real versions, aliases and mappings without leaking stable resolver resources into exports', async () => {
    await seedTitle();
    await applyImportBatch(db, db, await batch('episodes', [{ id: 2, title_id: 1, source_id: 'test-ep', number_text: 'Special 0.5', number_sort: 0.5, slug: 'special', canonical_url: 'https://anikototv.to/watch/fixture-1/special', first_seen_at: date, last_seen_at: date, created_at: date, updated_at: date }]));
    await applyImportBatch(db, db, await batch('episode_versions', [{ id: 3, episode_id: 2, source_id: 'test-sub', language: 'sub', first_seen_at: date, last_seen_at: date }]));
    await applyImportBatch(db, db, await batch('episode_provider_mappings', [{ id: 4, version_id: 3, provider_id: 'hd-1', source_mapping_id: 'test-hash', provider_resource_id: 'PRIVATE_STABLE_REFERENCE', first_seen_at: date, last_seen_at: date, updated_at: date }]));
    const repository = createCatalogueRepository(db);
    const detail = await repository.getTitle('fixture-1');
    expect(detail.episodes[0]).toMatchObject({ id: '2', number: 'Special 0.5', versions: [{ id: '3', language: 'sub', providerCount: 1 }] });
    const choices = await repository.getEpisodeProviders(2, 'SUB');
    expect(choices.providers[0]).toMatchObject({ mappingId: '4', providerId: 'hd-1', aliases: ['HD-1'] });
    expect(JSON.stringify(choices)).not.toContain('PRIVATE_STABLE_REFERENCE');
    expect((await repository.getMapping(4)).providerResourceId).toBe('PRIVATE_STABLE_REFERENCE');
    expect(JSON.stringify(await repository.exportTitlesPage())).not.toContain('PRIVATE_STABLE_REFERENCE');
    await expect(repository.getEpisodeProviders(2, 'dub')).rejects.toMatchObject({ status: 404 });
  });
});

describe('resumable imports and shared free-tier reservation', () => {
  it('rejects source-identity retargeting and duplicate IDs without committing unrelated batch rows', async () => {
    await seedTitle();
    const conflict = await batch('titles', [titleRow(2), { ...titleRow(1), source_id: 'other-source', name: 'Wrong identity', updated_at: '2026-09-14T00:00:00Z' }]);
    await expect(applyImportBatch(db, db, conflict)).rejects.toMatchObject({ status: 409, code: 'IMPORT_IDENTITY_CONFLICT' });
    expect((await db.prepare('SELECT id,name,source_id FROM titles').all()).results).toEqual([{ id: 1, name: 'Test Alpha', source_id: 'fixture-1' }]);
    expect(await db.prepare('SELECT id FROM cloud_import_receipts WHERE id=?').bind(conflict.id).first()).toBeNull();
    await expect(applyImportBatch(db, db, await batch('titles', [{ ...titleRow(2), source_id: 'fixture-1' }]))).rejects.toMatchObject({ code: 'IMPORT_IDENTITY_CONFLICT' });
    await expect(applyImportBatch(db, db, await batch('titles', [titleRow(3), { ...titleRow(3), source_id: 'different' }]))).rejects.toMatchObject({ code: 'IMPORT_IDENTITY_CONFLICT' });
  });
  it('charges each failed mutation attempt while completed receipt replay remains free', async () => {
    const invalid = await batch('titles', [{ id: 99 }]);
    await expect(applyImportBatch(db, db, invalid)).rejects.toThrow(); const first = await getWriteBudget(db);
    await expect(applyImportBatch(db, db, invalid)).rejects.toThrow(); const second = await getWriteBudget(db);
    expect(second.writtenRowsReserved).toBe(first.writtenRowsReserved * 2);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM titles').first())?.count).toBe(0);
  });
  it('preserves an operator-disabled native resource and newer approval metadata on snapshot replay', async () => {
    await seedTitle();
    await applyImportBatch(db, db, await batch('episodes', [{ id: 2, title_id: 1, source_id: 'native-test-episode', number_text: '1', slug: 'one', canonical_url: 'https://anikototv.to/watch/fixture-1/one', first_seen_at: date, last_seen_at: date, created_at: date, updated_at: date }]));
    await applyImportBatch(db, db, await batch('episode_versions', [{ id: 3, episode_id: 2, source_id: 'native-test-sub', language: 'sub', first_seen_at: date, last_seen_at: date }]));
    await applyImportBatch(db, db, await batch('episode_provider_mappings', [{ id: 4, version_id: 3, provider_id: 'hd-1', source_mapping_id: 'native-approval-test', first_seen_at: date, last_seen_at: date, updated_at: date }]));
    const row = { mapping_id: 4, provider_id: 'hd-1', resource_id: 'fixed-approval-identity', language: 'sub', edition: 'Original approval', license: 'test-only', rights_evidence_url: 'https://example.invalid/rights', identity_evidence_url: 'https://example.invalid/identity', approved_at: date, enabled: 1, content_sha1: null };
    await applyImportBatch(db, db, await batch('native_resources', [row]));
    await db.prepare("UPDATE native_resources SET enabled=0,edition='New reviewed edition',approved_at='2026-09-14T00:00:00Z' WHERE mapping_id=4").run();
    await applyImportBatch(db, db, await batch('native_resources', [row]));
    expect((await db.prepare('SELECT enabled,edition FROM native_resources WHERE mapping_id=4').first())).toEqual({ enabled: 0, edition: 'New reviewed edition' });
    await expect(applyImportBatch(db, db, await batch('native_resources', [{ ...row, resource_id: 'different-film', approved_at: '2026-09-15T00:00:00Z' }]))).rejects.toMatchObject({ code: 'IMPORT_IDENTITY_CONFLICT' });
  });
  it('charges measured overruns and stops subsequent reservations rather than masking index costs', async () => {
    const budget = { dailyWrittenRows: 100, dailyQueueOperations: 20 };
    const receipt = await reserveWriteBudget(db, 'measured-overrun-test', 40, 0, budget);
    await settleWriteBudget(db, receipt.id, 90);
    expect((await getWriteBudget(db, budget)).writtenRowsReserved).toBe(106);
    await expect(reserveWriteBudget(db, 'later-import', 1, 0, budget)).rejects.toMatchObject({ code: 'IMPORT_QUOTA_PAUSED' });
    await settleWriteBudget(db, receipt.id, 90);
    expect((await getWriteBudget(db, budget)).writtenRowsReserved).toBe(106);
  });
  it('is idempotent, checksummed and rejects arbitrary tables or credentials', async () => {
    const input = await batch('titles', [titleRow(1)], 'same-batch');
    const imported = await applyImportBatch(db, db, input);
    expect(imported.status).toBe('imported');
    if ('measuredWrites' in imported) {
      expect(imported.measuredWrites).toBeGreaterThan(0);
      expect(imported.measuredWrites).toBeLessThanOrEqual(imported.estimatedWrites);
    }
    const before = await getWriteBudget(db);
    expect((await applyImportBatch(db, db, input)).status).toBe('already_imported');
    expect((await getWriteBudget(db)).writtenRowsReserved).toBe(before.writtenRowsReserved);
    await expect(applyImportBatch(db, db, { ...input, contentHash: '0'.repeat(64) })).rejects.toMatchObject({ code: 'IMPORT_CHECKSUM_MISMATCH' });
    expect(() => validateImportBatch({ ...input, table: 'accounts' })).toThrow();
    expect(() => validateImportBatch({ ...input, rows: [{ ...titleRow(1), password_hash: 'not-allowed' }] })).toThrow();
  });
  it('rolls back malformed batches and preserves newer/non-empty metadata on retry', async () => {
    await seedTitle();
    await expect(applyImportBatch(db, db, await batch('titles', [titleRow(2), { id: 3 }]))).rejects.toThrow();
    expect(await db.prepare('SELECT id FROM titles WHERE id=2').first()).toBeNull();
    await applyImportBatch(db, db, await batch('titles', [{ ...titleRow(1), description: null, updated_at: '2026-09-13T00:00:00Z' }]));
    expect((await db.prepare('SELECT description FROM titles WHERE id=1').first())?.description).toBe('Good original metadata');
    await applyImportBatch(db, db, await batch('titles', [{ ...titleRow(1), description: 'older import' }]));
    expect((await db.prepare('SELECT description FROM titles WHERE id=1').first())?.description).toBe('Good original metadata');
  });
  it('serializes concurrent budget claims and starts a fresh UTC window without losing receipts', async () => {
    const now = new Date('2026-09-12T12:00:00Z'); const limit = { dailyWrittenRows: 90, dailyQueueOperations: 10 };
    const results = await Promise.allSettled(['a', 'b', 'c'].map(id => reserveWriteBudget(db, id, 40, 0, limit, now)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    expect((await getWriteBudget(db, limit, now)).writtenRowsReserved).toBe(80);
    const winning = results.findIndex(result => result.status === 'fulfilled');
    await reserveWriteBudget(db, ['a', 'b', 'c'][winning], 40, 0, limit, now);
    expect((await getWriteBudget(db, limit, now)).writtenRowsReserved).toBe(80);
    await reserveWriteBudget(db, 'next', 40, 0, limit, new Date('2026-09-13T00:00:00Z'));
    expect((await getWriteBudget(db, limit, new Date('2026-09-13T01:00:00Z'))).writtenRowsReserved).toBe(40);
  });
});

describe('observed Anikoto server refresh', () => {
  it('distinguishes delayed, genuinely empty and malformed server responses', () => {
    expect(() => parseServerObservations('<div class="loading">Please wait</div>')).toThrow('still loading');
    expect(parseServerObservations("<p>You're watching episode 1</p>")).toEqual([]);
    expect(() => parseServerObservations('<div>Unrecognized response</div>')).toThrow('schema changed');
    expect(() => parseServerObservations('<a data-link-id="resource">HD-1</a>')).toThrow('Not every observed');
  });
  it('respects longest-path robots rules, explicit agents and crawl delay', () => {
    const rules = parseRobotsPolicy('User-agent: *\nDisallow: /ajax/\nAllow: /ajax/server/list\nCrawl-delay: 8\n');
    expect(robotsAllows(rules, '/ajax/secret')).toBe(false);
    expect(robotsAllows(rules, '/ajax/server/list?servers=public')).toBe(true);
    expect(rules.delayMs).toBe(8000);
    expect(robotsAllows(parseRobotsPolicy('User-agent: *\nAllow: /\nUser-agent: SolAnimeSchoolProject\nDisallow: /'), '/ajax/server/list')).toBe(false);
  });
  it('refreshes every visible mapping through the recorded request chain without resolving media', async () => {
    await seedTitle();
    await applyImportBatch(db, db, await batch('episodes', [{ id: 2, title_id: 1, source_id: 'test-ep', number_text: '1', slug: 'ep-1', canonical_url: 'https://anikototv.to/watch/fixture-1/ep-1', first_seen_at: date, last_seen_at: date, created_at: date, updated_at: date }]));
    await seedTask('episode_servers', { titleSourceId: 'fixture-1', episodeSourceId: 'test-ep', serversRef: 'stored server reference' });
    let clock = Date.now(); const requested: string[] = [];
    const send: typeof fetch = async input => {
      const url = String(input); requested.push(url);
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
      return Response.json({ status: 200, result: '<div class="type" data-type="sub"><a data-link-id="stable-a">HD-1</a><a data-link-id="stable-b">HD-2</a></div><div class="type" data-type="dub"><a data-link-id="stable-c">HD-1</a></div>' });
    };
    const result = await consumeSyncMessage(message(), db, createAnikotoSyncHandlers(db, { fetch: send, now: () => clock += 3000 }));
    expect(result.status).toBe('completed');
    expect(requested).toEqual(['https://anikototv.to/robots.txt', 'https://anikototv.to/ajax/server/list?servers=stored%20server%20reference']);
    const choices = await createCatalogueRepository(db).getEpisodeProviders(2, 'sub');
    expect(choices.providers.map(provider => provider.providerId)).toEqual(['hd-1', 'hd-2']);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM episode_provider_mappings').first())?.count).toBe(3);
    expect((await db.prepare("SELECT COUNT(*) AS count FROM episode_provider_mappings WHERE resolution_evidence_state='playback_verified'").first())?.count).toBe(0);
  });
  it('does not request blocked server paths or convert an access refusal into an empty inventory', async () => {
    await seedTitle();
    await applyImportBatch(db, db, await batch('episodes', [{ id: 2, title_id: 1, source_id: 'test-ep', number_text: '1', slug: 'ep-1', canonical_url: 'https://anikototv.to/watch/fixture-1/ep-1', first_seen_at: date, last_seen_at: date, created_at: date, updated_at: date }]));
    await seedTask('episode_servers', { titleSourceId: 'fixture-1', episodeSourceId: 'test-ep', serversRef: 'reference' });
    const requested: string[] = []; let clock = Date.now();
    const send: typeof fetch = async input => { requested.push(String(input)); return new Response('User-agent: *\nDisallow: /ajax/'); };
    expect((await consumeSyncMessage(message(), db, createAnikotoSyncHandlers(db, { fetch: send, now: () => clock += 3000 }))).status).toBe('blocked');
    expect(requested).toEqual(['https://anikototv.to/robots.txt']);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM episodes').first())?.count).toBe(1);
  });
});

describe('restricted research repository semantics', () => {
  it('retains provenance and uncertainty without enabling a reviewed playback declaration', async () => {
    const row: ImportRow = { id: 'site-test', source_id: 'site-test', collection: 'sites', name: 'Documented player', kind: 'site', url: 'https://example.test', research_status: 'reachable', evidence_class: 'public_reference_only', observation_date: date, canonical_id: null, provenance_path: 'indexes/sites.json', record_json: JSON.stringify({ iframe: true, runtime_verified: false }), record_hash: 'a'.repeat(64), imported_at: date };
    await applyImportBatch(db, research, await batch('research_records', [row], 'research-test', 'research'));
    const repository = createResearchRepository(research);
    const result = await repository.browseSources({ q: 'Documented' });
    expect(result.total).toBe(1); expect(result.items[0].hasImplementedCapability).toBe(0);
    const receipt = await repository.reviewSource('site-test', 'reviewed', 'operator-test', 'Reference inspected, native media not verified.');
    expect(receipt.capabilitiesChanged).toBe(false);
    expect((await repository.getSource('site-test')).evidence).toEqual({ iframe: true, runtime_verified: false });
    expect((await repository.coverage()).counts.verifiedPlaybackCapabilities).toBe(0);
    await expect(repository.reviewSource('site-test', 'enable_playback', 'operator-test')).rejects.toMatchObject({ status: 400 });
  });
});

describe('durable queue delivery and synchronization failures', () => {
  it('keeps notifications to task IDs and re-dispatches lost deliveries from durable state', async () => {
    await seedTask(); const delivered: unknown[] = [];
    const queue = { async send(body: unknown) { delivered.push(body); return { metadata: { metrics: { backlogCount: delivered.length, backlogBytes: 0 } } }; } };
    const time = new Date();
    expect((await dispatchSyncTasks(db, queue, undefined, 5, time)).dispatched).toBe(1);
    expect(delivered).toEqual([{ taskId: 1 }]);
    expect((await dispatchSyncTasks(db, queue, undefined, 5, time)).dispatched).toBe(0);
    expect((await dispatchSyncTasks(db, queue, undefined, 5, new Date(time.getTime() + 11 * 60_000))).dispatched).toBe(1);
  });
  it('commits a task once and rejects stale workers after an interrupted lease', async () => {
    await seedTitle(); await seedTask();
    const handler = async () => ({ statements: [db.prepare('UPDATE titles SET description=\'updated\' WHERE id=1')], estimatedWrittenRows: 20 });
    const first = message();
    expect((await consumeSyncMessage(first, db, { verified_test_handler: handler })).status).toBe('completed');
    expect(first.acked).toBe(1);
    expect((await consumeSyncMessage(message(), db, { verified_test_handler: handler })).status).toBe('paused_or_absent');
    expect((await db.prepare('SELECT description FROM titles WHERE id=1').first())?.description).toBe('updated');
    await db.prepare("UPDATE crawl_runs SET status='running' WHERE id=1").run();
    await db.prepare("UPDATE crawl_tasks SET status='running',lease_expires_at='2026-01-01T00:00:00Z',claimed_by='stopped' WHERE id=1").run();
    const stale = await consumeSyncMessage(message(), db, { verified_test_handler: async () => { await db.prepare("UPDATE crawl_tasks SET claimed_by='newer-worker' WHERE id=1").run(); return { statements: [db.prepare("UPDATE titles SET description='stale mutation' WHERE id=1")], estimatedWrittenRows: 20 }; } });
    expect(stale.status).toBe('stale_lease');
    expect((await db.prepare('SELECT description FROM titles WHERE id=1').first())?.description).toBe('updated');
  });
  it('preserves good rows for delayed responses, blocks explicit refusals and rejects malformed messages', async () => {
    await seedTitle(); await seedTask();
    const result = await consumeSyncMessage(message(), db, { verified_test_handler: async () => { throw new SyncSourceError('Loading placeholder; retry later.', 'UNAVAILABLE', true, 120); } });
    expect(result.status).toBe('retry'); expect((await db.prepare('SELECT description FROM titles WHERE id=1').first())?.description).toBe('Good original metadata');
    await db.prepare('UPDATE crawl_tasks SET available_at=? WHERE id=1').bind(date).run();
    expect((await consumeSyncMessage(message(), db, { verified_test_handler: async () => { throw new SyncSourceError('Source refused access; no bypass.', 'BLOCKED', false, 0, 403); } })).status).toBe('blocked');
    const invalid = message({ taskId: 1, url: 'http://127.0.0.1/private' });
    expect((await consumeSyncMessage(invalid, db, {})).status).toBe('invalid_message'); expect(invalid.acked).toBe(1);
  });
  it('pauses at the configured quota before mutation and retains the resumable task', async () => {
    await seedTitle(); await seedTask();
    await db.prepare('DELETE FROM cloud_budget_reservations').run(); await db.prepare('DELETE FROM cloud_daily_budget').run();
    const result = await consumeSyncMessage(message(), db, { verified_test_handler: async () => ({ statements: [db.prepare("UPDATE titles SET description='must not commit' WHERE id=1")], estimatedWrittenRows: 60 }) }, { dailyWrittenRows: 80, dailyQueueOperations: 10 });
    expect(result.status).toBe('retry'); expect(result.code).toBe('IMPORT_QUOTA_PAUSED');
    expect((await db.prepare('SELECT description FROM titles WHERE id=1').first())?.description).toBe('Good original metadata');
    expect((await db.prepare('SELECT status FROM crawl_tasks WHERE id=1').first())?.status).toBe('retry');
    expect((await createSyncRepository(db).status()).tasks).toHaveLength(1);
  });
});
