import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';

type ObjectRecord = Record<string, unknown>;
const object = (value: unknown): ObjectRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectRecord : { value };
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).filter(entry => !(entry.isDirectory() && entry.name.startsWith('.')) && !['__pycache__', 'node_modules'].includes(entry.name)).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);

/** Local normalization never performs network requests or changes the supplied research snapshot. */
export function buildResearchDatabase(dumpRoot: string, destination: string, migrationPath: string) {
  mkdirSync(dirname(destination), { recursive: true });
  const database = new DatabaseSync(destination, { enableForeignKeyConstraints: true });
  database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='research_records'").get();
  if (!exists) database.exec(readFileSync(migrationPath, 'utf8'));
  const snapshot = object(readJson(join(dumpRoot, 'SUMMARY.json')));
  const observedAt = text(snapshot.snapshot_at, 'unknown');
  // A deterministic timestamp makes repeat normalization byte-stable at the row level.
  const importedAt = observedAt;
  const coreKinds: Record<string, string> = { entries: 'listing', sites: 'site', providers: 'provider', domains: 'domain', endpoints: 'endpoint', repositories: 'repository' };
  const insertRecord = database.prepare('INSERT INTO research_records(id,collection,source_id,name,kind,url,research_status,evidence_class,observation_date,canonical_id,provenance_path,record_json,record_hash,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,research_status=excluded.research_status,evidence_class=excluded.evidence_class,observation_date=excluded.observation_date,canonical_id=excluded.canonical_id,record_json=excluded.record_json,record_hash=excluded.record_hash,imported_at=excluded.imported_at');
  const insertFragment = database.prepare('INSERT INTO research_record_fragments(record_id,fragment_index,content) VALUES(?,?,?) ON CONFLICT(record_id,fragment_index) DO UPDATE SET content=excluded.content');
  const insertCategory = database.prepare('INSERT INTO research_categories(record_id,category) VALUES(?,?) ON CONFLICT DO NOTHING');
  const insertRelationship = database.prepare('INSERT INTO research_relationships(id,source_id,target_id,relationship_type,confidence,verification_scope,source_url,observation_date,evidence_json,provenance_path) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET evidence_json=excluded.evidence_json,confidence=excluded.confidence,verification_scope=excluded.verification_scope,observation_date=excluded.observation_date');
  function putRecord(collection: string, sourceId: string, data: unknown, path: string, kind = 'evidence', id = `${collection}:${sourceId}`, canonicalId: string | null = null) {
    const row = object(data); const raw = JSON.stringify(data);
    const fragments: string[] = [];
    // Bound by UTF-8 bytes after encoding; code-point splitting avoids broken surrogate pairs.
    if (Buffer.byteLength(raw) > 26_000) {
      let fragment = ''; let bytes = 0;
      for (const char of raw) { const length = Buffer.byteLength(char); if (bytes + length > 24_000) { fragments.push(fragment); fragment = ''; bytes = 0; } fragment += char; bytes += length; }
      if (fragment) fragments.push(fragment);
    }
    const value = fragments.length ? JSON.stringify({ fragmented: true, fragments: fragments.length, sha256: hash(raw), byteLength: Buffer.byteLength(raw), provenancePath: path }) : raw;
    const url = text(row.url) || text(row.source_url) || (Array.isArray(row.urls) ? text(row.urls[0]) : '') || null;
    insertRecord.run(id, collection, sourceId, text(row.name) || text(row.hostname) || text(row.label) || url || sourceId, kind, url, text(row.research_status) || text(row.status) || text(row.outcome) || 'unverified', text(row.evidence_type) || text(row.reference_class) || text(row.verification_scope) || 'public_reference', text(row.observed_at) || text(row.observed_on) || observedAt, canonicalId, path, value, hash(raw), importedAt);
    fragments.forEach((content, index) => insertFragment.run(id, index, content));
    const categories = row.categories ?? row.category;
    if (Array.isArray(categories)) {
      const values = categories.flatMap(value => Array.isArray(value) ? [value.filter(value => typeof value === 'string').join(' / ')] : typeof value === 'string' ? [value] : []);
      for (const category of values) if (category) insertCategory.run(id, category);
    } else if (typeof categories === 'string') insertCategory.run(id, categories);
  }
  const aliases: Array<ObjectRecord> = (readJson(join(dumpRoot, 'indexes/normalization-aliases.json')) as unknown[]).map(object);
  const aliasMap = new Map(aliases.map(row => [text(row.id), text(row.canonical_id)]));
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const file of readdirSync(join(dumpRoot, 'indexes')).filter(file => file.endsWith('.json')).sort()) {
      const name = file.slice(0, -5); const path = `indexes/${file}`;
      const data = readJson(join(dumpRoot, path));
      const items = Array.isArray(data) ? data : [data];
      items.forEach((value, index) => {
        const row = object(value); const sourceId = text(row.id) || String(index);
        if (name === 'relationships') {
          insertRelationship.run(sourceId, text(row.source), text(row.target), text(row.type, 'unknown'), text(row.confidence, 'unknown'), text(row.verification_scope, 'unknown'), text(row.source_url) || null, text(row.observed_at) || observedAt, JSON.stringify(row), path);
        } else if (name === 'normalization-aliases') {
          database.prepare('INSERT INTO research_aliases(alias_id,canonical_id,scope,provenance_path) VALUES(?,?,?,?) ON CONFLICT(alias_id) DO UPDATE SET canonical_id=excluded.canonical_id').run(sourceId, text(row.canonical_id), 'bulk_normalization_not_ownership', path);
        } else {
          const core = coreKinds[name];
          putRecord(name, sourceId, value, path, core ?? 'evidence', core ? sourceId : `${name}:${sourceId}`, aliasMap.get(sourceId) ?? null);
        }
      });
    }
    const audit = object(JSON.parse(gunzipSync(readFileSync(join(dumpRoot, 'curated/source-audit.json.gz'))).toString('utf8')));
    const bindings = readJson(join(dumpRoot, 'indexes/supplemental-bindings.json')) as ObjectRecord[];
    const canonicalAuditIds = new Map<string, string>();
    for (const binding of bindings) {
      const ids = Array.isArray(binding.site_ids) && binding.site_ids.length === 1 ? binding.site_ids : Array.isArray(binding.repository_ids) && binding.repository_ids.length === 1 ? binding.repository_ids : [];
      if (ids.length === 1) canonicalAuditIds.set(text(binding.audit_entity_id), text(ids[0]));
    }
    for (const [collection, values] of Object.entries(audit)) {
      if (!Array.isArray(values)) continue;
      values.forEach((value, index) => {
        const row = object(value); const sourceId = text(row.id) || String(index); const id = `supplemental-${collection}:${sourceId}`;
        if (collection === 'relationships') {
          const source = canonicalAuditIds.get(text(row.source)) ?? `supplemental-entities:${text(row.source)}`;
          const target = canonicalAuditIds.get(text(row.target)) ?? `supplemental-entities:${text(row.target)}`;
          insertRelationship.run(id, source, target, text(row.relation, 'unknown'), text(row.confidence, 'unknown'), text(row.scope, 'unknown'), null, text(audit.observed_on) || observedAt, JSON.stringify(row), 'curated/source-audit.json.gz');
        } else {
          putRecord(`supplemental-${collection}`, sourceId, value, 'curated/source-audit.json.gz', collection === 'entities' ? 'supplemental_entity' : 'evidence', id, canonicalAuditIds.get(sourceId) ?? null);
          if (collection === 'entities' && canonicalAuditIds.has(sourceId)) database.prepare('INSERT INTO research_aliases(alias_id,canonical_id,scope,provenance_path) VALUES(?,?,?,?) ON CONFLICT(alias_id) DO UPDATE SET canonical_id=excluded.canonical_id').run(id, canonicalAuditIds.get(sourceId)!, 'exact_url_or_hostname_reference_not_common_ownership', 'indexes/supplemental-bindings.json');
        }
      });
    }
    // Detailed per-resource metadata and reports remain addressable alongside canonical indexes.
    const files = walk(dumpRoot);
    for (const file of files) {
      const path = relative(dumpRoot, file).replaceAll('\\', '/'); const bytes = readFileSync(file);
      database.prepare('INSERT INTO research_documents(path,sha256,byte_length,media_type,imported_at) VALUES(?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET sha256=excluded.sha256,byte_length=excluded.byte_length,imported_at=excluded.imported_at').run(path, hash(bytes), statSync(file).size, path.endsWith('.json') ? 'application/json' : path.endsWith('.md') ? 'text/markdown' : path.endsWith('.gz') ? 'application/gzip' : 'text/plain', importedAt);
      if (path.startsWith('indexes/') || !path.endsWith('.json')) continue;
      const collection = path.startsWith('sites/') ? 'site-evidence' : path.startsWith('reports/') ? 'report' : 'source-document';
      const canonicalId = path.startsWith('sites/') ? path.split('/')[1] : null;
      putRecord(collection, path, JSON.parse(bytes.toString('utf8')), path, 'evidence', `${collection}:${path}`, canonicalId);
    }
    const counts = {
      listingOccurrences: Number(database.prepare("SELECT COUNT(*) AS count FROM research_records WHERE collection='entries'").get()?.count),
      sites: Number(database.prepare("SELECT COUNT(*) AS count FROM research_records WHERE collection='sites'").get()?.count),
      providerReferences: Number(database.prepare("SELECT COUNT(*) AS count FROM research_records WHERE collection='providers'").get()?.count),
      records: Number(database.prepare('SELECT COUNT(*) AS count FROM research_records').get()?.count),
      relationships: Number(database.prepare('SELECT COUNT(*) AS count FROM research_relationships').get()?.count),
      evidenceFiles: files.length,
      canonicalAliases: Number(database.prepare('SELECT COUNT(*) AS count FROM research_aliases').get()?.count),
      verifiedPlaybackChains: 0,
      scope: 'Counts by collection only. Supplemental evidence is joined by aliases and is not added to the 946-listing denominator.',
    };
    const contentHash = hash(JSON.stringify(database.prepare('SELECT path,sha256 FROM research_documents ORDER BY path').all()));
    database.prepare('INSERT INTO cloud_snapshot_sources(id,source,content_hash,counts_json,observation_date,imported_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content_hash=excluded.content_hash,counts_json=excluded.counts_json').run('fmhy-3e53fb21443de076c4df59acc149c648583b6a24', 'FMHY video public research', contentHash, JSON.stringify(counts), observedAt, importedAt);
    database.exec('COMMIT');
    const integrity = database.prepare('PRAGMA integrity_check').all();
    const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || foreignKeys.length) throw new Error('Normalized research integrity check failed.');
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return { database: destination, contentHash, counts, integrity, foreignKeys };
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  } finally { database.close(); }
}
