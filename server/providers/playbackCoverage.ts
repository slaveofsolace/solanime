import type { SqliteDatabase } from '../db.ts';
import type { AvailabilityState } from '../types.ts';
import { hasSupportedMegaPlayEmbed } from './embed.ts';

type MappingRow = {
  mappingId: number;
  providerId: string;
  language: string;
  providerResourceId: string | null;
  canonicalEmbedUrl: string | null;
  availability: AvailabilityState;
  unavailableReason: string | null;
  resolutionEvidenceState: string;
  lastPlaybackVerification: string | null;
  nativeEnabled: number | null;
};

export type PlaybackCoverageAudit = {
  scope: 'mapping-structure-only';
  counts: {
    titles: number;
    episodes: number;
    versions: number;
    mappings: number;
    mappedVersions: number;
    mappedEpisodes: number;
    enabledNativeResources: number;
    guardedEmbedCandidates: number;
    playerOfferableMappings: number;
    playbackVerifiedMappings: number;
  };
  byProvider: Record<string, {
    mappings: number;
    enabledNativeResources: number;
    embedCandidates: number;
    playbackVerifiedMappings: number;
  }>;
  issues: {
    megaPlayMappingsMissingStableReference: number;
    megaPlayMappingsUnsupportedLanguage: number;
    playbackVerifiedWithoutTimestamp: number;
    enabledNativeResourcesWithoutMapping: number;
  };
  samples: {
    megaPlayMappingsMissingStableReference: Array<{
      mappingId: number;
      providerId: string;
      language: string;
      availability: string;
      resolutionEvidenceState: string;
    }>;
  };
  verdict: 'pass' | 'fail';
};

function count(db: SqliteDatabase, sql: string): number {
  return Number((db.prepare(sql).get() as { count: number }).count);
}

export function auditPlaybackCoverage(db: SqliteDatabase): PlaybackCoverageAudit {
  const rows = db
    .prepare(
      `SELECT m.id AS mappingId,m.provider_id AS providerId,v.language,
        m.provider_resource_id AS providerResourceId,m.canonical_embed_url AS canonicalEmbedUrl,
        m.availability_state AS availability,m.unavailable_reason AS unavailableReason,
        m.resolution_evidence_state AS resolutionEvidenceState,
        m.last_playback_verification_at AS lastPlaybackVerification,
        n.enabled AS nativeEnabled
      FROM episode_provider_mappings m
      JOIN episode_versions v ON v.id=m.version_id
      LEFT JOIN native_resources n ON n.mapping_id=m.id AND n.enabled=1`,
    )
    .all() as MappingRow[];

  let guardedEmbedCandidates = 0;
  let enabledNativeResources = 0;
  let playbackVerifiedMappings = 0;
  const byProvider: PlaybackCoverageAudit['byProvider'] = {};
  const missingMegaPlayReference: MappingRow[] = [];
  let unsupportedMegaPlayLanguage = 0;

  for (const row of rows) {
    const provider = byProvider[row.providerId] ??= {
      mappings: 0,
      enabledNativeResources: 0,
      embedCandidates: 0,
      playbackVerifiedMappings: 0,
    };
    provider.mappings += 1;
    if (row.nativeEnabled === 1) enabledNativeResources += 1;
    if (row.nativeEnabled === 1) provider.enabledNativeResources += 1;
    if (row.lastPlaybackVerification) playbackVerifiedMappings += 1;
    if (row.lastPlaybackVerification) provider.playbackVerifiedMappings += 1;
    const guardedEmbed = hasSupportedMegaPlayEmbed(row);
    if (guardedEmbed) guardedEmbedCandidates += 1;
    if (guardedEmbed) provider.embedCandidates += 1;
    if (['hd-1', 'hd-2', 'vidstream-2'].includes(row.providerId) && row.nativeEnabled !== 1) {
      if (!['sub', 'dub'].includes(row.language)) {
        unsupportedMegaPlayLanguage += 1;
      } else if (!guardedEmbed) {
        missingMegaPlayReference.push(row);
      }
    }
  }

  const issues = {
    megaPlayMappingsMissingStableReference: missingMegaPlayReference.length,
    megaPlayMappingsUnsupportedLanguage: unsupportedMegaPlayLanguage,
    playbackVerifiedWithoutTimestamp: count(
      db,
      "SELECT COUNT(*) AS count FROM episode_provider_mappings WHERE resolution_evidence_state='playback_verified' AND last_playback_verification_at IS NULL",
    ),
    enabledNativeResourcesWithoutMapping: count(
      db,
      'SELECT COUNT(*) AS count FROM native_resources n LEFT JOIN episode_provider_mappings m ON m.id=n.mapping_id WHERE n.enabled=1 AND m.id IS NULL',
    ),
  };

  return {
    scope: 'mapping-structure-only',
    counts: {
      titles: count(db, 'SELECT COUNT(*) AS count FROM titles'),
      episodes: count(db, 'SELECT COUNT(*) AS count FROM episodes'),
      versions: count(db, 'SELECT COUNT(*) AS count FROM episode_versions'),
      mappings: rows.length,
      mappedVersions: count(
        db,
        'SELECT COUNT(DISTINCT version_id) AS count FROM episode_provider_mappings',
      ),
      mappedEpisodes: count(
        db,
        `SELECT COUNT(DISTINCT v.episode_id) AS count
        FROM episode_provider_mappings m JOIN episode_versions v ON v.id=m.version_id`,
      ),
      enabledNativeResources,
      guardedEmbedCandidates,
      playerOfferableMappings: enabledNativeResources + guardedEmbedCandidates,
      playbackVerifiedMappings,
    },
    byProvider: Object.fromEntries(Object.entries(byProvider).sort(([a], [b]) => a.localeCompare(b))),
    issues,
    samples: {
      megaPlayMappingsMissingStableReference: missingMegaPlayReference.slice(0, 20).map((row) => ({
        mappingId: row.mappingId,
        providerId: row.providerId,
        language: row.language,
        availability: row.availability,
        resolutionEvidenceState: row.resolutionEvidenceState,
      })),
    },
    verdict:
      issues.megaPlayMappingsMissingStableReference === 0 &&
      issues.playbackVerifiedWithoutTimestamp === 0 &&
      issues.enabledNativeResourcesWithoutMapping === 0
        ? 'pass'
        : 'fail',
  };
}
