export type ImportTarget = 'catalogue' | 'research';
export type ImportCell = string | number | null;
export type ImportRow = Record<string, ImportCell>;
export interface ImportTable { target: ImportTarget | 'both'; columns: string[]; primaryKey: string[]; indexes: number; preserve?: string[]; identity?: string[]; uniqueIdentity?: boolean; uniqueKeys?: string[][]; }
const table = (target: ImportTarget | 'both', columns: string, key: string, indexes: number, preserve = ''): ImportTable => ({ target, columns: columns.split(' '), primaryKey: key.split(' '), indexes, preserve: preserve ? preserve.split(' ') : [] });

/** Fixed schema allowlist. Neither SQL text nor arbitrary destinations are accepted by import APIs. */
export const IMPORT_TABLES: Record<string, ImportTable> = {
  titles: table('catalogue', 'id source source_id slug canonical_url name description format release_year status artwork_url artwork_origin artwork_reuse_status availability_state first_seen_at last_seen_at last_successful_import_at created_at updated_at', 'id', 7, 'first_seen_at created_at'),
  genres: table('catalogue', 'id slug name', 'id', 2),
  providers: table('catalogue', 'id label identity_state playback_type adapter_state hostname capabilities_json observed_limitation evidence_class first_seen_at last_seen_at updated_at', 'id', 2, 'first_seen_at'),
  title_aliases: table('catalogue', 'id title_id alias language alias_type', 'id', 2),
  title_genres: table('catalogue', 'title_id genre_id', 'title_id genre_id', 1),
  related_titles: table('catalogue', 'title_id related_title_id related_source_id relationship_type label source_url first_seen_at last_seen_at', 'title_id relationship_type related_source_id', 3, 'first_seen_at'),
  episodes: table('catalogue', 'id title_id source_id number_text number_sort label slug canonical_url episode_type availability_state first_seen_at last_seen_at last_successful_import_at created_at updated_at', 'id', 3, 'first_seen_at created_at'),
  episode_versions: table('catalogue', 'id episode_id source_id language version_label audio_language subtitle_language availability_state first_seen_at last_seen_at last_successful_import_at', 'id', 3, 'first_seen_at'),
  provider_aliases: table('catalogue', 'provider_id alias alias_type', 'provider_id alias', 1),
  provider_connections: table('catalogue', 'id provider_id hostname path_pattern relationship evidence_state observation_scope first_seen_at last_seen_at', 'id', 2, 'first_seen_at'),
  episode_provider_mappings: table('catalogue', 'id version_id provider_id source_mapping_id provider_resource_id canonical_embed_url mapping_origin public_export_allowed availability_state unavailable_reason first_seen_at last_seen_at last_successful_import_at last_successful_resolution_at last_playback_verification_at resolution_evidence_state updated_at', 'id', 2, 'first_seen_at last_successful_resolution_at last_playback_verification_at'),
  native_resources: table('catalogue', 'mapping_id provider_id resource_id language edition license rights_evidence_url identity_evidence_url approved_at enabled content_sha1', 'mapping_id', 0, 'enabled'),
  artwork_matches: table('catalogue', 'id title_id title_source title_source_id metadata_source media_id mal_id release_year format review_status evidence_json reviewed_at created_at updated_at', 'id', 4, 'review_status evidence_json reviewed_at created_at'),
  title_artwork: table('catalogue', 'match_id role url width height format content_sha256 reuse_status first_seen_at last_checked_at last_successful_verification_at last_error_code', 'match_id role', 1, 'reuse_status first_seen_at'),
  crawl_runs: table('catalogue', 'id source mode status budget tasks_discovered tasks_completed tasks_failed checkpoint_json started_at finished_at created_at updated_at worker_id worker_heartbeat_at', 'id', 1, 'created_at'),
  crawl_tasks: table('catalogue', 'id run_id task_key task_type payload_json status attempt_count max_attempts available_at claimed_at completed_at last_http_status last_error_code last_error_message retry_after_at created_at updated_at claimed_by lease_expires_at', 'id', 5, 'created_at'),
  coverage_snapshots: table('catalogue', 'id run_id discovered_titles imported_titles discovered_episodes imported_episodes imported_versions discovered_mappings imported_mappings duplicates failures blocked pending denominator_scope captured_at', 'id', 0),
  verification_observations: table('catalogue', 'id entity_type entity_id stage result reason_code evidence_class details_json observed_at', 'id', 1),
  research_records: table('research', 'id collection source_id name kind url research_status evidence_class observation_date canonical_id provenance_path record_json record_hash imported_at', 'id', 5),
  research_record_fragments: table('research', 'record_id fragment_index content', 'record_id fragment_index', 1),
  research_categories: table('research', 'record_id category', 'record_id category', 2),
  research_relationships: table('research', 'id source_id target_id relationship_type confidence verification_scope source_url observation_date evidence_json provenance_path', 'id', 3),
  research_aliases: table('research', 'alias_id canonical_id scope provenance_path', 'alias_id', 1),
  research_documents: table('research', 'path sha256 byte_length media_type imported_at', 'path', 1),
  cloud_snapshot_sources: table('both', 'id source content_hash counts_json observation_date imported_at', 'id', 1),
};

