import { AppError } from '../../errors.ts';
import type { CatalogueDatabase } from './catalogue.ts';
import { DEFAULT_SYNC_BUDGET, reserveWriteBudget, settleWriteBudget, type SyncBudget } from './budget.ts';
import { IMPORT_TABLES, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, estimateImportWrites, groupImportRows, identityConflictSql, upsertJsonRowsSql, type ImportBatch, type ImportRow, type ImportTarget } from './import-schema.ts';
import { validateArtworkImportRow } from '../../artwork/import.ts';

export function validateImportBatch(value: unknown): ImportBatch {
  if (!value || typeof value !== 'object') throw new AppError(400, 'INVALID_IMPORT', 'Expected an import batch.');
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || typeof item.id !== 'string' || !/^[a-zA-Z0-9:._-]{1,180}$/.test(item.id) || typeof item.snapshotId !== 'string' || !/^[a-zA-Z0-9:._-]{1,180}$/.test(item.snapshotId) || typeof item.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.contentHash) || typeof item.table !== 'string' || !IMPORT_TABLES[item.table] || !['catalogue', 'research'].includes(String(item.target)) || (IMPORT_TABLES[item.table].target !== 'both' && IMPORT_TABLES[item.table].target !== item.target) || !Array.isArray(item.rows) || item.rows.length < 1 || item.rows.length > MAX_IMPORT_ROWS)
    throw new AppError(400, 'INVALID_IMPORT', 'Invalid import identity, target, table, checksum, or row count.');
  const spec = IMPORT_TABLES[item.table];
  const records: ImportRow[] = [];
  for (const row of item.rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new AppError(400, 'INVALID_IMPORT', 'Every imported row must be an object.');
    const result: ImportRow = {};
    for (const [key, cell] of Object.entries(row)) {
      if (!spec.columns.includes(key) || !(cell === null || typeof cell === 'string' || (typeof cell === 'number' && Number.isFinite(cell)))) throw new AppError(400, 'INVALID_IMPORT', 'Unknown columns or non-scalar import value.');
      result[key] = cell;
    }
    if (spec.primaryKey.some(key => result[key] == null)) throw new AppError(400, 'INVALID_IMPORT', 'Every imported row needs its stable primary key.');
    try { validateArtworkImportRow(item.table, result, spec.columns); }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError(400, 'INVALID_IMPORT', 'The artwork resource or review does not match the supported source contract.'); }
    records.push(result);
  }
  const primaryKeys = new Set<string>(); const naturalKeys = new Set<string>();
  for (const row of records) {
    const primary = JSON.stringify(spec.primaryKey.map(key => row[key]));
    if (primaryKeys.has(primary)) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'An import batch repeats an internal primary key. No records were written.', { table: item.table });
    primaryKeys.add(primary);
    const uniqueKeys = spec.uniqueKeys ?? (spec.uniqueIdentity && spec.identity ? [spec.identity] : []);
    for (const [index, keys] of uniqueKeys.entries()) if (keys.every(key => row[key] != null)) {
      const natural = JSON.stringify([index, ...keys.map(key => row[key])]);
      if (naturalKeys.has(natural)) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'An import batch assigns multiple internal IDs to one source identity. No records were written.', { table: item.table });
      naturalKeys.add(natural);
    }
  }
  const batch: ImportBatch = { version: 1, id: item.id, snapshotId: item.snapshotId, target: item.target as ImportTarget, table: item.table, contentHash: item.contentHash, rows: records };
  if (new TextEncoder().encode(JSON.stringify(batch)).byteLength > MAX_IMPORT_BYTES) throw new AppError(413, 'IMPORT_TOO_LARGE', 'Split this import into smaller bounded batches.');
  return batch;
}

