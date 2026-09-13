import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateImportBatch } from '../../server/cloud/data/import.ts';
import { IMPORT_TABLES, type ImportBatch, type ImportRow } from '../../server/cloud/data/import-schema.ts';
import type { BatchManifest, BatchManifestEntry } from './prepare.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const stable = (row: ImportRow, columns: string[]) => JSON.stringify(columns.map(column => [column, row[column] ?? null]));
const identity: Record<string, string[]> = {
  providers: ['id'], provider_aliases: ['provider_id', 'alias'],
  provider_connections: ['provider_id', 'hostname', 'path_pattern', 'relationship'],
  episode_versions: ['episode_id', 'source_id', 'language'],
  episode_provider_mappings: ['version_id', 'provider_id', 'source_mapping_id'],
  native_resources: ['mapping_id', 'provider_id', 'resource_id', 'language'],
  verification_observations: IMPORT_TABLES.verification_observations.columns,
};
function readBatch(path: string, entry: BatchManifestEntry) {
  if (!/^batches\/[a-zA-Z0-9_-]+\.json$/.test(entry.file)) throw new Error('Invalid delta audit batch path.');
  const raw = readFileSync(join(dirname(path), entry.file), 'utf8');
  if (hash(raw) !== entry.sha256) throw new Error(`Delta audit checksum mismatch: ${entry.file}`);
  const batch = validateImportBatch(JSON.parse(raw));
  if (batch.id !== entry.id || batch.table !== entry.table || batch.target !== entry.target || batch.rows.length !== entry.rows || hash(JSON.stringify(batch.rows)) !== batch.contentHash) throw new Error(`Delta audit metadata mismatch: ${entry.file}`);
  return batch;
}
/** Reject numeric-ID reuse for a different entity before producing or uploading a native delta. */
export function auditDeltaAgainstSnapshot(fullManifestPath: string, batches: ImportBatch[]) {
  const fullPath = resolve(fullManifestPath); const fullRaw = readFileSync(fullPath, 'utf8'); const full = JSON.parse(fullRaw) as BatchManifest;
  if (full.version !== 1 || !Array.isArray(full.batches) || full.totalBatches !== full.batches.length) throw new Error('The pinned full manifest is incomplete.');
  const selected = new Map<string, Map<string, ImportRow>>(); const counts: Record<string, { rows: number; matchedPinnedIdentities: number; newRows: number; pinnedMaximumId: number | null }> = {};
  const matched = new Set<string>();
  const episodeParents = new Set<number>(); const foundEpisodes = new Set<number>();
  for (const raw of batches) {
    const batch = validateImportBatch(raw); const spec = IMPORT_TABLES[batch.table];
    if (batch.target !== 'catalogue' || !identity[batch.table]) throw new Error(`Not an approved native-delta table: ${batch.table}`);
    const rows = selected.get(batch.table) ?? new Map<string, ImportRow>(); selected.set(batch.table, rows);
    for (const row of batch.rows) {
      const key = stable(row, spec.primaryKey);
      if (rows.has(key)) throw new Error(`Duplicate native-delta identity in ${batch.table}.`);
      rows.set(key, row);
      if (batch.table === 'episode_versions') episodeParents.add(Number(row.episode_id));
    }
  }
  for (const [table, rows] of selected) counts[table] = { rows: rows.size, matchedPinnedIdentities: 0, newRows: rows.size, pinnedMaximumId: null };
  for (const entry of full.batches) {
    if (entry.target !== 'catalogue' || (!selected.has(entry.table) && entry.table !== 'episodes')) continue;
    const batch = readBatch(fullPath, entry); const spec = IMPORT_TABLES[entry.table];
    for (const row of batch.rows) {
      if (entry.table === 'episodes') { if (episodeParents.has(Number(row.id))) foundEpisodes.add(Number(row.id)); continue; }
      const stats = counts[entry.table];
      if (spec.primaryKey.length === 1 && typeof row[spec.primaryKey[0]] === 'number') stats.pinnedMaximumId = Math.max(stats.pinnedMaximumId ?? 0, Number(row[spec.primaryKey[0]]));
      const key = stable(row, spec.primaryKey); const candidate = selected.get(entry.table)?.get(key);
      if (!candidate) continue;
      if (stable(row, identity[entry.table]) !== stable(candidate, identity[entry.table])) throw new Error(`Pinned numeric identity collision in ${entry.table} at ${key}; preserve both records and assign a reviewed new ID before export.`);
      // Priority duplicate upserts in the full manifest must count once.
      if (!matched.has(`${entry.table}:${key}`)) { stats.matchedPinnedIdentities++; stats.newRows--; matched.add(`${entry.table}:${key}`); }
    }
  }
  for (const [table, rows] of selected) for (const row of rows.values()) {
    const spec = IMPORT_TABLES[table]; const key = spec.primaryKey[0];
    if (!matched.has(`${table}:${stable(row, spec.primaryKey)}`) && spec.primaryKey.length === 1 && typeof row[key] === 'number' && Number(row[key]) >= 1_000_000_000) throw new Error(`New local ${table} ID overlaps the reserved cloud-generated range; reconcile explicitly before export.`);
  }
  if (episodeParents.size !== foundEpisodes.size) throw new Error('A native version references an episode absent from the pinned full snapshot; import a reviewed complete parent graph first.');
  return { sourceManifestHash: hash(fullRaw), tables: counts, requiredEpisodeParents: [...episodeParents], collisions: 0, note: 'Checked against the complete pinned source, including not-yet-hosted IDs. Required episode parents must also be present in the current hosted database. Existing delta IDs were not remapped.' };
}
export function auditNativeDelta(fullManifestPath: string, deltaManifestPath: string) {
  const path = resolve(deltaManifestPath); const manifest = JSON.parse(readFileSync(path, 'utf8')) as BatchManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.batches) || manifest.totalBatches !== manifest.batches.length) throw new Error('The delta manifest is incomplete.');
  return auditDeltaAgainstSnapshot(fullManifestPath, manifest.batches.map(entry => readBatch(path, entry)));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!option('full-manifest') || !option('delta-manifest')) throw new Error('Use --full-manifest=<pinned manifest> --delta-manifest=<existing native delta>. Audit is read-only.');
  console.log(JSON.stringify(auditNativeDelta(option('full-manifest')!, option('delta-manifest')!), null, 2));
}
