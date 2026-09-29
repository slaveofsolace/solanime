import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase, projectRoot } from '../server/db.ts';
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 10))
  throw new Error('Node.js 24.10 or newer is required. Use the Node 24 LTS release.');
const path = resolve(projectRoot, process.env.SOLANIME_DB_PATH || 'data/solanime.sqlite');
if (!existsSync(path))
  throw new Error(
    `Database not found at ${path}. Run git lfs pull, or extract the complete source package. No empty replacement was created.`,
  );
if (statSync(path).size === 0)
  throw new Error('The database is empty. Restore a verified backup before starting.');
const db = openDatabase(path);
try {
  const integrity = db.prepare('PRAGMA quick_check').get() as { quick_check: string };
  if (integrity.quick_check !== 'ok')
    throw new Error(`Database integrity check failed: ${integrity.quick_check}`);
  const counts = db
    .prepare(
      'SELECT (SELECT COUNT(*) FROM titles) AS titles, (SELECT COUNT(*) FROM episodes) AS episodes, (SELECT COUNT(*) FROM episode_provider_mappings) AS mappings',
    )
    .get();
  console.log(
    JSON.stringify(
      {
        node: process.versions.node,
        database: path,
        integrity: integrity.quick_check,
        counts,
        build: existsSync(resolve(projectRoot, 'dist/index.html'))
          ? 'present'
          : 'Run pnpm build before pnpm start',
        admin: process.env.SOLANIME_ADMIN_TOKEN ? 'configured' : 'disabled',
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
