import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { bundledSchemaVersions } from '../server/db.ts';

const argumentsWithoutSeparator = process.argv.slice(2).filter((argument) => argument !== '--');
const sourceArgument = argumentsWithoutSeparator.find((argument) => !argument.startsWith('--'));
const sourcePath = sourceArgument ? resolve(sourceArgument) : '';
const targetPath = resolve(process.env.SOLANIME_DB_PATH ?? 'data/solanime.sqlite');
const replace = argumentsWithoutSeparator.includes('--replace');
if (!sourcePath) throw new Error('Usage: pnpm tsx scripts/restore.ts <backup.sqlite> [--replace]');
if (!existsSync(sourcePath)) throw new Error(`Backup does not exist: ${sourcePath}`);
if (sourcePath.toLowerCase() === targetPath.toLowerCase())
  throw new Error('Backup and target paths must differ.');

const bundledVersions = bundledSchemaVersions();
const maximumSupportedSchema = bundledVersions.at(-1) ?? 0;

function validate(path: string): number {
  const database = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    const integrity = database.prepare('PRAGMA integrity_check').get() as {
      integrity_check: string;
    };
    if (integrity.integrity_check !== 'ok')
      throw new Error(`Backup integrity check failed: ${integrity.integrity_check}`);
    const hasMigrations = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .get();
    if (!hasMigrations)
      throw new Error('Backup does not contain a Sol Anime schema migration ledger.');
    const applied = (
      database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
        version: number;
      }>
    ).map((row) => row.version);
    const schemaVersion = applied.at(-1) ?? 0;
    if (schemaVersion < 1) throw new Error('Backup does not contain a supported Sol Anime schema.');
    if (schemaVersion > maximumSupportedSchema)
      throw new Error(
        `Backup schema ${schemaVersion} is newer than the supported schema ${maximumSupportedSchema}.`,
      );
    const required = bundledVersions.filter((version) => version <= schemaVersion);
    if (required.some((version) => !applied.includes(version)))
      throw new Error(`Backup schema ${schemaVersion} has an incomplete migration ledger.`);
    const foreignKeyFailures = database.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyFailures.length > 0)
      throw new Error(
        `Backup foreign-key check failed with ${foreignKeyFailures.length} violation(s).`,
      );
    return schemaVersion;
  } finally {
    database.close();
  }
}

const source = new DatabaseSync(sourcePath, { readOnly: true, enableForeignKeyConstraints: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const stagedPath = `${targetPath}.restore-stage-${stamp}.sqlite`;
try {
  const schemaVersion = validate(sourcePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  await backup(source, stagedPath);
  const stagedSchemaVersion = validate(stagedPath);
  if (stagedSchemaVersion !== schemaVersion)
    throw new Error('Staged restore schema does not match the validated source.');
  let preserved = '';
  const preservedSidecars: Array<{ from: string; to: string }> = [];
  if (existsSync(targetPath)) {
    if (!replace)
      throw new Error(
        `Target already exists: ${targetPath}. Stop the API/import worker, then pass --replace to preserve it as a pre-restore backup and restore.`,
      );
    preserved = `${targetPath}.pre-restore-${stamp}.bak`;
    renameSync(targetPath, preserved);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${targetPath}${suffix}`;
      if (existsSync(sidecar)) {
        const preservedSidecar = `${preserved}${suffix}`;
        renameSync(sidecar, preservedSidecar);
        preservedSidecars.push({ from: preservedSidecar, to: sidecar });
      }
    }
    console.log(JSON.stringify({ preservedCurrentDatabase: preserved }));
  }
  try {
    renameSync(stagedPath, targetPath);
  } catch (error) {
    if (preserved && existsSync(preserved) && !existsSync(targetPath)) {
      renameSync(preserved, targetPath);
      for (const sidecar of preservedSidecars)
        if (existsSync(sidecar.from)) renameSync(sidecar.from, sidecar.to);
    }
    throw error;
  }
  console.log(JSON.stringify({ restoredFrom: sourcePath, targetPath, schemaVersion }, null, 2));
} finally {
  source.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const stagedArtifact = `${stagedPath}${suffix}`;
    if (existsSync(stagedArtifact)) rmSync(stagedArtifact, { force: true });
  }
}
