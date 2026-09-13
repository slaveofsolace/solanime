import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '../..');
const dbPath = process.argv[2] ?? resolve(root, 'data/solanime.sqlite');
const database = new DatabaseSync(dbPath, { readOnly: true });
try {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
  console.log(JSON.stringify({ database: dbPath, bytes: statSync(dbPath).size,
    integrity: database.prepare('PRAGMA integrity_check').all(),
    foreignKeys: database.prepare('PRAGMA foreign_key_check').all(),
    counts: Object.fromEntries(tables.map(({ name }) => [name, database.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get()?.count])),
    taskStates: database.prepare('SELECT task_type,status,COUNT(*) AS count FROM crawl_tasks GROUP BY task_type,status ORDER BY task_type,status').all(),
  }, null, 2));
  if (process.argv.includes('--public-domain-leads')) {
    console.log(JSON.stringify(database.prepare("SELECT t.id,t.source_id,t.slug,t.name,t.description,t.release_year,(SELECT group_concat(alias,' | ') FROM title_aliases a WHERE a.title_id=t.id) AS aliases FROM titles t WHERE t.name LIKE '%Namakura%' OR t.name LIKE '%Katsudou%' OR t.name LIKE '%Urashima%' OR t.name LIKE '%Momotaro%' OR EXISTS (SELECT 1 FROM title_aliases a WHERE a.title_id=t.id AND (a.alias LIKE '%Namakura%' OR a.alias LIKE '%Katsudou%' OR a.alias LIKE '%Urashima%' OR a.alias LIKE '%Momotaro%'))").all(), null, 2));
  }
  if (process.argv.includes('--dull-sword')) {
    console.log(JSON.stringify({ title: database.prepare('SELECT * FROM titles WHERE id=3881').get(), aliases: database.prepare('SELECT * FROM title_aliases WHERE title_id=3881').all(), episodes: database.prepare('SELECT * FROM episodes WHERE title_id=3881').all(), versions: database.prepare('SELECT v.* FROM episode_versions v JOIN episodes e ON e.id=v.episode_id WHERE e.title_id=3881').all(), mappings: database.prepare('SELECT m.id,m.version_id,m.provider_id,m.availability_state,m.unavailable_reason FROM episode_provider_mappings m JOIN episode_versions v ON v.id=m.version_id JOIN episodes e ON e.id=v.episode_id WHERE e.title_id=3881').all() }, null, 2));
  }
  if (process.argv.includes('--source-refresh-shapes')) console.log(JSON.stringify({ largestInventories: database.prepare('SELECT t.id,t.name,COUNT(*) AS episodes FROM episodes e JOIN titles t ON t.id=e.title_id GROUP BY t.id ORDER BY episodes DESC LIMIT 5').all(), sitemapTasks: database.prepare("SELECT payload_json FROM crawl_tasks WHERE task_type='sitemap_page' LIMIT 3").all() }, null, 2));
  if (process.argv.includes('--operations')) console.log(JSON.stringify({
    observedAt: new Date().toISOString(),
    migrations: database.prepare('SELECT version,name,applied_at FROM schema_migrations ORDER BY version').all(),
    runs: database.prepare('SELECT id,status,worker_id,worker_heartbeat_at,started_at,updated_at FROM crawl_runs ORDER BY id').all(),
    activeTasks: database.prepare("SELECT id,run_id,task_type,status,attempt_count,claimed_at,claimed_by,lease_expires_at,updated_at FROM crawl_tasks WHERE status='running' ORDER BY id").all(),
    mappingOrigins: database.prepare('SELECT mapping_origin,COUNT(*) AS count FROM episode_provider_mappings GROUP BY mapping_origin ORDER BY mapping_origin').all(),
    lastCoverage: database.prepare('SELECT * FROM coverage_snapshots ORDER BY id DESC LIMIT 1').get(),
  }, null, 2));
} finally { database.close(); }
if (process.argv.includes('--research-shapes')) {
  const names = ['entries','sites','providers','relationships','domains','endpoints','repositories','normalization-aliases','supplemental-bindings'];
  for (const name of names) {
    const value: unknown = JSON.parse(readFileSync(resolve(root, `data-dump/indexes/${name}.json`), 'utf8'));
    console.log(JSON.stringify({ index: name, shape: Array.isArray(value) ? { count: value.length, sample: value[0] } : value }, null, 2));
  }
  const audit: Record<string, unknown> = JSON.parse(gunzipSync(readFileSync(resolve(root, 'data-dump/curated/source-audit.json.gz'))).toString('utf8'));
  console.log(JSON.stringify({ audit: Object.fromEntries(Object.entries(audit).map(([key, value]) => [key, Array.isArray(value) ? { count: value.length, sample: value[0] } : value])) }, null, 2));
}
