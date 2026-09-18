import { currentSchemaVersion, type SqliteDatabase } from './db.ts';
import { AppError } from './errors.ts';
import type { StoredProviderMapping } from './providers/contract.ts';
import { decorateLocalArtwork } from './artwork/catalogue.ts';
import { isCatalogueScope, sourcesForCatalogueScope } from '../shared/catalogue-scope.ts';

const parseJson = (value: unknown, fallback: unknown) => {
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
};

export interface BrowseParams {
  q?: string;
  scope?: string;
  genre?: string;
  type?: string;
  status?: string;
  language?: string;
  page: number;
  pageSize: number;
  sort: string;
  includeFacets?: boolean;
}

export function browseTitles(db: SqliteDatabase, params: BrowseParams) {
  const where: string[] = ['1=1'];
  const bindings: Array<string | number> = [];
  if (params.scope) {
    if (!isCatalogueScope(params.scope))
      throw new AppError(400, 'INVALID_QUERY', 'Catalogue scope must be all, anime, tv, or movies.');
    const sources = sourcesForCatalogueScope(params.scope);
    if (sources.length) {
      where.push(`t.source IN (${sources.map(() => '?').join(',')})`);
      bindings.push(...sources);
    }
  }
  if (params.q) {
    where.push(
      `(t.name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM title_aliases a WHERE a.title_id=t.id AND a.alias LIKE ? ESCAPE '\\'))`,
    );
    const q = `%${params.q.replace(/[\\%_]/g, '\\$&')}%`;
    bindings.push(q, q);
  }
  if (params.genre) {
    where.push(
      'EXISTS (SELECT 1 FROM title_genres tg JOIN genres g ON g.id=tg.genre_id WHERE tg.title_id=t.id AND g.slug=?)',
    );
    bindings.push(params.genre);
  }
  if (params.type) {
    where.push('LOWER(t.format)=LOWER(?)');
    bindings.push(params.type);
  }
  if (params.status) {
    where.push('LOWER(t.status)=LOWER(?)');
    bindings.push(params.status);
  }
  if (params.language) {
    where.push(
      'EXISTS (SELECT 1 FROM episodes e JOIN episode_versions v ON v.episode_id=e.id WHERE e.title_id=t.id AND v.language=?)',
    );
    bindings.push(params.language.toLowerCase());
  }
  const order: Record<string, string> = {
    name: 't.name COLLATE NOCASE ASC',
    title: 't.name COLLATE NOCASE ASC',
    newest: 't.release_year DESC, t.name COLLATE NOCASE',
    year_desc: 't.release_year DESC, t.name COLLATE NOCASE',
    oldest: 't.release_year IS NULL, t.release_year ASC, t.name COLLATE NOCASE',
    year_asc: 't.release_year IS NULL, t.release_year ASC, t.name COLLATE NOCASE',
    updated: 't.updated_at DESC, t.id DESC',
    episodes: 'episode_count DESC, t.name COLLATE NOCASE',
  };
  const from = `FROM titles t WHERE ${where.join(' AND ')}`;
  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS count ${from}`).get(...bindings) as { count: number }).count,
  );
  const rows = db
    .prepare(
      `SELECT CAST(t.id AS TEXT) AS id,t.source,t.source_id AS sourceId,t.slug,t.canonical_url AS canonicalUrl,t.name,t.description,t.description AS synopsis,t.format,t.format AS type,t.release_year AS releaseYear,t.status,t.updated_at AS updatedAt,t.artwork_url AS artworkUrl,t.artwork_url AS imageUrl,t.availability_state AS availability,(SELECT COUNT(*) FROM episodes e WHERE e.title_id=t.id) AS episode_count ${from} ORDER BY ${order[params.sort] ?? order.name}, t.id ASC LIMIT ? OFFSET ?`,
    )
    .all(...bindings, params.pageSize, (params.page - 1) * params.pageSize) as Array<
    Record<string, unknown>
  >;
  return {
    items: decorateLocalArtwork(db, rows).map((row) => {
      const { episode_count, ...item } = row;
      return { ...item, episodeCount: episode_count };
    }),
    total,
    page: params.page,
    pageSize: params.pageSize,
    pages: Math.ceil(total / params.pageSize),
    ...(params.includeFacets !== false ? { facets: getFilters(db) } : {}),
  };
}

const filterCache = new WeakMap<
  SqliteDatabase,
  { version: number; changes: number; expiresAt: number; value: ReturnType<typeof readFilters> }
>();
export function getFilters(db: SqliteDatabase) {
  const version = Number(
    (db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version,
  );
  const changes = Number(
    (db.prepare('SELECT total_changes() AS count').get() as { count: number }).count,
  );
  const cached = filterCache.get(db);
  if (
    cached &&
    cached.version === version &&
    cached.changes === changes &&
    cached.expiresAt > Date.now()
  )
    return cached.value;
  const value = readFilters(db);
  filterCache.set(db, { version, changes, expiresAt: Date.now() + 30_000, value });
  return value;
}
function readFilters(db: SqliteDatabase) {
  const simple = (
    column: 'format' | 'status',
    labelFor: (value: string) => string = (value) => value,
  ) =>
    (
      db
        .prepare(
          `SELECT LOWER(${column}) AS value,MIN(${column}) AS sourceLabel,COUNT(*) AS count FROM titles WHERE ${column} IS NOT NULL AND ${column}<>'' GROUP BY ${column} COLLATE NOCASE ORDER BY ${column} COLLATE NOCASE`,
        )
        .all() as Array<{ value: string; sourceLabel: string; count: number }>
    ).map((row) => ({ value: row.value, label: labelFor(row.sourceLabel), count: row.count }));
  const formatLabel = (value: string) =>
    ({
      movie: 'Movie',
      music: 'Music',
      ona: 'ONA',
      ova: 'OVA',
      special: 'Special',
      tv: 'TV',
      tv_short: 'TV Short',
      'tv special': 'TV Special',
    })[value.toLowerCase()] ?? value;
  return {
    genres: db
      .prepare(
        'SELECT g.slug AS value,g.name AS label,COUNT(*) AS count FROM genres g JOIN title_genres tg ON tg.genre_id=g.id GROUP BY g.id ORDER BY g.name',
      )
      .all(),
    types: simple('format', formatLabel),
    statuses: simple('status'),
    languages: db
      .prepare(
        'SELECT v.language AS value,UPPER(v.language) AS label,COUNT(DISTINCT e.title_id) AS count FROM episode_versions v JOIN episodes e ON e.id=v.episode_id GROUP BY v.language ORDER BY v.language',
      )
      .all(),
  };
}

export function getTitle(db: SqliteDatabase, slug: string) {
  const title = db
    .prepare(
      'SELECT CAST(id AS TEXT) AS id,source,source_id AS sourceId,slug,canonical_url AS canonicalUrl,name,description,description AS synopsis,format,format AS type,release_year AS releaseYear,status,artwork_url AS artworkUrl,artwork_url AS imageUrl,artwork_origin AS artworkOrigin,artwork_reuse_status AS artworkReuseStatus,availability_state AS availability,first_seen_at AS firstSeen,last_seen_at AS lastSeen,last_successful_import_at AS lastSuccessfulImport FROM titles WHERE slug=?',
    )
    .get(slug) as Record<string, unknown> | undefined;
  if (!title) throw new AppError(404, 'NOT_FOUND', 'Title was not found.');
  const id = Number(title.id);
  const aliases = db
    .prepare(
      "SELECT alias AS name,NULLIF(language,'') AS language,alias_type AS type FROM title_aliases WHERE title_id=? ORDER BY alias",
    )
    .all(id);
  const genres = db
    .prepare(
      'SELECT g.slug,g.name FROM genres g JOIN title_genres tg ON tg.genre_id=g.id WHERE tg.title_id=? ORDER BY g.name',
    )
    .all(id);
  const related = db
    .prepare(
      `SELECT rt.related_source_id AS sourceId,rt.relationship_type AS relationshipType,rt.label,rt.source_url AS sourceUrl,
    CAST(t.id AS TEXT) AS id,t.slug,t.name,t.format AS type,t.release_year AS releaseYear,t.status,t.artwork_url AS imageUrl,t.availability_state AS availability
    FROM related_titles rt LEFT JOIN titles t ON t.id=rt.related_title_id WHERE rt.title_id=? ORDER BY rt.relationship_type,COALESCE(t.name,rt.label,rt.related_source_id)`,
    )
    .all(id);
  const episodes = db
    .prepare(
      'SELECT CAST(id AS TEXT) AS id,source_id AS sourceId,number_text AS number,label,slug,episode_type AS type,availability_state AS availability FROM episodes WHERE title_id=? ORDER BY number_sort IS NULL,number_sort,number_text',
    )
    .all(id) as Array<Record<string, unknown>>;
  const versions = db
    .prepare(
      `SELECT CAST(v.id AS TEXT) AS id,CAST(v.episode_id AS TEXT) AS episodeId,
    v.language,v.version_label AS label,v.availability_state AS availability,COUNT(m.id) AS providerCount
    FROM episode_versions v JOIN episodes e ON e.id=v.episode_id
    LEFT JOIN episode_provider_mappings m ON m.version_id=v.id
    WHERE e.title_id=? GROUP BY v.id ORDER BY v.language,v.id`,
    )
    .all(id) as Array<Record<string, unknown>>;
  const byEpisode = new Map<string, Array<Record<string, unknown>>>();
  for (const { episodeId, ...version } of versions) {
    const key = String(episodeId);
    const entries = byEpisode.get(key) ?? [];
    entries.push(version);
    byEpisode.set(key, entries);
  }
  const verifiedEmpty = episodes.length === 0 && !!db.prepare("SELECT 1 FROM verification_observations WHERE entity_type='title' AND entity_id=? AND result='empty_episode_inventory' LIMIT 1").get(String(title.sourceId));
  const collectionState = verifiedEmpty || episodes.length > 0 ? 'complete' : 'pending';
  return {
    collectionState,
    title: Object.assign(decorateLocalArtwork(db, [title])[0], { episodeCount: episodes.length, collectionState }) as Record<string, unknown>,
    aliases,
    genres,
    related: decorateLocalArtwork(db, related),
    episodes: episodes.map((episode) => ({
      ...episode,
      versions: byEpisode.get(String(episode.id)) ?? [],
    })),
  };
}

export function getEpisodeProviders(db: SqliteDatabase, episodeId: number, language?: string) {
  const episode = db
    .prepare(
      'SELECT CAST(e.id AS TEXT) AS id,e.source_id AS sourceId,e.number_text AS number,e.label,e.slug,t.slug AS titleSlug,t.name AS titleName FROM episodes e JOIN titles t ON t.id=e.title_id WHERE e.id=?',
    )
    .get(episodeId) as Record<string, unknown> | undefined;
  if (!episode) throw new AppError(404, 'NOT_FOUND', 'Episode was not found.');
  const version = language
    ? db
        .prepare(
          'SELECT CAST(id AS TEXT) AS id,source_id AS sourceId,language,version_label AS label,availability_state AS availability FROM episode_versions WHERE episode_id=? AND language=?',
        )
        .get(episodeId, language.toLowerCase())
    : db
        .prepare(
          "SELECT CAST(id AS TEXT) AS id,source_id AS sourceId,language,version_label AS label,availability_state AS availability FROM episode_versions WHERE episode_id=? ORDER BY CASE language WHEN 'sub' THEN 0 WHEN 'dub' THEN 1 ELSE 2 END LIMIT 1",
        )
        .get(episodeId);
  if (!version) throw new AppError(404, 'NOT_FOUND', 'Episode version was not found.');
  const rows = db
    .prepare(
      `SELECT CAST(m.id AS TEXT) AS mappingId,p.id AS providerId,p.label,n.edition,p.playback_type AS playbackType,m.availability_state AS status,p.capabilities_json AS capabilities,m.last_successful_resolution_at AS lastSuccessfulResolution,m.last_playback_verification_at AS lastPlaybackVerification,m.unavailable_reason AS reason FROM episode_provider_mappings m JOIN providers p ON p.id=m.provider_id LEFT JOIN native_resources n ON n.mapping_id=m.id WHERE m.version_id=? ORDER BY p.label,COALESCE(n.edition,''),m.id`,
    )
    .all(Number((version as Record<string, unknown>).id)) as Array<Record<string, unknown>>;
  const aliasQuery = db.prepare(
    'SELECT alias FROM provider_aliases WHERE provider_id=? ORDER BY alias',
  );
  const normalizedVersion = { ...(version as object), providerCount: rows.length };
  return {
    episode: { ...episode, versions: [normalizedVersion] },
    version: normalizedVersion,
    providers: rows.map((row) => ({
      ...row,
      capabilities: parseJson(row.capabilities, {}),
      aliases: (aliasQuery.all(row.providerId as string) as Array<{ alias: string }>).map(
        (item) => item.alias,
      ),
    })),
  };
}

export function getMapping(db: SqliteDatabase, mappingId: number): StoredProviderMapping {
  const row = db
    .prepare(
      `SELECT m.id AS mappingId,m.provider_id AS providerId,p.label,n.edition,v.language,m.provider_resource_id AS providerResourceId,m.canonical_embed_url AS canonicalEmbedUrl,m.availability_state AS availability,m.unavailable_reason AS unavailableReason FROM episode_provider_mappings m JOIN providers p ON p.id=m.provider_id JOIN episode_versions v ON v.id=m.version_id LEFT JOIN native_resources n ON n.mapping_id=m.id WHERE m.id=?`,
    )
    .get(mappingId);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Provider mapping was not found.');
  return row as unknown as StoredProviderMapping;
}

export function adminStatus(db: SqliteDatabase) {
  const latestRun =
    db
      .prepare(
        `SELECT r.*,
    (SELECT COUNT(*) FROM crawl_tasks t WHERE t.run_id=r.id AND t.status IN ('failed','blocked')) AS tasks_failed
    FROM crawl_runs r ORDER BY r.id DESC LIMIT 1`,
      )
      .get() ?? null;
  const coverage =
    db.prepare('SELECT * FROM coverage_snapshots ORDER BY id DESC LIMIT 1').get() ?? null;
  const counts = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM titles) AS titles,(SELECT COUNT(*) FROM episodes) AS episodes,(SELECT COUNT(*) FROM episode_versions) AS versions,(SELECT COUNT(*) FROM episode_provider_mappings) AS mappings,(SELECT COUNT(*) FROM crawl_tasks WHERE status IN ('pending','running','retry')) AS pendingTasks`,
    )
    .get();
  const recentErrors = db
    .prepare(
      'SELECT id,run_id AS runId,task_key AS taskKey,last_error_code AS code,last_error_message AS message,updated_at AS updatedAt FROM crawl_tasks WHERE last_error_code IS NOT NULL ORDER BY updated_at DESC LIMIT 20',
    )
    .all();
  const taskStages = latestRun
    ? db
        .prepare(
          `SELECT task_type AS taskType,
    SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN status IN ('pending','retry','running') THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN status IN ('failed','blocked') THEN 1 ELSE 0 END) AS failed,
    COUNT(*) AS total
    FROM crawl_tasks WHERE run_id=? GROUP BY task_type ORDER BY task_type`,
        )
        .all((latestRun as { id: number }).id)
    : [];
  const providers = db
    .prepare(
      `SELECT p.id,p.label,p.adapter_state AS adapterState,p.identity_state AS identityState,p.playback_type AS playbackType,COUNT(m.id) AS mappingCount,MAX(m.last_successful_resolution_at) AS lastSuccessfulResolution,MAX(m.last_playback_verification_at) AS lastPlaybackVerification FROM providers p LEFT JOIN episode_provider_mappings m ON m.provider_id=p.id GROUP BY p.id ORDER BY p.label`,
    )
    .all();
  return { latestRun, coverage, counts, taskStages, recentErrors, providers };
}

