import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { REMOW_PUBLISHER, OFFICIAL_YOUTUBE_PROVIDER_ID } from '../providers/youtubeOfficial.ts';
import { OFFICIAL_YOUTUBE_EPISODE_APPROVALS } from './youtubeOfficial.ts';
import {
  validateOfficialPublisherSource,
  inferEpisodeLanguage,
  isEpisodePackOrRange,
  type OfficialPublisherSource,
  type OfficialYouTubeReviewCandidate,
} from './youtubeOfficialDiscovery.ts';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

export interface OfficialYouTubeApprovalLedgerEntry {
  candidateId: string;
  sourceId: string;
  videoId: string;
  channelId: string;
  title: string;
  durationSeconds: number | null;
  availability: string | null;
  availableInUnitedStates: boolean;
  matchMethod: string | null;
  titleId: number | null;
  episodeId: number | null;
  versionId: number | null;
  language: string | null;
  decision: 'eligible' | 'hold';
  reasonCodes: string[];
  evidenceHash: string;
}

export interface OfficialYouTubeBatchApprovalPlan {
  version: 1;
  evaluatedAt: string;
  inputManualReviewCandidates: number;
  eligibleCount: number;
  heldCount: number;
  reasonCounts: Record<string, number>;
  rightsDisposition: 'reference-only-pending-explicit-approval';
  autoApplied: false;
  entries: OfficialYouTubeApprovalLedgerEntry[];
}

function exactCrosswalk(db: DatabaseSync, candidate: OfficialYouTubeReviewCandidate): { count: number; language: string | null } {
  const match = candidate.match;
  if (!match?.episodeId || !match.versionId || !match.episodeSourceId || !match.versionSourceId) return { count: 0, language: null };
  const rows = db.prepare(`SELECT v.language
    FROM titles t
    JOIN episodes e ON e.title_id=t.id
    JOIN episode_versions v ON v.episode_id=e.id
    WHERE t.source='anikoto' AND t.id=? AND t.source_id=?
      AND e.id=? AND e.source_id=? AND v.id=? AND v.source_id=?`).all(
        match.titleId,
        match.titleSourceId,
        match.episodeId,
        match.episodeSourceId,
        match.versionId,
        match.versionSourceId,
      ) as Array<{ language: string }>;
  return { count: rows.length, language: rows.length === 1 ? rows[0].language : null };
}

