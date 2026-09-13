import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyImportBatch, applyImportBatchGroup, importHash } from '../server/cloud/data/import.ts';
import { getWriteBudget } from '../server/cloud/data/budget.ts';
import { withQueryBudget } from '../server/cloud/data/query-budget.ts';
import { createSnapshotImportHandlers } from '../server/cloud/data/snapshot.ts';
import type { CatalogueDatabase } from '../server/cloud/data/catalogue.ts';
import type { ImportBatch, ImportRow } from '../server/cloud/data/import-schema.ts';
import type { SnapshotAssetManifest } from '../server/cloud/data/snapshot-schema.ts';
import type { SyncTask } from '../server/cloud/data/sync.ts';
import type { D1PreparedStatement } from '@cloudflare/workers-types';

let runtime: Miniflare;
let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const row = (id: number) => ({ id, slug: `fixture-${id}`, name: `Fixture ${id}` });
async function batch(id: number, rows: ImportRow[] = [row(id)]): Promise<ImportBatch> {
  return { version: 1, id: `group-test-${id}`, snapshotId: 'group-test', target: 'catalogue', table: 'genres', rows, contentHash: await importHash(rows) };
}

beforeAll(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ name: 'group-import-contract', modules: true, script: 'export default { fetch() { return new Response("test-only") } }', compatibilityDate: '2026-09-12', d1Databases: { CATALOGUE: 'group-import-test' } }));
  db = await runtime.getD1Database('CATALOGUE');
  await db.prepare('CREATE TABLE crawl_runs(id INTEGER PRIMARY KEY,status TEXT)').run();
  await db.prepare('CREATE TABLE crawl_tasks(id INTEGER PRIMARY KEY,run_id INTEGER,status TEXT,available_at TEXT,claimed_by TEXT,lease_expires_at TEXT,updated_at TEXT)').run();
  for (const name of ['007_cloud_sync.sql', '009_cloud_snapshot_jobs.sql']) for (const statement of readFileSync(new URL(`../migrations/cloud/catalogue/${name}`, import.meta.url), 'utf8').replace(/^--.*$/gm, '').split(';').filter(value => value.trim())) await db.prepare(statement).run();
  await db.prepare('CREATE TABLE genres(id INTEGER PRIMARY KEY,slug TEXT NOT NULL UNIQUE,name TEXT NOT NULL)').run();
}, 60_000);
afterAll(async () => { await runtime?.dispose(); });
beforeEach(async () => {
  for (const table of ['genres', 'cloud_snapshot_jobs', 'crawl_tasks', 'crawl_runs', 'cloud_import_receipts', 'cloud_budget_reservations', 'cloud_daily_budget']) await db.prepare(`DELETE FROM ${table}`).run();
});