export async function importHash(rows: ImportRow[]): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Call only behind operator authorization. All account tables and arbitrary SQL are excluded. */
export async function applyImportBatch(catalogue: CatalogueDatabase, targetDb: CatalogueDatabase, input: unknown, budget: SyncBudget = DEFAULT_SYNC_BUDGET) {
  const batch = validateImportBatch(input);
  if (await importHash(batch.rows) !== batch.contentHash) throw new AppError(400, 'IMPORT_CHECKSUM_MISMATCH', 'The batch checksum does not match its rows.');
  const existing = await targetDb.prepare('SELECT content_hash AS hash,row_count AS rowCount FROM cloud_import_receipts WHERE id=?').bind(batch.id).first<{ hash: string; rowCount: number }>();
  if (existing) {
    if (existing.hash !== batch.contentHash) throw new AppError(409, 'IMPORT_CONFLICT', 'This batch ID was previously imported with different content.');
    return { status: 'already_imported' as const, id: batch.id, rows: existing.rowCount, estimatedWrites: 0 };
  }
  const spec = IMPORT_TABLES[batch.table];
  const estimatedWrites = estimateImportWrites(spec, batch.rows.length);
  // Only a completed receipt makes replay free. Each uncertain/failed mutation
  // attempt retains its own conservative charge, including concurrent losers.
  const reservation = await reserveWriteBudget(catalogue, `import:${batch.target}:${batch.id}:${crypto.randomUUID()}`, estimatedWrites, 0, budget);
  // The hosted free tier permits only 50 queries per invocation and 100 bindings per query.
  // A checked JSON parameter supplies each same-column group to a normalized INSERT-SELECT.
  const conflict = identityConflictSql(batch.table); const serialized = JSON.stringify(batch.rows);
  // The receipt is the first statement in the same transaction as the data.
  // Its NOT NULL checksum rejects identity drift atomically, including a race
  // after any earlier read. A duplicate receipt fails before touching rows.
  const receipt = conflict
    ? targetDb.prepare(`INSERT INTO cloud_import_receipts(id,snapshot_id,table_name,content_hash,row_count,estimated_writes,imported_at) VALUES(?,?,?,CASE WHEN EXISTS(${conflict}) THEN NULL ELSE ? END,?,?,?)`).bind(batch.id, batch.snapshotId, batch.table, serialized, batch.contentHash, batch.rows.length, estimatedWrites, new Date().toISOString())
    : targetDb.prepare('INSERT INTO cloud_import_receipts(id,snapshot_id,table_name,content_hash,row_count,estimated_writes,imported_at) VALUES(?,?,?,?,?,?,?)').bind(batch.id, batch.snapshotId, batch.table, batch.contentHash, batch.rows.length, estimatedWrites, new Date().toISOString());
  const statements = [receipt, ...groupImportRows(batch.rows).map(group => targetDb.prepare(upsertJsonRowsSql(batch.table, group.columns)).bind(JSON.stringify(group.rows)))];
  // Receipt and rows commit together. A duplicate concurrent batch rolls back in full.
  let measuredWrites: number | null = null; let measuredReads: number | null = null;
  try {
    const results = await targetDb.batch(statements);
    if (results.every(result => Number.isSafeInteger(result.meta.rows_written))) measuredWrites = results.reduce((sum, result) => sum + result.meta.rows_written, 0);
    if (results.every(result => Number.isSafeInteger(result.meta.rows_read))) measuredReads = results.reduce((sum, result) => sum + result.meta.rows_read, 0);
  }
  catch (error) {
    const receipt = await targetDb.prepare('SELECT content_hash AS hash FROM cloud_import_receipts WHERE id=?').bind(batch.id).first<{ hash: string }>();
    if (receipt?.hash === batch.contentHash) return { status: 'already_imported' as const, id: batch.id, rows: batch.rows.length, estimatedWrites };
    if (conflict && await targetDb.prepare(conflict).bind(serialized).first()) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'An import ID conflicts with an existing source or parent identity. The complete batch and its receipt were rolled back; no existing record was retargeted.', { table: batch.table });
    throw error;
  }
  if (measuredWrites != null) await settleWriteBudget(catalogue, reservation.id, measuredWrites);
  return { status: 'imported' as const, id: batch.id, rows: batch.rows.length, estimatedWrites, measuredWrites, measuredReads };
}
