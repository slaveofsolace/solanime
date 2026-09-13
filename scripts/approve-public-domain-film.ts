import { openDatabase, migrate } from '../server/db.ts';

// Explicit, reviewed crosswalk, not title-name matching or a generic test source.
// See docs/native-provider-evidence.md before modifying these approvals.
const db = openDatabase();
migrate(db);
const now = new Date().toISOString();
const film = db.prepare(`SELECT t.id AS titleId,e.id AS episodeId FROM titles t
  JOIN episodes e ON e.title_id=t.id WHERE t.source='anikoto' AND t.source_id='5234'
  AND t.slug='the-dull-sword-uhfkd' AND e.source_id='82453' AND e.number_text='1'`).get() as
  { titleId: number; episodeId: number } | undefined;
if (!film) throw new Error('The reviewed catalogue identifiers are absent; no records changed.');
const rightsUrl = 'https://commons.wikimedia.org/wiki/File:Kouichi_Jun%27ichi_-_Namakura_Gatana_(1917)_-_4-minute_restored_version.webm';
const sources = [
  { id: 'internet-archive', label: 'Internet Archive', hostname: 'archive.org',
    resource: 'namakura-gatana-1917', reference: 'ia:namakura-gatana-1917:restored-4m', sha1: null },
  { id: 'wikimedia-commons', label: 'Wikimedia Commons', hostname: 'commons.wikimedia.org',
    resource: "File:Kouichi_Jun'ichi_-_Namakura_Gatana_(1917)_-_4-minute_restored_version.webm",
    reference: 'commons:Q2054133:restored-4m', sha1: 'a9476751fa5544c3da009d55e7419f6af4f4d0d8' },
];
db.exec('BEGIN IMMEDIATE');
try {
  db.prepare(`INSERT INTO episode_versions(episode_id,source_id,language,version_label,audio_language,
    subtitle_language,availability_state,first_seen_at,last_seen_at,last_successful_import_at)
    VALUES(?,'wikidata:Q2054133:restored-4m','silent','Restored · silent (4 min)','zxx',NULL,'available',?,?,?)
    ON CONFLICT(episode_id,source_id,language) DO UPDATE SET last_seen_at=excluded.last_seen_at,last_successful_import_at=excluded.last_successful_import_at`)
    .run(film.episodeId, now, now, now);
  const version = db.prepare("SELECT id FROM episode_versions WHERE episode_id=? AND source_id='wikidata:Q2054133:restored-4m' AND language='silent'").get(film.episodeId) as { id: number };
  const mappings: Array<{ mappingId: number; providerId: string }> = [];
  for (const source of sources) {
    db.prepare(`INSERT INTO providers(id,label,identity_state,playback_type,adapter_state,hostname,
      capabilities_json,observed_limitation,evidence_class,first_seen_at,last_seen_at,updated_at)
      VALUES(?,?,'confirmed','direct','implemented',?,?,
      'Only explicitly reviewed public-domain editions. This silent restored edition has no captions.',
      'approved_native_resource',?,?,?) ON CONFLICT(id) DO UPDATE SET adapter_state=excluded.adapter_state,
      capabilities_json=excluded.capabilities_json,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`)
      .run(source.id, source.label, source.hostname, JSON.stringify({ seek: true, volume: true, fullscreen: true, subtitles: false, progressEvents: true, qualitySelection: false }), now, now, now);
    for (const alias of source.id === 'wikimedia-commons' ? [source.label, 'Commons'] : [source.label]) {
      db.prepare("INSERT INTO provider_aliases(provider_id,alias,alias_type) VALUES(?,?,'supported_host') ON CONFLICT(provider_id,alias) DO NOTHING").run(source.id, alias);
    }
    const connections = source.id === 'wikimedia-commons'
      ? [['commons.wikimedia.org', '/w/api.php', 'public_metadata_api'], ['upload.wikimedia.org', '/wikipedia/commons/', 'native_media_host']]
      : [['archive.org', '/metadata/', 'public_metadata_api'], ['archive.org', '/download/', 'native_media_redirect'], ['dn720400.ca.archive.org', '/', 'observed_native_media_host']];
    for (const [hostname, path, relationship] of connections) {
      db.prepare(`INSERT INTO provider_connections(provider_id,hostname,path_pattern,relationship,evidence_state,observation_scope,first_seen_at,last_seen_at)
        VALUES(?,?,?,?,'observed','Reviewed restored-silent The Dull Sword edition only; public metadata and HEAD observations, not ownership inference.',?,?)
        ON CONFLICT(provider_id,hostname,path_pattern,relationship) DO UPDATE SET last_seen_at=excluded.last_seen_at`)
        .run(source.id, hostname, path, relationship, now, now);
    }
    db.prepare(`INSERT INTO episode_provider_mappings(version_id,provider_id,source_mapping_id,provider_resource_id,
      mapping_origin,public_export_allowed,availability_state,first_seen_at,last_seen_at,last_successful_import_at,updated_at)
      VALUES(?,?,?,?,'external_mapper',1,'available',?,?,?,?)
      ON CONFLICT(version_id,provider_id,source_mapping_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,last_successful_import_at=excluded.last_successful_import_at,updated_at=excluded.updated_at`)
      .run(version.id, source.id, source.reference, source.resource, now, now, now, now);
    const mapping = db.prepare('SELECT id FROM episode_provider_mappings WHERE version_id=? AND provider_id=?').get(version.id, source.id) as { id: number };
    db.prepare(`INSERT INTO native_resources(mapping_id,provider_id,resource_id,language,edition,license,rights_evidence_url,identity_evidence_url,approved_at,enabled,content_sha1)
      VALUES(?,?,?,'silent','1917 film · restored silent edition','Public domain (Commons source and jurisdiction notices reviewed)',?,
      'https://www.wikidata.org/wiki/Q2054133',?,1,?) ON CONFLICT(mapping_id) DO UPDATE SET content_sha1=excluded.content_sha1
      WHERE native_resources.provider_id=excluded.provider_id AND native_resources.resource_id=excluded.resource_id`)
      .run(mapping.id, source.id, source.resource, rightsUrl, now, source.sha1);
    const details = JSON.stringify({ titleId: film.titleId, episodeId: film.episodeId, wikidata: 'Q2054133',
      providerId: source.id, resource: source.resource, contentSha1: source.sha1, matching: 'manual_reviewed_crosswalk',
      edition: '4-minute restored silent edition; not the original imported SUB inventory',
      originalSourceIds: { title: '5234', episode: '82453' }, evidence: 'docs/native-provider-evidence.md', playbackVerified: false });
    if (!db.prepare("SELECT 1 FROM verification_observations WHERE entity_type='mapping' AND entity_id=? AND reason_code='REVIEWED_PUBLIC_DOMAIN_EDITION'").get(String(mapping.id))) {
      db.prepare(`INSERT INTO verification_observations(entity_type,entity_id,stage,result,reason_code,evidence_class,details_json,observed_at)
        VALUES('mapping',?,'adapter_implemented','approved','REVIEWED_PUBLIC_DOMAIN_EDITION','direct_observation',?,?)`).run(String(mapping.id), details, now);
    }
    mappings.push({ mappingId: mapping.id, providerId: source.id });
  }
  db.exec('COMMIT');
  console.log(JSON.stringify({ titleId: film.titleId, episodeId: film.episodeId, versionId: version.id, language: 'silent', mappings, playbackVerified: false }));
} catch (error) { db.exec('ROLLBACK'); throw error; }
finally { db.close(); }