export function exportCatalogue(db: SqliteDatabase) {
  const titles = db
    .prepare(
      'SELECT id,source_id AS sourceId,slug,canonical_url AS canonicalUrl,name,description,format,release_year AS releaseYear,status,artwork_url AS artworkUrl,artwork_origin AS artworkOrigin,artwork_reuse_status AS artworkReuseStatus,availability_state AS availability,first_seen_at AS firstSeen,last_seen_at AS lastSeen,last_successful_import_at AS lastSuccessfulImport FROM titles ORDER BY name',
    )
    .all() as Array<Record<string, unknown>>;
  const aliases = db
    .prepare(
      "SELECT title_id AS titleId,alias AS name,NULLIF(language,'') AS language,alias_type AS type FROM title_aliases ORDER BY title_id,alias",
    )
    .all() as Array<Record<string, unknown>>;
  const genres = db
    .prepare(
      'SELECT tg.title_id AS titleId,g.slug,g.name FROM title_genres tg JOIN genres g ON g.id=tg.genre_id ORDER BY tg.title_id,g.name',
    )
    .all() as Array<Record<string, unknown>>;
  const related = db
    .prepare(
      'SELECT title_id AS titleId,related_source_id AS sourceId,relationship_type AS relationshipType,label,source_url AS sourceUrl,first_seen_at AS firstSeen,last_seen_at AS lastSeen FROM related_titles ORDER BY title_id,relationship_type,related_source_id',
    )
    .all() as Array<Record<string, unknown>>;
  const episodes = db
    .prepare(
      'SELECT id,title_id AS titleId,source_id AS sourceId,number_text AS number,number_sort AS numberSort,label,slug,canonical_url AS canonicalUrl,episode_type AS episodeType,availability_state AS availability,first_seen_at AS firstSeen,last_seen_at AS lastSeen,last_successful_import_at AS lastSuccessfulImport FROM episodes ORDER BY title_id,number_sort IS NULL,number_sort,number_text',
    )
    .all() as Array<Record<string, unknown>>;
  const versions = db
    .prepare(
      'SELECT id,episode_id AS episodeId,source_id AS sourceId,language,version_label AS label,audio_language AS audioLanguage,subtitle_language AS subtitleLanguage,availability_state AS availability,first_seen_at AS firstSeen,last_seen_at AS lastSeen,last_successful_import_at AS lastSuccessfulImport FROM episode_versions ORDER BY episode_id,language',
    )
    .all() as Array<Record<string, unknown>>;
  const mappings = db
    .prepare(
      `SELECT version_id AS versionId,provider_id AS providerId,source_mapping_id AS sourceMappingId,mapping_origin AS mappingOrigin,availability_state AS availability,unavailable_reason AS unavailableReason,first_seen_at AS firstSeen,last_seen_at AS lastSeen,last_successful_import_at AS lastSuccessfulImport,last_successful_resolution_at AS lastSuccessfulResolution,last_playback_verification_at AS lastPlaybackVerification,resolution_evidence_state AS resolutionEvidenceState FROM episode_provider_mappings ORDER BY version_id,provider_id`,
    )
    .all() as Array<Record<string, unknown>>;
  const group = (rows: Array<Record<string, unknown>>, key: string) => {
    const result = new Map<number, Array<Record<string, unknown>>>();
    for (const row of rows) {
      const id = Number(row[key]);
      const { [key]: _key, ...rest } = row;
      const current = result.get(id) ?? [];
      current.push(rest);
      result.set(id, current);
    }
    return result;
  };
  const aliasesByTitle = group(aliases, 'titleId');
  const genresByTitle = group(genres, 'titleId');
  const relatedByTitle = group(related, 'titleId');
  const episodesByTitle = group(episodes, 'titleId');
  const versionsByEpisode = group(versions, 'episodeId');
  const mappingsByVersion = group(mappings, 'versionId');
  const records = titles.map((title) => {
    const titleId = Number(title.id);
    const { id: _id, ...publicTitle } = title;
    return {
      ...publicTitle,
      aliases: aliasesByTitle.get(titleId) ?? [],
      genres: genresByTitle.get(titleId) ?? [],
      related: relatedByTitle.get(titleId) ?? [],
      episodes: (episodesByTitle.get(titleId) ?? []).map((episode) => {
        const episodeId = Number(episode.id);
        const { id: _episodeId, ...publicEpisode } = episode;
        return {
          ...publicEpisode,
          versions: (versionsByEpisode.get(episodeId) ?? []).map((version) => {
            const versionId = Number(version.id);
            const { id: _versionId, ...publicVersion } = version;
            return { ...publicVersion, providers: mappingsByVersion.get(versionId) ?? [] };
          }),
        };
      }),
    };
  });
  const providers = db
    .prepare(
      'SELECT id,label,identity_state AS identityState,playback_type AS playbackType,adapter_state AS adapterState,hostname,observed_limitation AS limitation,evidence_class AS evidenceClass,last_seen_at AS lastSeen FROM providers ORDER BY label',
    )
    .all();
  const counts = adminStatus(db).counts;
  return {
    schemaVersion: currentSchemaVersion(db),
    exportSchemaVersion: 1,
    exportedAt: new Date().toISOString(),
    source: 'anikoto',
    counts,
    titles: records,
    providers,
    note: 'Opaque provider resource identifiers, resolver tokens, and temporary embed URLs are intentionally excluded. sourceMappingId values are one-way relationship hashes.',
  };
}

