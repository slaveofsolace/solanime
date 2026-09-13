import { AppError } from '../../errors.ts';
import type { ImportBatch } from './import-schema.ts';

export const MAX_SNAPSHOT_BUNDLE_BYTES = 450_000;
export const MAX_SNAPSHOT_MANIFEST_BYTES = 500_000;
export const MAX_SNAPSHOT_BUNDLE_BATCHES = 100;
export interface SnapshotBundleEntry { path: string; sha256: string; bytes: number; startBatch: number; batches: number; rows: number; }
export interface SnapshotAssetManifest {
  version: 1; kind: 'solanime-private-import'; id: string; sourceManifestSha256: string;
  totalBatches: number; totalRows: number; totalEstimatedWrites: number;
  catalogueCounts: Record<string, number>; researchCounts: Record<string, unknown>; bundles: SnapshotBundleEntry[];
}
export interface SnapshotAssetBundle { version: 1; snapshot: string; startBatch: number; batches: Array<{ sha256: string; data: ImportBatch }>; }
export interface SnapshotPin { manifestPath: string; manifestSha256: string; }
export const hashPattern = /^[a-f0-9]{64}$/;
export function validateSnapshotPin(pin: SnapshotPin): SnapshotPin {
  if (!pin || !/^\/__private-import\/[a-f0-9]{64}\/manifest\.json$/.test(pin.manifestPath) || !hashPattern.test(pin.manifestSha256)) throw new AppError(400, 'BAD_REQUEST', 'Choose a checksummed private snapshot manifest from this deployment.');
  return pin;
}
export function validateSnapshotManifest(input: unknown): SnapshotAssetManifest {
  const value = input as SnapshotAssetManifest;
  if (!value || value.version !== 1 || value.kind !== 'solanime-private-import' || !hashPattern.test(value.id) || !hashPattern.test(value.sourceManifestSha256) || value.id !== value.sourceManifestSha256 || !Number.isSafeInteger(value.totalBatches) || value.totalBatches < 1 || value.totalBatches > 1_000_000 || !Number.isSafeInteger(value.totalRows) || value.totalRows < 1 || !Number.isSafeInteger(value.totalEstimatedWrites) || value.totalEstimatedWrites < 1 || !Array.isArray(value.bundles) || value.bundles.length < 1 || value.bundles.length > 10_000) throw new AppError(422, 'UPSTREAM_CHANGED', 'The private snapshot manifest is malformed.');
  let next = 0; let rows = 0;
  for (let index = 0; index < value.bundles.length; index++) {
    const entry = value.bundles[index];
    if (entry.path !== `/__private-import/${value.id}/bundles/${String(index).padStart(6, '0')}.json` || !hashPattern.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_SNAPSHOT_BUNDLE_BYTES || entry.startBatch !== next || !Number.isSafeInteger(entry.batches) || entry.batches < 1 || entry.batches > MAX_SNAPSHOT_BUNDLE_BATCHES || !Number.isSafeInteger(entry.rows) || entry.rows < 1) throw new AppError(422, 'UPSTREAM_CHANGED', 'The private snapshot bundle index is malformed or incomplete.');
    next += entry.batches; rows += entry.rows;
  }
  if (next !== value.totalBatches || rows !== value.totalRows) throw new AppError(422, 'UPSTREAM_CHANGED', 'Private snapshot totals do not reconcile with its bundles.');
  return value;
}
