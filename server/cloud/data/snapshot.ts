import { AppError } from '../../errors.ts';
import type { CatalogueDatabase } from './catalogue.ts';
import { DEFAULT_SYNC_BUDGET, reserveWriteBudget, type SyncBudget } from './budget.ts';
import { applyImportBatch, validateImportBatch } from './import.ts';
import { groupImportRows } from './import-schema.ts';
import { withQueryBudget } from './query-budget.ts';
import { SyncSourceError, type SyncHandlers, type SyncTask } from './sync.ts';
import { MAX_SNAPSHOT_BUNDLE_BYTES, MAX_SNAPSHOT_MANIFEST_BYTES, validateSnapshotManifest, validateSnapshotPin, type SnapshotAssetBundle, type SnapshotAssetManifest, type SnapshotPin } from './snapshot-schema.ts';

type ImportAssetResponse = {
  status: number;
  headers: { get(name: string): string | null };
  body: { getReader(): { read(): Promise<{ done?: boolean; value?: Uint8Array }>; cancel(): Promise<unknown>; releaseLock(): void } } | null;
};
// A narrow binding contract works with both generated Workers types and the Node test runtime.
type ImportAssets = { fetch(input: string, init?: { redirect: 'manual' }): Promise<ImportAssetResponse> };
async function sha256(value: string): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join(''); }
async function readPrivateAsset(assets: ImportAssets, path: string, hash: string, maximum: number) {
  // The hostname is synthetic; this invokes only the deployment's asset binding, never network fetch.
  const response = await assets.fetch(`https://assets.local${path}`, { redirect: 'manual' });
  if (response.status !== 200 || !response.body) throw new SyncSourceError('The pinned private import asset is missing from this deployment. Restore its asset set or explicitly start a new snapshot.', 'UNAVAILABLE', false);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum) throw new AppError(422, 'UPSTREAM_CHANGED', 'A private import asset exceeded its bounded size.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; if (!chunk.value) throw new AppError(422, 'UPSTREAM_CHANGED', 'A private import asset returned an invalid stream chunk.'); bytes += chunk.value.byteLength; if (bytes > maximum) throw new AppError(422, 'UPSTREAM_CHANGED', 'A private import asset exceeded its bounded size.'); chunks.push(chunk.value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(joined); }
  catch { throw new AppError(422, 'UPSTREAM_CHANGED', 'A private import asset contains invalid UTF-8; no cursor advanced.'); }
  if (await sha256(text) !== hash) throw new AppError(422, 'UPSTREAM_CHANGED', 'A private import asset failed checksum verification; no cursor advanced.');
  try { return JSON.parse(text) as unknown; } catch { throw new AppError(422, 'UPSTREAM_CHANGED', 'A private import asset is not valid JSON.'); }
}
async function readManifest(assets: ImportAssets, pin: SnapshotPin): Promise<SnapshotAssetManifest> {
  validateSnapshotPin(pin);
  const manifest = validateSnapshotManifest(await readPrivateAsset(assets, pin.manifestPath, pin.manifestSha256, MAX_SNAPSHOT_MANIFEST_BYTES));
  if (pin.manifestPath !== `/__private-import/${manifest.id}/manifest.json`) throw new AppError(422, 'UPSTREAM_CHANGED', 'The snapshot identity differs from its pinned asset path.');
  return manifest;
}

