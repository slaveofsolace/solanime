import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

const raw = option('db');
if (!raw) throw new Error('Use --db=<checkpointed SQLite database>.');
const path = resolve(raw);
if (!existsSync(path)) throw new Error('Catalogue database does not exist.');
if (existsSync(`${path}-wal`) && statSync(`${path}-wal`).size > 0)
  throw new Error('Catalogue database has a nonempty WAL; checkpoint it before auditing.');

const digest = createHash('sha256');
for await (const chunk of createReadStream(path)) digest.update(chunk);
const db = new DatabaseSync(path, { readOnly: true });
try {
  const one = (sql: string) => db.prepare(sql).get() as Record<string, unknown>;
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  const sources = db.prepare(
    `SELECT source,COUNT(*) AS titles,
      (SELECT COUNT(*) FROM episodes e JOIN titles owner ON owner.id=e.title_id WHERE owner.source=t.source) AS episodes,
      (SELECT COUNT(*) FROM episode_versions v JOIN episodes e ON e.id=v.episode_id JOIN titles owner ON owner.id=e.title_id WHERE owner.source=t.source) AS versions,
      (SELECT COUNT(*) FROM episode_provider_mappings m JOIN episode_versions v ON v.id=m.version_id JOIN episodes e ON e.id=v.episode_id JOIN titles owner ON owner.id=e.title_id WHERE owner.source=t.source) AS mappings
     FROM titles t GROUP BY source ORDER BY source`,
  ).all();
  console.log(JSON.stringify({
    path,
    bytes: statSync(path).size,
    sha256: digest.digest('hex'),
    integrity: one('PRAGMA integrity_check').integrity_check,
    foreignKeyViolations: foreignKeys.length,
    schemaVersion: one('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').version,
    totals: one(`SELECT
      (SELECT COUNT(*) FROM titles) AS titles,
      (SELECT COUNT(*) FROM episodes) AS episodes,
      (SELECT COUNT(*) FROM episode_versions) AS versions,
      (SELECT COUNT(*) FROM episode_provider_mappings) AS mappings`),
    sources,
    tvmazeSync: db.prepare(
      "SELECT next_page AS nextPage,status,pages_imported AS pagesImported,titles_imported AS titlesImported,episodes_imported AS episodesImported,last_successful_import_at AS lastSuccessfulImportAt,last_error_code AS lastErrorCode FROM external_catalogue_sync WHERE source='tvmaze'",
    ).get() ?? null,
  }, null, 2));
} finally {
  db.close();
}
