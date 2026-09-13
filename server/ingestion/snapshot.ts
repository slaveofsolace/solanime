import type { SqliteDatabase } from '../db.ts';
import type { CatalogueSnapshot } from '../types.ts';
import { validateSnapshot } from './validate.ts';

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';

export interface ImportResult {
  titles: number;
  episodes: number;
  versions: number;
  mappings: number;
  duplicates: number;
}

export function markMissingTitlesStale(db: SqliteDatabase, runId: number): number {
  const run = db.prepare('SELECT started_at AS startedAt FROM crawl_runs WHERE id=?').get(runId) as
    | { startedAt: string | null }
    | undefined;
  if (!run?.startedAt) return 0;
  const result = db
    .prepare(
      "UPDATE titles SET availability_state='stale',updated_at=? WHERE source='anikoto' AND last_seen_at<? AND availability_state<>'blocked'",
    )
    .run(new Date().toISOString(), run.startedAt);
  return Number(result.changes);
}

export function markMissingEpisodeInventoryStale(
  db: SqliteDatabase,
  titleSourceId: string,
  observedAt: string,
): { episodes: number; versions: number; mappings: number } {
  const updatedAt = new Date().toISOString();
  const episodes = db
    .prepare(
      `UPDATE episodes SET availability_state='stale',updated_at=?
    WHERE title_id=(SELECT id FROM titles WHERE source='anikoto' AND source_id=?) AND last_seen_at<? AND availability_state<>'blocked'`,
    )
    .run(updatedAt, titleSourceId, observedAt);
  const versions = db
    .prepare(
      `UPDATE episode_versions SET availability_state='stale'
    WHERE episode_id IN (SELECT id FROM episodes WHERE title_id=(SELECT id FROM titles WHERE source='anikoto' AND source_id=?)) AND last_seen_at<? AND availability_state<>'blocked'`,
    )
    .run(titleSourceId, observedAt);
  const mappings = db
    .prepare(
      `UPDATE episode_provider_mappings SET availability_state='stale',unavailable_reason='Parent episode or language version was absent from the latest complete episode inventory.',updated_at=?
    WHERE version_id IN (
      SELECT v.id FROM episode_versions v JOIN episodes e ON e.id=v.episode_id JOIN titles t ON t.id=e.title_id
      WHERE t.source='anikoto' AND t.source_id=? AND (e.last_seen_at<? OR v.last_seen_at<?)
    ) AND availability_state<>'blocked'`,
    )
    .run(updatedAt, titleSourceId, observedAt, observedAt);
  return {
    episodes: Number(episodes.changes),
    versions: Number(versions.changes),
    mappings: Number(mappings.changes),
  };
}

export function markProviderMappingsUnknownForMissingReference(
  db: SqliteDatabase,
  titleSourceId: string,
  episodeSourceId: string,
): number {
  const result = db
    .prepare(
      `UPDATE episode_provider_mappings SET availability_state='unknown',unavailable_reason='The latest complete episode inventory did not expose a server-list reference for this episode.',updated_at=?
    WHERE version_id IN (
      SELECT v.id FROM episode_versions v JOIN episodes e ON e.id=v.episode_id JOIN titles t ON t.id=e.title_id
      WHERE t.source='anikoto' AND t.source_id=? AND e.source_id=?
    ) AND availability_state<>'blocked'`,
    )
    .run(new Date().toISOString(), titleSourceId, episodeSourceId);
  return Number(result.changes);
}

export function markMissingProviderMappingsStale(
  db: SqliteDatabase,
  titleSourceId: string,
  episodeSourceId: string,
  observedAt: string,
): number {
  const result = db
    .prepare(
      `UPDATE episode_provider_mappings SET availability_state='stale',unavailable_reason='Not present in the latest complete server-list observation.',updated_at=?
    WHERE version_id IN (
      SELECT v.id FROM episode_versions v JOIN episodes e ON e.id=v.episode_id JOIN titles t ON t.id=e.title_id
      WHERE t.source='anikoto' AND t.source_id=? AND e.source_id=?
    ) AND last_seen_at<? AND availability_state<>'blocked'`,
    )
    .run(new Date().toISOString(), titleSourceId, episodeSourceId, observedAt);
  return Number(result.changes);
}

