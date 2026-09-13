import { adminStatus } from '../../server/catalogue.ts';
import { currentSchemaVersion, type SqliteDatabase } from '../../server/db.ts';

/** Publication metadata is an allowlist, not a copy of the restricted diagnostics API. */
export function publicExportManifest(db: SqliteDatabase, exportedAt = new Date().toISOString()) {
  const { counts, coverage, taskStages } = adminStatus(db);
  const mappingCoverage = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN mapping_origin='native' THEN 1 ELSE 0 END),0) AS sourceMappings,
    COALESCE(SUM(CASE WHEN mapping_origin='external_mapper' THEN 1 ELSE 0 END),0) AS externalMappings,
    COALESCE(SUM(CASE WHEN last_playback_verification_at IS NOT NULL THEN 1 ELSE 0 END),0) AS playbackVerifiedMappings
    FROM episode_provider_mappings`).get();
  const providers = db.prepare(`SELECT p.id,p.label,p.adapter_state AS adapterState,
    COUNT(m.id) AS mappingCount,
    SUM(CASE WHEN m.last_playback_verification_at IS NOT NULL THEN 1 ELSE 0 END) AS verifiedMappingCount,
    MAX(m.last_successful_resolution_at) AS lastSuccessfulResolution,
    MAX(m.last_playback_verification_at) AS lastPlaybackVerification
    FROM providers p LEFT JOIN episode_provider_mappings m ON m.provider_id=p.id GROUP BY p.id ORDER BY p.id`).all();
  return {
    schemaVersion: currentSchemaVersion(db), exportSchemaVersion: 1, exportedAt,
    files: ['catalogue.json', 'catalogue.csv', 'coverage.csv'],
    scope: 'Local catalogue coverage, not the current hosted import cursor. Playback verification applies only to the individually recorded mappings, not every mapping or provider.',
    status: { counts, mappingCoverage, coverage, taskStages, providers },
  };
}
