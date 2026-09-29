import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { bundledSchemaVersions, currentSchemaVersion, openDatabase, type SqliteDatabase } from '../../server/db.ts';
import { captureCoverage } from '../../server/ingestion/anikoto.ts';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const count = (db: SqliteDatabase, query: string) => Number(db.prepare(query).get()?.count ?? 0);
const coverageHash = (db: SqliteDatabase, maximumId: number) => hash(JSON.stringify(db.prepare('SELECT * FROM coverage_snapshots WHERE id<=? ORDER BY id').all(maximumId)));
const taskHash = (db: SqliteDatabase) => hash(JSON.stringify(db.prepare('SELECT * FROM crawl_tasks ORDER BY id').all()));

export function captureReleaseCoverage(db: SqliteDatabase, runId: number, now = new Date()) {
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Error('Choose a valid existing run ID.');
  const active = db.prepare("SELECT id FROM crawl_runs WHERE worker_id IS NOT NULL AND worker_heartbeat_at>? LIMIT 1").get(new Date(now.getTime() - 90_000).toISOString());
  if (active) throw new Error('A local ingestion worker lease is active. Let the operator pause it before creating a release snapshot.');
  const run = db.prepare('SELECT id,checkpoint_json FROM crawl_runs WHERE id=?').get(runId);
  if (!run) throw new Error('The selected import run does not exist.');
  const old = db.prepare('SELECT COALESCE(MAX(id),0) AS id,COUNT(*) AS count FROM coverage_snapshots').get() as { id: number; count: number };
  const oldHistoryHash = coverageHash(db, old.id);
  const sourceMappings = count(db, "SELECT COUNT(*) AS count FROM episode_provider_mappings WHERE mapping_origin='native'");
  const externalMappings = count(db, "SELECT COUNT(*) AS count FROM episode_provider_mappings WHERE mapping_origin='external_mapper'");
  const verifiedMappings = count(db, 'SELECT COUNT(*) AS count FROM episode_provider_mappings WHERE last_playback_verification_at IS NOT NULL');
  const incomplete = count(db, "SELECT COUNT(*) AS count FROM crawl_tasks WHERE status IN ('pending','running','retry')");
  const scope = `Local pre-final-verification snapshot of the reconstructed public discovery union; ${sourceMappings} original source mappings plus ${externalMappings} approved external native mappings. ${incomplete} source tasks remain unfinished. Playback evidence applies to ${verifiedMappings} individually recorded mappings only; not a full provider/library playback claim, private database claim, or current hosted coverage.`;
  captureCoverage(db, runId, scope);
  if (coverageHash(db, old.id) !== oldHistoryHash) throw new Error('Historical coverage changed unexpectedly.');
  const latest = db.prepare('SELECT * FROM coverage_snapshots ORDER BY id DESC LIMIT 1').get();
  return { previousSnapshots: old.count, preservedHistorySha256: oldHistoryHash, coverage: latest, sourceMappings, externalMappings, playbackVerifiedMappings: verifiedMappings };
}

function validate(db: SqliteDatabase) {
  const integrity = db.prepare('PRAGMA integrity_check').all();
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => Number(row.version));
  if (JSON.stringify(versions) !== JSON.stringify(bundledSchemaVersions())) throw new Error('Apply all bundled local migrations deliberately before making this release snapshot.');
  if (integrity.some(row => row.integrity_check !== 'ok') || foreignKeys.length) throw new Error('Database integrity validation failed.');
  const columns = db.prepare('PRAGMA table_info(native_resources)').all();
  if (!columns.some(row => row.name === 'content_sha1')) throw new Error('The reviewed native-content hash migration is missing.');
  if (count(db, "SELECT COUNT(*) AS count FROM native_resources WHERE provider_id='wikimedia-commons' AND enabled=1 AND (content_sha1 IS NULL OR length(content_sha1)<>40 OR content_sha1 GLOB '*[^a-f0-9]*')")) throw new Error('An enabled Commons approval lacks its reviewed content hash.');
  return { integrity: 'ok', foreignKeyViolations: 0, schemaVersion: currentSchemaVersion(db), versions };
}

function inventory(db: SqliteDatabase) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return Object.fromEntries(tables.map(row => [String(row.name), count(db, `SELECT COUNT(*) AS count FROM "${String(row.name).replaceAll('"', '""')}"`)]));
}