export function exportCatalogueCsv(db: SqliteDatabase): string {
  const headers = [
    'source_id',
    'slug',
    'name',
    'format',
    'release_year',
    'status',
    'availability_state',
    'episode_count',
    'version_count',
    'mapping_count',
    'first_seen_at',
    'last_seen_at',
    'last_successful_import_at',
  ];
  const rows = db
    .prepare(
      `SELECT t.source_id,t.slug,t.name,t.format,t.release_year,t.status,t.availability_state,
    COUNT(DISTINCT e.id) AS episode_count,COUNT(DISTINCT v.id) AS version_count,COUNT(DISTINCT m.id) AS mapping_count,
    t.first_seen_at,t.last_seen_at,t.last_successful_import_at
    FROM titles t LEFT JOIN episodes e ON e.title_id=t.id LEFT JOIN episode_versions v ON v.episode_id=e.id LEFT JOIN episode_provider_mappings m ON m.version_id=v.id
    GROUP BY t.id ORDER BY t.name`,
    )
    .all() as Array<Record<string, unknown>>;
  const quote = (value: unknown) => {
    const text = String(value ?? '');
    const safe = /^[\s]*[=+@-]/.test(text) && typeof value !== 'number' ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return (
    [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => quote(row[header])).join(',')),
    ].join('\r\n') + '\r\n'
  );
}

export function exportCoverageCsv(db: SqliteDatabase): string {
  const headers = [
    'id',
    'run_id',
    'discovered_titles',
    'imported_titles',
    'discovered_episodes',
    'imported_episodes',
    'imported_versions',
    'discovered_mappings',
    'imported_mappings',
    'duplicates',
    'failures',
    'blocked',
    'pending',
    'denominator_scope',
    'captured_at',
  ];
  const rows = db
    .prepare(`SELECT ${headers.join(',')} FROM coverage_snapshots ORDER BY id`)
    .all() as Array<Record<string, unknown>>;
  const quote = (value: unknown) => {
    const text = String(value ?? '');
    const safe = /^[\s]*[=+@-]/.test(text) && typeof value !== 'number' ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return (
    [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => quote(row[header])).join(',')),
    ].join('\r\n') + '\r\n'
  );
}