export function importSnapshot(
  db: SqliteDatabase,
  input: unknown,
  runId?: number,
  recordCoverage = true,
  touchAncestors = true,
): ImportResult {
  const snapshot = validateSnapshot(input);
  const now = new Date().toISOString();
  const counts: ImportResult = { titles: 0, episodes: 0, versions: 0, mappings: 0, duplicates: 0 };
  const existingTitle = db.prepare('SELECT id FROM titles WHERE source=? AND source_id=?');
  const findTitle = db.prepare('SELECT id FROM titles WHERE source=? AND source_id=?');
  // Legacy related_source_id values belong to the owning title's source namespace.
  const linkInboundRelations = db.prepare(
    `UPDATE related_titles SET related_title_id=? WHERE related_source_id=? AND related_title_id IS NULL
    AND EXISTS (SELECT 1 FROM titles owner WHERE owner.id=related_titles.title_id AND owner.source=?)`,
  );
  const upsertTitle =
    db.prepare(`INSERT INTO titles(source,source_id,slug,canonical_url,name,description,format,release_year,status,artwork_url,artwork_origin,artwork_reuse_status,availability_state,first_seen_at,last_seen_at,last_successful_import_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source,source_id) DO UPDATE SET slug=excluded.slug,canonical_url=excluded.canonical_url,name=excluded.name,description=COALESCE(excluded.description,titles.description),format=COALESCE(excluded.format,titles.format),release_year=COALESCE(excluded.release_year,titles.release_year),status=COALESCE(excluded.status,titles.status),artwork_url=COALESCE(excluded.artwork_url,titles.artwork_url),artwork_origin=COALESCE(excluded.artwork_origin,titles.artwork_origin),artwork_reuse_status=excluded.artwork_reuse_status,availability_state=excluded.availability_state,last_seen_at=excluded.last_seen_at,last_successful_import_at=excluded.last_successful_import_at,updated_at=excluded.updated_at`);
  const upsertEpisode =
    db.prepare(`INSERT INTO episodes(title_id,source_id,number_text,number_sort,label,slug,canonical_url,episode_type,availability_state,first_seen_at,last_seen_at,last_successful_import_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(title_id,source_id) DO UPDATE SET number_text=excluded.number_text,number_sort=COALESCE(excluded.number_sort,episodes.number_sort),label=COALESCE(excluded.label,episodes.label),slug=excluded.slug,canonical_url=excluded.canonical_url,episode_type=excluded.episode_type,availability_state=excluded.availability_state,last_seen_at=excluded.last_seen_at,last_successful_import_at=excluded.last_successful_import_at,updated_at=excluded.updated_at`);
  const findEpisode = db.prepare('SELECT id FROM episodes WHERE title_id=? AND source_id=?');
  const upsertVersion =
    db.prepare(`INSERT INTO episode_versions(episode_id,source_id,language,version_label,audio_language,subtitle_language,availability_state,first_seen_at,last_seen_at,last_successful_import_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(episode_id,source_id,language) DO UPDATE SET version_label=COALESCE(excluded.version_label,episode_versions.version_label),audio_language=COALESCE(excluded.audio_language,episode_versions.audio_language),subtitle_language=COALESCE(excluded.subtitle_language,episode_versions.subtitle_language),availability_state=excluded.availability_state,last_seen_at=excluded.last_seen_at,last_successful_import_at=excluded.last_successful_import_at`);
  const findVersion = db.prepare(
    'SELECT id FROM episode_versions WHERE episode_id=? AND source_id=? AND language=?',
  );
  const upsertMapping =
    db.prepare(`INSERT INTO episode_provider_mappings(version_id,provider_id,source_mapping_id,provider_resource_id,canonical_embed_url,mapping_origin,public_export_allowed,availability_state,unavailable_reason,first_seen_at,last_seen_at,last_successful_import_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(version_id,provider_id,source_mapping_id) DO UPDATE SET provider_resource_id=COALESCE(excluded.provider_resource_id,episode_provider_mappings.provider_resource_id),canonical_embed_url=COALESCE(excluded.canonical_embed_url,episode_provider_mappings.canonical_embed_url),mapping_origin=excluded.mapping_origin,public_export_allowed=excluded.public_export_allowed,availability_state=excluded.availability_state,unavailable_reason=excluded.unavailable_reason,last_seen_at=excluded.last_seen_at,last_successful_import_at=excluded.last_successful_import_at,updated_at=excluded.updated_at`);

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const title of snapshot.titles) {
      const currentTitle = existingTitle.get(snapshot.source, title.sourceId) as
        | { id: number }
        | undefined;
      if (currentTitle) counts.duplicates++;
      if (touchAncestors || !currentTitle)
        upsertTitle.run(
          snapshot.source,
          title.sourceId,
          title.slug,
          title.canonicalUrl,
          title.name,
          title.description ?? null,
          title.format ?? null,
          title.releaseYear ?? null,
          title.status ?? null,
          title.artworkUrl ?? null,
          title.artworkOrigin ?? null,
          title.artworkReuseStatus ?? 'unknown',
          title.availability ?? 'observed',
          snapshot.observedAt,
          snapshot.observedAt,
          snapshot.observedAt,
          now,
          now,
        );
      const titleId = Number(
        currentTitle?.id ??
          (findTitle.get(snapshot.source, title.sourceId) as { id: number }).id,
      );
      linkInboundRelations.run(titleId, title.sourceId, snapshot.source);
      counts.titles++;
      for (const alias of title.aliases ?? [])
        db.prepare(
          'INSERT INTO title_aliases(title_id,alias,language,alias_type) VALUES (?,?,?,?) ON CONFLICT(title_id,alias,language) DO UPDATE SET alias_type=excluded.alias_type',
        ).run(titleId, alias.name, alias.language ?? '', alias.type ?? 'alternate');
      for (const genreName of title.genres ?? []) {
        const slug = slugify(genreName);
        db.prepare(
          'INSERT INTO genres(slug,name) VALUES (?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name',
        ).run(slug, genreName);
        const genreId = Number(
          (db.prepare('SELECT id FROM genres WHERE slug=?').get(slug) as { id: number }).id,
        );
        db.prepare('INSERT OR IGNORE INTO title_genres(title_id,genre_id) VALUES (?,?)').run(
          titleId,
          genreId,
        );
      }
      for (const relation of title.related ?? []) {
        const relatedTitle = findTitle.get(snapshot.source, relation.sourceId) as
          | { id: number }
          | undefined;
        db.prepare(
          `INSERT INTO related_titles(title_id,related_title_id,related_source_id,relationship_type,label,source_url,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(title_id,relationship_type,related_source_id) DO UPDATE SET related_title_id=COALESCE(excluded.related_title_id,related_titles.related_title_id),label=COALESCE(excluded.label,related_titles.label),source_url=COALESCE(excluded.source_url,related_titles.source_url),last_seen_at=excluded.last_seen_at`,
        ).run(
          titleId,
          relatedTitle?.id ?? null,
          relation.sourceId,
          relation.relationshipType,
          relation.label ?? null,
          relation.sourceUrl ?? null,
          snapshot.observedAt,
          snapshot.observedAt,
        );
      }
      for (const episode of title.episodes) {
        const currentEpisode = findEpisode.get(titleId, episode.sourceId) as
          | { id: number }
          | undefined;
        if (touchAncestors || !currentEpisode)
          upsertEpisode.run(
            titleId,
            episode.sourceId,
            episode.number,
            episode.numberSort ?? null,
            episode.label ?? null,
            episode.slug,
            episode.canonicalUrl,
            episode.episodeType ?? 'regular',
            episode.availability ?? 'observed',
            snapshot.observedAt,
            snapshot.observedAt,
            snapshot.observedAt,
            now,
            now,
          );
        const episodeId = Number(
          currentEpisode?.id ?? (findEpisode.get(titleId, episode.sourceId) as { id: number }).id,
        );
        counts.episodes++;
        for (const version of episode.versions) {
          const currentVersion = findVersion.get(episodeId, version.sourceId, version.language) as
            | { id: number }
            | undefined;
          if (touchAncestors || !currentVersion)
            upsertVersion.run(
              episodeId,
              version.sourceId,
              version.language,
              version.label ?? null,
              version.audioLanguage ?? null,
              version.subtitleLanguage ?? null,
              version.availability ?? 'observed',
              snapshot.observedAt,
              snapshot.observedAt,
              snapshot.observedAt,
            );
          const versionId = Number(
            currentVersion?.id ??
              (findVersion.get(episodeId, version.sourceId, version.language) as { id: number }).id,
          );
          counts.versions++;
          for (const mapping of version.providers ?? []) {
            upsertMapping.run(
              versionId,
              mapping.providerId,
              mapping.sourceMappingId,
              mapping.providerResourceId ?? null,
              mapping.canonicalEmbedUrl ?? null,
              mapping.mappingOrigin ?? 'native',
              mapping.publicExportAllowed === true ? 1 : 0,
              mapping.availability ?? 'observed',
              mapping.unavailableReason ?? null,
              snapshot.observedAt,
              snapshot.observedAt,
              snapshot.observedAt,
              now,
            );
            counts.mappings++;
          }
        }
      }
    }
    if (recordCoverage)
      db.prepare(
        `INSERT INTO coverage_snapshots(run_id,discovered_titles,imported_titles,discovered_episodes,imported_episodes,imported_versions,discovered_mappings,imported_mappings,duplicates,failures,blocked,pending,denominator_scope,captured_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        runId ?? null,
        snapshot.titles.length,
        counts.titles,
        counts.episodes,
        counts.episodes,
        counts.versions,
        counts.mappings,
        counts.mappings,
        counts.duplicates,
        0,
        0,
        0,
        snapshot.denominator?.scope ?? 'discovered public records',
        now,
      );
    db.exec('COMMIT');
    return counts;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