/** Operator-only lifecycle. A deployment pin is configuration, not an arbitrary URL supplied by users. */
export function createSnapshotImportRepository(db: CatalogueDatabase, assets: ImportAssets, budget: SyncBudget = DEFAULT_SYNC_BUDGET) {
  async function ensure(pin: SnapshotPin) {
    validateSnapshotPin(pin);
    const prior = await db.prepare('SELECT id,manifest_hash AS manifestHash,run_id AS runId,task_id AS taskId,total_batches AS totalBatches,total_rows AS totalRows FROM cloud_snapshot_jobs WHERE manifest_path=?').bind(pin.manifestPath).first<{ id: string; manifestHash: string; runId: number; taskId: number; totalBatches: number; totalRows: number }>();
    if (prior) { if (prior.manifestHash !== pin.manifestSha256) throw new AppError(409, 'IMPORT_CONFLICT', 'This snapshot path already has a different pinned checksum.'); return { ...prior, created: false }; }
    const manifest = await readManifest(assets, pin); const now = new Date().toISOString(); const key = `snapshot:${manifest.id}`; const source = `private-assets:${manifest.id}`;
    await reserveWriteBudget(db, `snapshot-create:${manifest.id}`, 80, 0, budget);
    // The atomic batch reserves a separate high-ID range. Local task/run IDs are never reassigned.
    await db.batch([
      db.prepare("INSERT INTO crawl_runs(id,source,mode,status,tasks_discovered,checkpoint_json,created_at,updated_at) SELECT (SELECT MAX(COALESCE(MAX(id),0),1000000000)+1 FROM crawl_runs),?,'snapshot','queued',1,'{}',?,? WHERE NOT EXISTS(SELECT 1 FROM cloud_snapshot_jobs WHERE id=?)").bind(source, now, now, manifest.id),
      db.prepare("INSERT INTO crawl_tasks(id,run_id,task_key,task_type,payload_json,checkpoint_json,status,max_attempts,available_at,created_at,updated_at) SELECT (SELECT MAX(COALESCE(MAX(id),0),1000000000)+1 FROM crawl_tasks),(SELECT id FROM crawl_runs WHERE source=? ORDER BY id DESC LIMIT 1),?,'snapshot_import',?,'{\"nextBatch\":0}','pending',5,?,?,? WHERE NOT EXISTS(SELECT 1 FROM cloud_snapshot_jobs WHERE id=?)").bind(source, key, JSON.stringify({ snapshotId: manifest.id }), now, now, now, manifest.id),
      db.prepare('INSERT INTO cloud_snapshot_jobs(id,manifest_path,manifest_hash,source_manifest_hash,run_id,task_id,total_batches,total_rows,created_at) SELECT ?,?,?,?,run_id,id,?,?,? FROM crawl_tasks WHERE task_key=? ORDER BY id DESC LIMIT 1 ON CONFLICT(id) DO NOTHING').bind(manifest.id, pin.manifestPath, pin.manifestSha256, manifest.sourceManifestSha256, manifest.totalBatches, manifest.totalRows, now, key),
    ]);
    const job = await db.prepare('SELECT id,run_id AS runId,task_id AS taskId,total_batches AS totalBatches,total_rows AS totalRows FROM cloud_snapshot_jobs WHERE id=?').bind(manifest.id).first<{ id: string; runId: number; taskId: number; totalBatches: number; totalRows: number }>();
    if (!job) throw new AppError(500, 'INTERNAL_ERROR', 'The durable snapshot job could not be created.');
    return { ...job, created: true };
  }
  async function status() {
    const jobs = await db.prepare("SELECT j.id,j.run_id AS runId,j.task_id AS taskId,j.total_batches AS totalBatches,j.total_rows AS totalRows,j.created_at AS createdAt,r.status AS runStatus,t.status,CAST(COALESCE(json_extract(t.checkpoint_json,'$.nextBatch'),0) AS INTEGER) AS importedBatches,t.available_at AS availableAt,t.last_error_code AS errorCode,t.last_error_message AS errorMessage FROM cloud_snapshot_jobs j JOIN crawl_tasks t ON t.id=j.task_id JOIN crawl_runs r ON r.id=j.run_id ORDER BY j.created_at DESC LIMIT 20").all();
    return { jobs: jobs.results, storage: 'private_worker_assets', publicAssetServing: false };
  }
  return { ensure, status };
}

