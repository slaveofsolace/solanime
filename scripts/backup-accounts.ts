import { backup } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { openAccountsDatabase } from '../server/accounts/database.ts';
import { projectRoot } from '../server/db.ts';
const dir = resolve(projectRoot, 'data/private/backups');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const path = resolve(dir, `accounts-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
const db = openAccountsDatabase();
try {
  await backup(db, path);
  chmodSync(path, 0o600);
  console.log(`Private account backup: ${path}\nKeep this out of source ZIPs and public hosting.`);
} finally {
  db.close();
}