// Internal numeric keys must never be reused to retarget an existing public identity.
// Nullable aliases/observations are not treated as globally unique natural keys.
for (const [name, columns, unique] of [
  ['titles', 'source source_id', true],
  ['genres', 'slug', true],
  ['title_aliases', 'title_id alias language', false],
  ['episodes', 'title_id source_id', true],
  ['episode_versions', 'episode_id source_id language', true],
  ['provider_connections', 'provider_id hostname path_pattern relationship', true],
  ['episode_provider_mappings', 'version_id provider_id source_mapping_id', true],
  ['native_resources', 'mapping_id provider_id resource_id language', false],
  ['artwork_matches', 'title_id title_source title_source_id metadata_source media_id mal_id release_year format', false],
  ['title_artwork', 'match_id role', false],
  ['verification_observations', 'entity_type entity_id stage result reason_code evidence_class details_json observed_at', false],
] as const) { IMPORT_TABLES[name].identity = columns.split(' '); IMPORT_TABLES[name].uniqueIdentity = unique; }
IMPORT_TABLES.artwork_matches.uniqueKeys = [['title_id','metadata_source'],['metadata_source','media_id']];

export const MAX_IMPORT_ROWS = 35;
export const MAX_IMPORT_BYTES = 60_000;
export const IMPORT_SCHEMA_VERSION = 1;
export interface ImportBatch {
  version: 1;
  id: string;
  snapshotId: string;
  target: ImportTarget;
  table: string;
  contentHash: string;
  rows: ImportRow[];
}
/** Both sides of an indexed update are counted; reservation also includes receipt/control writes. */
export const estimateImportWrites = (spec: ImportTable, count: number) => count * (1 + 2 * spec.indexes) + 16;

export function upsertSql(tableName: string, columns: string[], values: string): string {
  const spec = IMPORT_TABLES[tableName];
  if (!spec || columns.some(column => !spec.columns.includes(column)) || spec.primaryKey.some(column => !columns.includes(column))) throw new Error('Unknown import table or columns.');
  const update = columns.filter(column => !spec.primaryKey.includes(column) && !spec.preserve?.includes(column) && !spec.identity?.includes(column));
  // An interrupted/older snapshot cannot blank good fields or downgrade newer title metadata.
  const descriptive = ['name', 'description', 'format', 'status', 'artwork_url', 'label', 'canonical_url', 'record_json', 'record_hash'];
  const effectiveValues = update.map(column => ({ column, value: tableName === 'title_artwork' && column === 'last_error_code' ? `excluded."${column}"` : `COALESCE(${descriptive.includes(column) ? `NULLIF(excluded."${column}",'')` : `excluded."${column}"`},"${tableName}"."${column}")` }));
  const assignments = effectiveValues.map(({ column, value }) => `"${column}"=${value}`);
  const freshnessColumn = columns.includes('updated_at') ? 'updated_at' : columns.includes('last_successful_verification_at') ? 'last_successful_verification_at' : columns.includes('last_successful_import_at') ? 'last_successful_import_at' : columns.includes('approved_at') ? 'approved_at' : null;
  const conditions = (spec.identity ?? []).filter(column => columns.includes(column)).map(column => `"${tableName}"."${column}" IS excluded."${column}"`);
  if (freshnessColumn) conditions.push(`("${tableName}"."${freshnessColumn}" IS NULL OR (excluded."${freshnessColumn}" IS NOT NULL AND julianday(excluded."${freshnessColumn}")>=julianday("${tableName}"."${freshnessColumn}")))`);
  // A replay of the same successful image cannot erase a later failed observation.
  if (tableName === 'title_artwork' && columns.includes('last_checked_at')) conditions.push(`julianday(excluded."last_checked_at")>=julianday("${tableName}"."last_checked_at")`);
  // A new snapshot may contain a previously imported row under a new receipt.
  // Compare the effective assignment (including null/empty preservation), not raw
  // input, so identical metadata does not spend another row/index write. IS NOT
  // remains null-safe; changed freshness and an intentionally cleared error count.
  if (effectiveValues.length) conditions.push(`(${effectiveValues.map(({ column, value }) => `"${tableName}"."${column}" IS NOT ${value}`).join(' OR ')})`);
  return `INSERT INTO "${tableName}"(${columns.map(column => `"${column}"`).join(',')}) VALUES(${values}) ON CONFLICT(${spec.primaryKey.map(column => `"${column}"`).join(',')}) ${assignments.length ? `DO UPDATE SET ${assignments.join(',')}${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''}` : 'DO NOTHING'}`;
}

