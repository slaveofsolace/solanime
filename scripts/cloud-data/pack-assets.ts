import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BatchManifest } from './prepare.ts';
import { validateImportBatch } from '../../server/cloud/data/import.ts';
import { MAX_SNAPSHOT_BUNDLE_BATCHES, MAX_SNAPSHOT_BUNDLE_BYTES, MAX_SNAPSHOT_MANIFEST_BYTES, validateSnapshotManifest, type SnapshotAssetBundle, type SnapshotAssetManifest } from '../../server/cloud/data/snapshot-schema.ts';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
/** Build output only. Never point this directory at Pages public/ or dist/. */
export function packImportAssets(manifestPath: string, outputRoot: string) {
  const text = readFileSync(manifestPath, 'utf8'); const source = JSON.parse(text) as BatchManifest; const sourceHash = sha256(text);
  if (source.version !== 1 || source.totalBatches !== source.batches.length || !source.batches.length) throw new Error('The full import manifest is incomplete.');
  const prefix = `/__private-import/${sourceHash}`; const directory = join(outputRoot, prefix.slice(1));
  if (existsSync(join(directory, 'manifest.json'))) throw new Error('This private asset set already exists. Preserve it and choose a fresh output root or use its existing pin.');
  mkdirSync(join(directory, 'bundles'), { recursive: true });
  const manifest: SnapshotAssetManifest = { version: 1, kind: 'solanime-private-import', id: sourceHash, sourceManifestSha256: sourceHash, totalBatches: source.totalBatches, totalRows: 0, totalEstimatedWrites: source.totalEstimatedWrites, catalogueCounts: source.catalogueCounts, researchCounts: source.researchCounts, bundles: [] };
  let current: SnapshotAssetBundle = { version: 1, snapshot: sourceHash, startBatch: 0, batches: [] }; let currentBytes = Buffer.byteLength(JSON.stringify(current));
  function flush() {
    if (!current.batches.length) return;
    const json = JSON.stringify(current); const bytes = Buffer.byteLength(json); const path = `${prefix}/bundles/${String(manifest.bundles.length).padStart(6, '0')}.json`;
    if (bytes > MAX_SNAPSHOT_BUNDLE_BYTES) throw new Error('A private bundle exceeded its byte cap. No complete manifest was written.');
    writeFileSync(join(outputRoot, path.slice(1)), json, { encoding: 'utf8', mode: 0o600 });
    const rows = current.batches.reduce((count, batch) => count + batch.data.rows.length, 0);
    manifest.bundles.push({ path, sha256: sha256(json), bytes, startBatch: current.startBatch, batches: current.batches.length, rows }); manifest.totalRows += rows;
    current = { version: 1, snapshot: sourceHash, startBatch: current.startBatch + current.batches.length, batches: [] }; currentBytes = Buffer.byteLength(JSON.stringify(current));
  }
  for (const entry of source.batches) {
    if (!/^batches\/[a-zA-Z0-9_-]+\.json$/.test(entry.file)) throw new Error('Import files must remain inside the source manifest batches directory.');
    const raw = readFileSync(join(dirname(manifestPath), entry.file), 'utf8');
    if (sha256(raw) !== entry.sha256) throw new Error(`Batch checksum mismatch: ${entry.id}`);
    const data = validateImportBatch(JSON.parse(raw));
    if (data.id !== entry.id || data.target !== entry.target || data.table !== entry.table || data.rows.length !== entry.rows || sha256(JSON.stringify(data.rows)) !== data.contentHash) throw new Error(`Batch metadata mismatch: ${entry.id}`);
    const packed = { sha256: sha256(JSON.stringify(data)), data }; const extra = Buffer.byteLength(JSON.stringify(packed)) + 1;
    if (current.batches.length && (currentBytes + extra > MAX_SNAPSHOT_BUNDLE_BYTES || current.batches.length >= MAX_SNAPSHOT_BUNDLE_BATCHES)) flush();
    current.batches.push(packed); currentBytes += extra;
  }
  flush(); validateSnapshotManifest(manifest);
  const json = JSON.stringify(manifest); if (Buffer.byteLength(json) > MAX_SNAPSHOT_MANIFEST_BYTES) throw new Error('Private asset index is too large; choose a partitioned snapshot.');
  writeFileSync(join(directory, 'manifest.json'), json, { encoding: 'utf8', mode: 0o600 });
  return { directory: resolve(outputRoot), manifestPath: `${prefix}/manifest.json`, manifestSha256: sha256(json), bundles: manifest.bundles.length, assetFiles: manifest.bundles.length + 1, bytes: manifest.bundles.reduce((total, bundle) => total + bundle.bytes, Buffer.byteLength(json)), totalBatches: manifest.totalBatches, totalRows: manifest.totalRows, maximumBundleBytes: Math.max(...manifest.bundles.map(bundle => bundle.bytes)) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const manifest = option('manifest'); const output = option('out');
  if (!manifest || !output) throw new Error('Use --manifest=<full manifest.json> --out=<private Worker assets directory outside public/dist>.');
  console.log(JSON.stringify(packImportAssets(resolve(manifest), resolve(output)), null, 2));
}