describe('atomic grouped pinned imports', () => {
  it('imports ten original batches in one reservation and retains individually replayable receipts', async () => {
    const inputs = await Promise.all(Array.from({ length: 10 }, (_, index) => batch(index + 1, Array.from({ length: 35 }, (_, offset) => row(index * 35 + offset + 1)))));
    const queries = { used: 0, maximum: 27 }; const counted = withQueryBudget(db, queries);
    const grouped = await applyImportBatchGroup(counted, counted, inputs);
    expect(grouped.results).toHaveLength(10);
    expect(grouped.results.every(result => result.status === 'imported')).toBe(true);
    expect(queries.used).toBeLessThanOrEqual(20);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM cloud_budget_reservations').first())?.count).toBe(1);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM cloud_import_receipts').first())?.count).toBe(10);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM genres').first())?.count).toBe(350);
    const allowance = await getWriteBudget(db);
    for (const input of inputs) expect((await applyImportBatch(db, db, input)).status).toBe('already_imported');
    expect((await getWriteBudget(db)).writtenRowsReserved).toBe(allowance.writtenRowsReserved);
  });

  it('replays partial groups without rewriting the already completed receipt', async () => {
    const inputs = [await batch(1), await batch(2), await batch(3)];
    await applyImportBatch(db, db, inputs[1]);
    const result = await applyImportBatchGroup(db, db, inputs);
    expect(result.results.map(value => value.status)).toEqual(['imported', 'already_imported', 'imported']);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM genres').first())?.count).toBe(3);
  });

  it('rolls every new receipt and row back when one row is malformed', async () => {
    const inputs = [await batch(1), await batch(2, [{ id: 2, slug: 'fixture-2', name: null }])];
    await expect(applyImportBatchGroup(db, db, inputs)).rejects.toThrow();
    expect((await db.prepare('SELECT COUNT(*) AS count FROM genres').first())?.count).toBe(0);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM cloud_import_receipts').first())?.count).toBe(0);
    expect((await db.prepare('SELECT settled_writes AS settled FROM cloud_budget_reservations').first())?.settled).toBeNull();
  });

  it('rejects existing and intra-group identity conflicts without advancing unrelated rows', async () => {
    await applyImportBatch(db, db, await batch(1));
    await expect(applyImportBatchGroup(db, db, [await batch(2), await batch(3, [{ ...row(3), slug: 'fixture-1' }])])).rejects.toMatchObject({ code: 'IMPORT_IDENTITY_CONFLICT' });
    expect((await db.prepare('SELECT COUNT(*) AS count FROM genres').first())?.count).toBe(1);
    await expect(applyImportBatchGroup(db, db, [await batch(4), await batch(5, [row(4)])])).rejects.toMatchObject({ code: 'IMPORT_IDENTITY_CONFLICT' });
    expect((await db.prepare('SELECT COUNT(*) AS count FROM cloud_import_receipts').first())?.count).toBe(1);
  });

  it('validates every checksum, stored receipt and batch column shape before writes', async () => {
    const one = await batch(1); await applyImportBatch(db, db, one);
    const before = await getWriteBudget(db);
    await expect(applyImportBatchGroup(db, db, [await batch(2), { ...await batch(3), contentHash: '0'.repeat(64) }])).rejects.toMatchObject({ code: 'IMPORT_CHECKSUM_MISMATCH' });
    await expect(applyImportBatchGroup(db, db, [await batch(1, [{ ...row(1), name: 'Different' }]), await batch(2)])).rejects.toMatchObject({ code: 'IMPORT_CONFLICT' });
    await expect(applyImportBatchGroup(db, db, [await batch(2), await batch(3, [{ id: 3 }])])).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
    expect((await getWriteBudget(db)).writtenRowsReserved).toBe(before.writtenRowsReserved);
  });

  it('rejects an expired catalogue lease inside the atomic receipt/data transaction', async () => {
    await db.prepare("INSERT INTO crawl_runs(id,status) VALUES(1,'running')").run();
    await db.prepare("INSERT INTO crawl_tasks(id,run_id,status,claimed_by,lease_expires_at) VALUES(1,1,'running','old-lease','2000-01-01T00:00:00Z')").run();
    await expect(applyImportBatchGroup(db, db, [await batch(1), await batch(2)], undefined, { taskId: 1, runId: 1, lease: 'old-lease' })).rejects.toThrow('lease changed');
    expect((await db.prepare('SELECT COUNT(*) AS count FROM genres').first())?.count).toBe(0);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM cloud_import_receipts').first())?.count).toBe(0);
  });

  it('keeps a full conservative reservation after a lost successful batch response', async () => {
    const uncertain: CatalogueDatabase = {
      prepare: sql => db.prepare(sql),
      batch: async <T = unknown>(statements: D1PreparedStatement[]) => { const result = await db.batch<T>(statements); if (statements.length === 3) throw new Error('Injected lost target commit response'); return result; },
    };
    const result = await applyImportBatchGroup(db, uncertain, [await batch(1), await batch(2)]);
    expect(result.results.every(value => value.status === 'already_imported')).toBe(true);
    expect(result.measuredWrites).toBeNull();
    expect((await db.prepare('SELECT settled_writes AS settled FROM cloud_budget_reservations').first())?.settled).toBeNull();
    expect((await db.prepare('SELECT COUNT(*) AS count FROM genres').first())?.count).toBe(2);
  });

  it('allows concurrent replay to win only once and retains the losing attempt charge', async () => {
    const inputs = [await batch(1), await batch(2)];
    const results = await Promise.all([applyImportBatchGroup(db, db, inputs), applyImportBatchGroup(db, db, inputs)]);
    expect(results.flatMap(result => result.results).filter(result => result.status === 'imported')).toHaveLength(2);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM genres').first())?.count).toBe(2);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM cloud_import_receipts').first())?.count).toBe(2);
  });
});

