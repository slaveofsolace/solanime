import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type SqliteDatabase = DatabaseSync;

function isoNow(): string {
  return new Date().toISOString();
}

export function openDatabase(path = process.env.SOLANIME_DB_PATH ?? resolve('data', 'solanime.sqlite')): SqliteDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  return db;
}

export function migrate(db: SqliteDatabase, migrationsDir = resolve('migrations')): void {
  const hasMigrations = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  const applied = new Set<number>();
  if (hasMigrations) {
    for (const row of db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>) applied.add(row.version);
  }

  const files = readdirSync(migrationsDir)
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    const version = Number(file.split('_', 1)[0]);
    if (applied.has(version)) continue;
    const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT OR REPLACE INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)')
        .run(version, file, isoNow());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function currentSchemaVersion(db: SqliteDatabase): number {
  const row = db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get() as { version: number };
  return row.version;
}

export function bundledSchemaVersions(migrationsDir = resolve('migrations')): number[] {
  return readdirSync(migrationsDir)
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .map((file) => Number(file.split('_', 1)[0]))
    .sort((a, b) => a - b);
}
