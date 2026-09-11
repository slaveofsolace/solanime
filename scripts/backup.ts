import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { backup } from 'node:sqlite';
import { currentSchemaVersion, migrate, openDatabase } from '../server/db.ts';

const outputDirectory = resolve(process.argv[2] ?? 'data/backups');
mkdirSync(outputDirectory, { recursive: true });
const path = resolve(
  outputDirectory,
  `solanime-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
);
const db = openDatabase();
try {
  migrate(db);
  await backup(db, path);
  console.log(JSON.stringify({ path, schemaVersion: currentSchemaVersion(db) }, null, 2));
} finally {
  db.close();
}