async function snapshot(inputs: ImportBatch[]) {
  const id = hash(JSON.stringify(inputs)); const prefix = `/__private-import/${id}`;
  const bundle = JSON.stringify({ version: 1, snapshot: id, startBatch: 0, batches: inputs.map(data => ({ data, sha256: hash(JSON.stringify(data)) })) });
  const manifest: SnapshotAssetManifest = { version: 1, kind: 'solanime-private-import', id, sourceManifestSha256: id, totalBatches: inputs.length, totalRows: inputs.reduce((sum, entry) => sum + entry.rows.length, 0), totalEstimatedWrites: 5000, catalogueCounts: {}, researchCounts: {}, bundles: [{ path: `${prefix}/bundles/000000.json`, sha256: hash(bundle), bytes: Buffer.byteLength(bundle), startBatch: 0, batches: inputs.length, rows: inputs.reduce((sum, entry) => sum + entry.rows.length, 0) }] };
  const text = JSON.stringify(manifest); const manifestPath = `${prefix}/manifest.json`; const files = new Map([[manifestPath, text], [`${prefix}/bundles/000000.json`, bundle]]);
  await db.prepare("INSERT INTO crawl_runs(id,status) VALUES(1,'running')").run();
  await db.prepare("INSERT INTO crawl_tasks(id,run_id,status,claimed_by,lease_expires_at,checkpoint_json) VALUES(1,1,'running','lease','2100-01-01T00:00:00Z','{}')").run();
  await db.prepare('INSERT INTO cloud_snapshot_jobs(id,manifest_path,manifest_hash,source_manifest_hash,run_id,task_id,total_batches,total_rows,created_at) VALUES(?,?,?,?,1,1,?,?,?)').bind(id, manifestPath, hash(text), id, inputs.length, manifest.totalRows, new Date().toISOString()).run();
  const task: SyncTask = { id: 1, runId: 1, taskKey: 'fixture', taskType: 'snapshot_import', payload: { snapshotId: id }, checkpoint: {}, attempt: 1, maxAttempts: 4, lease: 'lease' };
  return { task, files, assets: { async fetch(input: string) { const body = files.get(new URL(input).pathname); return new Response(body ?? 'not found', { status: body ? 200 : 404 }); } } };
}

describe('snapshot grouping preserves the original pinned cursor', () => {
  it('advances ten pinned batches within the shared 27-query handler envelope', async () => {
    const inputs = await Promise.all(Array.from({ length: 10 }, (_, index) => batch(index + 1)));
    const fixture = await snapshot(inputs); const queries = { used: 0, maximum: 27 }; const counted = withQueryBudget(db, queries);
    const result = await createSnapshotImportHandlers(counted, counted, fixture.assets).snapshot_import(fixture.task);
    expect(result.complete).toBe(true); expect(result.checkpoint?.nextBatch).toBe(10);
    expect(queries.used).toBeLessThanOrEqual(24);
    expect(JSON.parse(String((await db.prepare('SELECT checkpoint_json FROM crawl_tasks WHERE id=1').first())?.checkpoint_json)).nextBatch).toBe(10);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM cloud_import_receipts').first())?.count).toBe(10);
  });

  it('replays committed receipts after an interrupted cursor write without spending data writes again', async () => {
    const inputs = [await batch(1), await batch(2)]; const fixture = await snapshot(inputs);
    await applyImportBatchGroup(db, db, inputs);
    const before = await getWriteBudget(db);
    const result = await createSnapshotImportHandlers(db, db, fixture.assets).snapshot_import(fixture.task);
    expect(result.checkpoint?.nextBatch).toBe(2);
    expect((await getWriteBudget(db)).writtenRowsReserved).toBe(before.writtenRowsReserved);
  });

  it('does not write data or move the cursor when the pinned bundle checksum fails', async () => {
    const fixture = await snapshot([await batch(1), await batch(2)]);
    const bundlePath = [...fixture.files.keys()].find(path => path.includes('/bundles/'))!;
    fixture.files.set(bundlePath, `${fixture.files.get(bundlePath)} `);
    await expect(createSnapshotImportHandlers(db, db, fixture.assets).snapshot_import(fixture.task)).rejects.toThrow('checksum');
    expect((await db.prepare('SELECT COUNT(*) AS count FROM genres').first())?.count).toBe(0);
    expect(fixture.task.checkpoint).toEqual({});
  });

  it('shortens a group to the remaining daily allowance while keeping its next cursor', async () => {
    const fixture = await snapshot([await batch(1), await batch(2), await batch(3)]);
    // One genre batch reserves 21 writes and leaves 32 for task finalization;
    // two batches require 28 + 32, so this configured allowance permits only one.
    const result = await createSnapshotImportHandlers(db, db, fixture.assets, { dailyWrittenRows: 59, dailyQueueOperations: 20 }).snapshot_import(fixture.task);
    expect(result.complete).toBe(false); expect(result.checkpoint?.nextBatch).toBe(1);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM genres').first())?.count).toBe(1);
  });
});