async function main() {
  const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const sourceArgument = option('source-db'), outputArgument = option('out');
  if (!sourceArgument || !outputArgument) throw new Error('Supply explicit --source-db and fresh private --out paths.');
  const sourcePath = resolve(sourceArgument), output = resolve(outputArgument);
  if (existsSync(output)) throw new Error('Choose a new output directory; historical artifacts are never overwritten.');
  const runId = Number(option('run-id'));
  const label = 'pre-final-verification';
  const inspected = new DatabaseSync(sourcePath, { readOnly: true, enableForeignKeyConstraints: true });
  try { validate(inspected); } finally { inspected.close(); }
  mkdirSync(output, { recursive: true });
  const backupPath = join(output, 'solanime-pre-final-verification.sqlite');
  const restoredPath = join(output, 'restore-test.sqlite');
  const source = openDatabase(sourcePath);
  let coverage: ReturnType<typeof captureReleaseCoverage>;
  let state: ReturnType<typeof inventory>;
  let sourceTaskHash: string;
  let verification: ReturnType<typeof validate>;
  let capturedAt: string;
  try {
    source.exec('BEGIN IMMEDIATE');
    try {
      coverage = captureReleaseCoverage(source, runId);
      source.exec('COMMIT');
    } catch (error) { source.exec('ROLLBACK'); throw error; }
    source.exec('BEGIN');
    try {
      // A read transaction pins the backup and the manifest to the same source view.
      state = inventory(source);
      sourceTaskHash = taskHash(source);
      verification = validate(source);
      capturedAt = new Date().toISOString();
      await backup(source, backupPath);
      source.exec('COMMIT');
    } catch (error) { source.exec('ROLLBACK'); throw error; }
  } finally { source.close(); }
  const backupDb = new DatabaseSync(backupPath, { readOnly: true });
  try {
    validate(backupDb);
    if (JSON.stringify(inventory(backupDb)) !== JSON.stringify(state) || taskHash(backupDb) !== sourceTaskHash) throw new Error('Backup does not match the pinned source snapshot.');
  } finally { backupDb.close(); }
  const childEnvironment = { ...process.env, SOLANIME_DB_PATH: restoredPath };
  const run = (script: string, args: string[], logName: string) => {
    const result = execFileSync(process.execPath, ['--import', 'tsx', script, ...args], { cwd: resolve(import.meta.dirname, '../..'), env: childEnvironment, encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    writeFileSync(join(output, logName), result, { mode: 0o600 });
    return result;
  };
  run('scripts/restore.ts', [backupPath], 'restore.log');
  const restoreVerification = JSON.parse(run('scripts/verify-database.ts', [], 'restore-integrity.json')) as { ok: boolean };
  if (!restoreVerification.ok) throw new Error('The restored database failed structural checks.');
  const restored = new DatabaseSync(restoredPath, { readOnly: true });
  try {
    validate(restored);
    if (JSON.stringify(inventory(restored)) !== JSON.stringify(state) || taskHash(restored) !== sourceTaskHash) throw new Error('Restored counts or durable tasks differ from the backup.');
  } finally { restored.close(); }
  const manifest = {
    version: 1, label, capturedAt, sourcePath,
    backup: { file: 'solanime-pre-final-verification.sqlite', bytes: statSync(backupPath).size, sha256: hash(readFileSync(backupPath)) },
    verification, counts: state, ...coverage,
    durableTasksSha256: sourceTaskHash,
    restoreTest: { ok: true, file: 'restore-test.sqlite', integrityReport: 'restore-integrity.json', byteSha256: hash(readFileSync(restoredPath)), taskAndTableCountsMatch: true },
    scope: 'Private catalogue backup including evidence recorded before capture. Later production/browser observations are not claimed. No account database or episode files are included. The cloud pinned import and its cursor remain separate and unchanged.',
    commands: {
      capture: 'node --import tsx scripts/cloud-data/release-snapshot.ts --source-db=<source.sqlite> --run-id=<existing-run> --out=<new-private-directory>',
      restore: 'Set SOLANIME_DB_PATH to a new target path, then node --import tsx scripts/restore.ts <backup.sqlite>',
      verify: 'Set SOLANIME_DB_PATH to the restored target, then node --import tsx scripts/verify-database.ts',
    },
  };
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ output, ...manifest }, null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