/** Import receipts are authoritative across the two D1 databases; cursor replay is always idempotent. */
export function createSnapshotImportHandlers(catalogue: CatalogueDatabase, research: CatalogueDatabase, assets: ImportAssets, budget: SyncBudget = DEFAULT_SYNC_BUDGET, options: { maxBatchesPerDelivery?: number } = {}): SyncHandlers {
  const maximumBatches = options.maxBatchesPerDelivery ?? 4;
  if (!Number.isSafeInteger(maximumBatches) || maximumBatches < 1 || maximumBatches > 4) throw new AppError(400, 'BAD_REQUEST', 'Choose between one and four snapshot batches per leased delivery.');
  return { snapshot_import: async (task: SyncTask) => {
    // Reserve 14 SQL statements for the consumer's lease/finalization plus two asset reads.
    // At most 27 handler statements + those 16 operations fit the <=45 safety envelope.
    const queries = { used: 0, maximum: 27 };
    const catalogueDb = withQueryBudget(catalogue, queries); const researchDb = withQueryBudget(research, queries);
    const job = await catalogueDb.prepare('SELECT manifest_path AS manifestPath,manifest_hash AS manifestSha256,total_batches AS totalBatches FROM cloud_snapshot_jobs WHERE id=? AND task_id=? AND run_id=?').bind(String(task.payload.snapshotId), task.id, task.runId).first<SnapshotPin & { totalBatches: number }>();
    if (!job) throw new SyncSourceError('This snapshot task has no pinned deployment manifest; its payload is retained.', 'BLOCKED', false);
    const manifest = await readManifest(assets, job);
    let cursor = task.checkpoint.nextBatch ?? 0;
    if (!Number.isSafeInteger(cursor) || Number(cursor) < 0 || Number(cursor) > manifest.totalBatches || manifest.totalBatches !== job.totalBatches) throw new AppError(422, 'UPSTREAM_CHANGED', 'The durable snapshot cursor or batch count is invalid.');
    if (cursor === manifest.totalBatches) return { statements: [], estimatedWrittenRows: 0, complete: true, checkpoint: { nextBatch: cursor, totalBatches: manifest.totalBatches } };
    const entry = manifest.bundles.find(bundle => Number(cursor) >= bundle.startBatch && Number(cursor) < bundle.startBatch + bundle.batches);
    if (!entry) throw new AppError(422, 'UPSTREAM_CHANGED', 'The snapshot cursor is not covered by a checked bundle.');
    const bundle = await readPrivateAsset(assets, entry.path, entry.sha256, MAX_SNAPSHOT_BUNDLE_BYTES) as SnapshotAssetBundle;
    if (!bundle || bundle.version !== 1 || bundle.snapshot !== manifest.id || bundle.startBatch !== entry.startBatch || !Array.isArray(bundle.batches) || bundle.batches.length !== entry.batches) throw new AppError(422, 'UPSTREAM_CHANGED', 'The private bundle shape differs from its manifest.');
    let processed = 0; let checkpoint = task.checkpoint;
    while (processed < maximumBatches && Number(cursor) < entry.startBatch + entry.batches) {
      const selected = bundle.batches[Number(cursor) - entry.startBatch];
      if (!selected || typeof selected.sha256 !== 'string' || await sha256(JSON.stringify(selected.data)) !== selected.sha256) throw new AppError(422, 'UPSTREAM_CHANGED', 'The private batch checksum failed.');
      const batch = validateImportBatch(selected.data);
      // Receipt lookup + reservation + normalized data/receipt + settlement + lease/cursor.
      // Homogeneous generated batches cost at most 12 SQL statements; receipt replay costs fewer.
      const worstQueries = groupImportRows(batch.rows).length + 11;
      if (queries.used + worstQueries > queries.maximum) {
        if (!processed) throw new AppError(422, 'UPSTREAM_CHANGED', 'This heterogeneous snapshot batch must be split to respect the free-tier query limit.');
        break;
      }
      const lease = await catalogueDb.prepare("SELECT t.id FROM crawl_tasks t JOIN crawl_runs r ON r.id=t.run_id WHERE t.id=? AND t.claimed_by=? AND t.lease_expires_at>? AND t.status='running' AND r.status IN ('queued','running')").bind(task.id, task.lease, new Date().toISOString()).first();
      if (!lease) throw new SyncSourceError('The snapshot lease changed before import; its cursor was not advanced.', 'UNAVAILABLE', true, 300);
      // If the Worker stops after this commit, a later delivery repeats the receipt before advancing.
      const result = await applyImportBatch(catalogueDb, batch.target === 'catalogue' ? catalogueDb : researchDb, batch, budget);
      cursor = Number(cursor) + 1;
      checkpoint = { nextBatch: cursor, totalBatches: manifest.totalBatches, lastBatchId: batch.id, lastTarget: batch.target, lastTable: batch.table, lastResult: result.status };
      // This write is covered by the snapshot consumer's 80-write control reservation.
      const saved = await catalogueDb.prepare("UPDATE crawl_tasks SET checkpoint_json=?,updated_at=? WHERE id=? AND claimed_by=? AND status='running' AND lease_expires_at>? AND EXISTS(SELECT 1 FROM crawl_runs r WHERE r.id=crawl_tasks.run_id AND r.status IN ('queued','running'))").bind(JSON.stringify(checkpoint), new Date().toISOString(), task.id, task.lease, new Date().toISOString()).run();
      if (!saved.meta.changes) throw new SyncSourceError('The snapshot lease changed after its data receipt; replay will recover the cursor.', 'UNAVAILABLE', true, 300);
      task.checkpoint = checkpoint; processed++;
    }
    return { statements: [], estimatedWrittenRows: 0, checkpoint, complete: cursor === manifest.totalBatches, retryAfterSeconds: 1 };
  } };
}