/** One bounded JSON parameter checks both PK retargeting and natural-key ID drift. */
export function identityConflictSql(tableName: string): string | null {
  const spec = IMPORT_TABLES[tableName];
  if (!spec?.identity?.length) return null;
  const keyMatches = spec.primaryKey.map(column => `current."${column}" IS json_extract(incoming.value,'$.${column}')`).join(' AND ');
  const mismatch = spec.identity.map(column => `(json_type(incoming.value,'$.${column}') IS NOT NULL AND current."${column}" IS NOT json_extract(incoming.value,'$.${column}'))`).join(' OR ');
  const uniqueKeys = spec.uniqueKeys ?? (spec.uniqueIdentity ? [spec.identity] : []);
  const naturalMatches = uniqueKeys.map(keys => '(' + keys.map(column => `(json_type(incoming.value,'$.${column}') IS NOT NULL AND current."${column}" IS json_extract(incoming.value,'$.${column}'))`).join(' AND ') + ')').join(' OR ');
  const naturalConflict = uniqueKeys.length ? `((${naturalMatches}) AND NOT (${keyMatches}))` : '0';
  const conflict = `SELECT 1 AS conflict FROM incoming JOIN "${tableName}" current ON (${keyMatches})${uniqueKeys.length ? ` OR (${naturalMatches})` : ''} WHERE ((${keyMatches}) AND (${mismatch})) OR ${naturalConflict} LIMIT 1`;
  const parentConflict = tableName === 'artwork_matches'
    ? `SELECT 1 FROM incoming LEFT JOIN titles t ON t.id=json_extract(incoming.value,'$.title_id') WHERE t.id IS NULL OR t.source IS NOT json_extract(incoming.value,'$.title_source') OR t.source_id IS NOT json_extract(incoming.value,'$.title_source_id') OR t.release_year IS NOT json_extract(incoming.value,'$.release_year') OR LOWER(t.format) IS NOT LOWER(json_extract(incoming.value,'$.format')) LIMIT 1`
    : tableName === 'title_artwork' ? `SELECT 1 FROM incoming LEFT JOIN artwork_matches m ON m.id=json_extract(incoming.value,'$.match_id') WHERE m.id IS NULL LIMIT 1` : null;
  return `WITH incoming AS (SELECT value FROM json_each(?)) SELECT 1 AS conflict WHERE EXISTS(${conflict})${parentConflict ? ` OR EXISTS(${parentConflict})` : ''} LIMIT 1`;
}

/** One JSON parameter is expanded into normal columns; JSON is not stored as a catalogue snapshot. */
export function upsertJsonRowsSql(tableName: string, columns: string[]): string {
  const template = upsertSql(tableName, columns, '');
  const selection = columns.map(column => `json_extract(value,'$.${column}')`).join(',');
  // WHERE true removes SQLite's INSERT-SELECT/ON-CONFLICT parsing ambiguity.
  return template.replace(' VALUES() ON CONFLICT', ` SELECT ${selection} FROM json_each(?) WHERE true ON CONFLICT`);
}
export function groupImportRows(rows: ImportRow[]): Array<{ columns: string[]; rows: ImportRow[] }> {
  const groups = new Map<string, { columns: string[]; rows: ImportRow[] }>();
  for (const row of rows) { const columns = Object.keys(row).sort(); const key = columns.join(','); const group = groups.get(key); if (group) group.rows.push(row); else groups.set(key, { columns, rows: [row] }); }
  return [...groups.values()];
}
