import { migrate, openDatabase } from '../server/db.ts';
import { adminStatus } from '../server/catalogue.ts';

const db = openDatabase();
try {
  migrate(db);
  const integrity = db.prepare('PRAGMA integrity_check').all();
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  const checks = {
    duplicateTitleSourceIds: db
      .prepare(
        'SELECT COUNT(*) AS count FROM (SELECT source,source_id FROM titles GROUP BY source,source_id HAVING COUNT(*)>1)',
      )
      .get(),
    duplicateEpisodeSourceIds: db
      .prepare(
        'SELECT COUNT(*) AS count FROM (SELECT title_id,source_id FROM episodes GROUP BY title_id,source_id HAVING COUNT(*)>1)',
      )
      .get(),
    duplicateMappings: db
      .prepare(
        'SELECT COUNT(*) AS count FROM (SELECT version_id,provider_id,source_mapping_id FROM episode_provider_mappings GROUP BY version_id,provider_id,source_mapping_id HAVING COUNT(*)>1)',
      )
      .get(),
    titlesWithoutEpisodes: db
      .prepare(
        'SELECT COUNT(*) AS count FROM titles t WHERE NOT EXISTS (SELECT 1 FROM episodes e WHERE e.title_id=t.id)',
      )
      .get(),
    episodesWithoutVersions: db
      .prepare(
        'SELECT COUNT(*) AS count FROM episodes e WHERE NOT EXISTS (SELECT 1 FROM episode_versions v WHERE v.episode_id=e.id)',
      )
      .get(),
    versionsWithoutMappings: db
      .prepare(
        'SELECT COUNT(*) AS count FROM episode_versions v WHERE NOT EXISTS (SELECT 1 FROM episode_provider_mappings m WHERE m.version_id=v.id)',
      )
      .get(),
    verifiedEmptyEpisodeInventories: db
      .prepare(
        "SELECT COUNT(DISTINCT entity_id) AS count FROM verification_observations WHERE entity_type='title' AND result='empty_episode_inventory'",
      )
      .get(),
    verifiedEmptyProviderInventories: db
      .prepare(
        "SELECT COUNT(DISTINCT entity_id) AS count FROM verification_observations WHERE entity_type='episode' AND result='empty_provider_inventory'",
      )
      .get(),
    aliases: db.prepare('SELECT COUNT(*) AS count FROM title_aliases').get(),
    genres: db.prepare('SELECT COUNT(*) AS count FROM genres').get(),
    relatedTitles: db.prepare('SELECT COUNT(*) AS count FROM related_titles').get(),
    unresolvedRelatedTitles: db
      .prepare('SELECT COUNT(*) AS count FROM related_titles WHERE related_title_id IS NULL')
      .get(),
    invalidCanonicalUrls: db
      .prepare(
        `SELECT COUNT(*) AS count FROM titles
          WHERE canonical_url NOT LIKE 'https://%'
            OR (source='anikoto' AND canonical_url NOT LIKE 'https://anikototv.to/watch/%')
            OR (source='tvmaze' AND canonical_url NOT LIKE 'https://www.tvmaze.com/shows/%')`,
      )
      .get(),
  };
  const samples = {
    linkedRelatedTitle:
      db
        .prepare(
          `SELECT source.slug AS sourceSlug,source.name AS sourceName,target.slug AS relatedSlug,target.name AS relatedName,rt.relationship_type AS relationshipType
      FROM related_titles rt JOIN titles source ON source.id=rt.title_id JOIN titles target ON target.id=rt.related_title_id
      ORDER BY source.name,target.name LIMIT 1`,
        )
        .get() ?? null,
    titlesWithoutEpisodes: db
      .prepare(
        `SELECT source_id AS sourceId,slug,name,availability_state AS availability,last_successful_import_at AS lastSuccessfulImport
      FROM titles t WHERE NOT EXISTS (SELECT 1 FROM episodes e WHERE e.title_id=t.id) ORDER BY name LIMIT 20`,
      )
      .all(),
    unresolvedRelatedTitles: db
      .prepare(
        `SELECT rt.related_source_id AS sourceId,rt.relationship_type AS relationshipType,rt.label
      FROM related_titles rt WHERE rt.related_title_id IS NULL ORDER BY rt.last_seen_at DESC LIMIT 20`,
      )
      .all(),
  };
  const ok =
    (integrity as Array<{ integrity_check?: string }>).every(
      (row) => row.integrity_check === 'ok',
    ) &&
    foreignKeys.length === 0 &&
    Object.entries(checks)
      .filter(([name]) => name.startsWith('duplicate') || name === 'invalidCanonicalUrls')
      .every(([, value]) => Number((value as { count: number }).count) === 0);
  console.log(
    JSON.stringify(
      {
        ok,
        integrity,
        foreignKeyViolations: foreignKeys,
        checks,
        samples,
        status: adminStatus(db),
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
} finally {
  db.close();
}