function existingResourceCount(db: DatabaseSync, videoId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM (
    SELECT id FROM episode_provider_mappings
      WHERE provider_id=? AND (provider_resource_id=? OR source_mapping_id=?)
    UNION ALL
    SELECT mapping_id AS id FROM native_resources
      WHERE provider_id=? AND resource_id=?
  )`).get(
    OFFICIAL_YOUTUBE_PROVIDER_ID,
    videoId,
    `youtube:${videoId}`,
    OFFICIAL_YOUTUBE_PROVIDER_ID,
    videoId,
  ) as { count: number };
  return row.count;
}

function evidenceHash(candidate: OfficialYouTubeReviewCandidate): string {
  return createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
}

export function planOfficialYouTubeBatchApprovals(
  db: DatabaseSync,
  candidates: OfficialYouTubeReviewCandidate[],
  sources: OfficialPublisherSource[],
  evaluatedAt = new Date().toISOString(),
  enabledPublisherChannels: ReadonlySet<string> = new Set([REMOW_PUBLISHER.channelId]),
): OfficialYouTubeBatchApprovalPlan {
  if (!Number.isFinite(Date.parse(evaluatedAt))) throw new Error('INVALID_EVALUATION_TIME');
  const bySource = new Map<string, OfficialPublisherSource>();
  for (const source of sources) {
    validateOfficialPublisherSource(source);
    if (bySource.has(source.id)) throw new Error(`DUPLICATE_SOURCE:${source.id}`);
    bySource.set(source.id, source);
  }
  const manual = candidates.filter((candidate) => candidate.decision === 'manual-review');
  const videoCounts = new Map<string, number>();
  const targetCounts = new Map<string, number>();
  for (const candidate of manual) {
    videoCounts.set(candidate.video.videoId, (videoCounts.get(candidate.video.videoId) ?? 0) + 1);
    if (candidate.match?.versionId) targetCounts.set(String(candidate.match.versionId), (targetCounts.get(String(candidate.match.versionId)) ?? 0) + 1);
  }
  const entries = manual.map((candidate): OfficialYouTubeApprovalLedgerEntry => {
    const reasons: string[] = [];
    const source = bySource.get(candidate.sourceId);
    if (!source) reasons.push('unconfigured-publisher-source');
    else {
      if (!enabledPublisherChannels.has(source.channelId)) reasons.push('publisher-not-enabled-by-player-policy');
      if (!source.evidenceUrls.length || !source.evidenceUrls.every((url) => candidate.evidenceUrls.includes(url)))
        reasons.push('publisher-evidence-missing');
      if (candidate.channelId !== source.channelId || candidate.video.channelId !== source.channelId || candidate.probe?.channelId !== source.channelId)
        reasons.push('publisher-channel-identity-mismatch');
    }
    if (!VIDEO_ID.test(candidate.video.videoId) || !CHANNEL_ID.test(candidate.channelId)) reasons.push('unstable-youtube-identity');
    const duration = candidate.probe?.durationSeconds ?? candidate.video.durationSeconds;
    if (!candidate.fullEpisodeCandidate || !duration || duration < 15 * 60) reasons.push('not-verified-full-episode-duration');
    if (candidate.probe?.availability !== 'playable' || candidate.probe.playableInEmbed !== true) reasons.push('embed-not-playable');
    const availableInUnitedStates = candidate.probe?.availableCountries.includes('US') ?? false;
    if (!availableInUnitedStates) reasons.push('us-availability-unconfirmed');
    if (candidate.parsedEpisode?.kind !== 'regular' || !Number.isSafeInteger(candidate.parsedEpisode.number) || Number(candidate.parsedEpisode.number) < 1)
      reasons.push('not-exact-single-regular-episode');
    if (isEpisodePackOrRange(candidate.video.title)) reasons.push('episode-pack-range-recap-or-binge');
    if (!candidate.match?.versionId || !candidate.match.episodeId) reasons.push('catalogue-crosswalk-incomplete');
    const configuredMapping = source?.authoritativeMappings?.find((mapping) => mapping.videoId === candidate.video.videoId);
    const reviewedApproval = OFFICIAL_YOUTUBE_EPISODE_APPROVALS.find((approval) => approval.video.id === candidate.video.videoId);
    const reviewedApprovalMatches = !!reviewedApproval
      && reviewedApproval.catalogue.titleSourceId === candidate.match?.titleSourceId
      && reviewedApproval.catalogue.episodeSourceId === candidate.match?.episodeSourceId
      && reviewedApproval.catalogue.versionSourceId === candidate.match?.versionSourceId
      && reviewedApproval.catalogue.language === candidate.match?.language
      && reviewedApproval.video.channelId === candidate.channelId
      && reviewedApproval.video.title === candidate.video.title;
    if (!reviewedApprovalMatches) {
      if (candidate.match?.method === 'exact-alias') reasons.push('exact-alias-requires-independent-evidence');
      else if (candidate.match?.method !== 'authoritative') reasons.push('non-authoritative-match-held');
    }
    if (candidate.match?.method === 'authoritative' && (!configuredMapping
      || configuredMapping.titleSourceId !== candidate.match.titleSourceId
      || configuredMapping.episodeSourceId !== candidate.match.episodeSourceId
      || configuredMapping.versionSourceId !== candidate.match.versionSourceId
      || configuredMapping.language !== candidate.match.language))
      reasons.push('authoritative-evidence-crosswalk-mismatch');
    if (!reviewedApprovalMatches)
      reasons.push('reviewed-approval-record-missing-or-mismatched');
    const crosswalk = exactCrosswalk(db, candidate);
    if (crosswalk.count !== 1) reasons.push('catalogue-crosswalk-not-unique');
    if (!candidate.match?.language || crosswalk.language !== candidate.match.language
      || !source || inferEpisodeLanguage(candidate.video.title, source.defaultLanguage) !== candidate.match.language)
      reasons.push('language-version-incompatible');
    if ((videoCounts.get(candidate.video.videoId) ?? 0) !== 1) reasons.push('duplicate-video-candidate');
    if (candidate.match?.versionId && (targetCounts.get(String(candidate.match.versionId)) ?? 0) !== 1) reasons.push('duplicate-version-candidate');
    if (existingResourceCount(db, candidate.video.videoId) > 0) reasons.push('existing-official-youtube-duplicate');
    const reasonCodes = [...new Set(reasons)].sort();
    return {
      candidateId: candidate.candidateId,
      sourceId: candidate.sourceId,
      videoId: candidate.video.videoId,
      channelId: candidate.channelId,
      title: candidate.video.title,
      durationSeconds: duration ?? null,
      availability: candidate.probe?.availability ?? null,
      availableInUnitedStates,
      matchMethod: candidate.match?.method ?? null,
      titleId: candidate.match?.titleId ?? null,
      episodeId: candidate.match?.episodeId ?? null,
      versionId: candidate.match?.versionId ?? null,
      language: candidate.match?.language ?? null,
      decision: reasonCodes.length ? 'hold' : 'eligible',
      reasonCodes,
      evidenceHash: evidenceHash(candidate),
    };
  }).sort((left, right) => left.videoId.localeCompare(right.videoId) || left.sourceId.localeCompare(right.sourceId));
  const reasonCounts: Record<string, number> = {};
  for (const entry of entries) for (const reason of entry.reasonCodes) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  return {
    version: 1,
    evaluatedAt,
    inputManualReviewCandidates: entries.length,
    eligibleCount: entries.filter((entry) => entry.decision === 'eligible').length,
    heldCount: entries.filter((entry) => entry.decision === 'hold').length,
    reasonCounts: Object.fromEntries(Object.entries(reasonCounts).sort(([left], [right]) => left.localeCompare(right))),
    rightsDisposition: 'reference-only-pending-explicit-approval',
    autoApplied: false,
    entries,
  };
}
