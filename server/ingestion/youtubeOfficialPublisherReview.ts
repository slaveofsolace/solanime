import type { DatabaseSync } from 'node:sqlite';
import type {
  OfficialPublisherSource,
  OfficialYouTubeDiscoveryConfig,
  OfficialYouTubeReviewCandidate,
  SourceInventoryCheckpoint,
} from './youtubeOfficialDiscovery.ts';
import { normalizeAnimeTitle } from './youtubeOfficialDiscovery.ts';
import type { OfficialYouTubeBatchApprovalPlan } from './youtubeOfficialBatchApproval.ts';

export interface CatalogueExternalIdAudit {
  status: 'unavailable' | 'partial';
  tmdbRows: number;
  aniListRows: number;
  malRows: number;
  distinctTitles: number;
  reason: string;
}

export interface OfficialPublisherReview {
  version: 1;
  reviewedAt: string;
  sourceCount: number;
  inventoryCompletedSources: number;
  externalIdCrosswalk: CatalogueExternalIdAudit;
  publishers: Array<{
    sourceId: string;
    publisher: string;
    channelId: string;
    identityEvidenceUrls: string[];
    disposition: 'reference-only';
    inventory: { completed: boolean; pages: number; enumerableVideos: number; errors: string[] };
    embed: Record<string, number>;
    catalogueMatches: {
      authoritative: Array<{ videoId: string; titleId: number; episodeId: number; versionId: number; language: string }>;
      exactAlias: number;
      scoredAlias: number;
      unmatched: number;
    };
    approval: { eligible: number; held: number; heldReasons: Record<string, number> };
  }>;
  seriesApprovalProposals: OfficialSeriesApprovalProposal[];
  nonclaims: string[];
}

export interface OfficialSeriesApprovalProposal {
  seriesId: string;
  label: string;
  sourceId: string;
  publisher: string;
  channelId: string;
  identityEvidenceUrls: string[];
  language: string;
  titleId: number | null;
  titleSourceId: string | null;
  catalogueTitle: string | null;
  catalogueRegularEpisodes: number;
  observedSingleEpisodes: number[];
  missingCatalogueEpisodes: number[];
  rejectedRangeOrSpecialVideos: number;
  status: 'proposed-not-applied' | 'hold';
  heldReasons: string[];
  warnings: string[];
  matcherDisagreements: Array<{
    episodeNumber: number;
    videoId: string;
    matchMethod: string;
    issues: string[];
    found: { titleId: number; episodeId: number | null; versionId: number | null; language: string | null };
    expected: { titleId: number; episodeId: number; versionId: number; language: string };
  }>;
  entries: Array<{
    candidateId: string;
    videoId: string;
    episodeNumber: number;
    episodeId: number;
    versionId: number;
    observedAt: string;
  }>;
}

const SERIES_REVIEW_DEFINITIONS = [
  { seriesId: 'god-mars', label: 'God Mars', sourceId: 'tms-god-mars-playlist', language: 'sub', catalogueAliases: ['God Mars', 'Six God Combination Godmars'], family: /\bGOD MARS\b/i, single: /^GOD MARS\s*-\s*EP(\d{1,3})\b/i },
  { seriesId: 'after-war-gundam-x', label: 'After War Gundam X', sourceId: 'gundam-info', language: 'sub', catalogueAliases: ['After War Gundam X'], family: /\bAfter War Gundam X\b/i, single: /^After War Gundam X\s*-\s*Episode\s*(\d{1,3})\b/i },
  { seriesId: 'yakitate-japan', label: 'Yakitate!! Japan / Freshly Baked Japan', sourceId: 'remow-its-anime', language: 'sub', catalogueAliases: ['Yakitate!! Japan', 'Freshly Baked!! Ja-pan'], family: /\bYakitate!!\s*JAPAN\b/i, single: /^Full Episode\s*(\d{1,3})\s*\|\s*Yakitate!!\s*JAPAN\b/i },
  { seriesId: 'gundam-reconguista-in-g', label: 'Gundam Reconguista in G', sourceId: 'gundam-info', language: 'sub', catalogueAliases: ['Gundam Reconguista in G'], family: /\bGundam Reconguista in G\b/i, single: /^Gundam Reconguista in G\s*-\s*Episode\s*(\d{1,3})\b/i },
] as const;

export function buildOfficialSeriesApprovalProposals(
  config: OfficialYouTubeDiscoveryConfig,
  candidates: OfficialYouTubeReviewCandidate[],
  db: DatabaseSync,
): OfficialSeriesApprovalProposal[] {
  const sourceById = new Map(config.sources.map((source) => [source.id, source]));
  const catalogueAliases = db.prepare(`SELECT t.id,t.source_id AS sourceId,t.name,t.name AS alias FROM titles t WHERE t.source='anikoto'
    UNION ALL SELECT t.id,t.source_id AS sourceId,t.name,a.alias FROM titles t JOIN title_aliases a ON a.title_id=t.id WHERE t.source='anikoto'`).all() as Array<{ id: number; sourceId: string; name: string; alias: string }>;
  return SERIES_REVIEW_DEFINITIONS.map((definition) => {
    const source = sourceById.get(definition.sourceId);
    if (!source) throw new Error(`MISSING_SERIES_SOURCE:${definition.sourceId}`);
    const family = candidates.filter((candidate) => candidate.sourceId === definition.sourceId && definition.family.test(candidate.video.title));
    const rejectedRangeOrSpecialVideos = new Set(family.filter((candidate) => !definition.single.test(candidate.video.title)).map((candidate) => candidate.video.videoId)).size;
    const selected = [...new Map(family.flatMap((candidate) => {
      const match = definition.single.exec(candidate.video.title);
      return match ? [[candidate.video.videoId, { candidate, episodeNumber: Number(match[1]) }] as const] : [];
    })).values()].sort((left, right) => left.episodeNumber - right.episodeNumber || left.candidate.video.videoId.localeCompare(right.candidate.video.videoId));
    const reasons = new Set<string>();
    const warnings = new Set<string>();
    const matcherDisagreements: OfficialSeriesApprovalProposal['matcherDisagreements'] = [];
    if (!source.evidenceUrls.length) reasons.add('publisher-identity-evidence-missing');
    if (!selected.length) reasons.add('no-single-episode-videos');
    const acceptedAliases = new Set(definition.catalogueAliases.map(normalizeAnimeTitle));
    const matchingTitles = new Map(catalogueAliases.filter((row) => acceptedAliases.has(normalizeAnimeTitle(row.alias))).map((row) => [row.id, { id: row.id, sourceId: row.sourceId, name: row.name }]));
    if (matchingTitles.size !== 1) reasons.add('catalogue-title-not-unique');
    const title = matchingTitles.size === 1 ? [...matchingTitles.values()][0] : undefined;
    const titleId = title?.id ?? null;
    const catalogueRows = titleId ? db.prepare(`SELECT e.id AS episodeId,e.number_sort AS numberSort,e.episode_type AS episodeType,v.id AS versionId,v.language
      FROM episodes e JOIN episode_versions v ON v.episode_id=e.id WHERE e.title_id=? ORDER BY e.number_sort,e.id,v.id`).all(titleId) as Array<{ episodeId: number; numberSort: number | null; episodeType: string; versionId: number; language: string }> : [];
    const regularNumbers = [...new Set(catalogueRows.filter((row) => row.episodeType === 'regular' && Number.isFinite(row.numberSort)).map((row) => row.numberSort!))].sort((left, right) => left - right);
    const episodeOwners = new Map<number, string>();
    const entries: OfficialSeriesApprovalProposal['entries'] = [];
    for (const { candidate, episodeNumber } of selected) {
      const match = candidate.match;
      if (!Number.isSafeInteger(episodeNumber) || episodeNumber < 1) reasons.add('invalid-episode-number');
      if (!candidate.fullEpisodeCandidate || (candidate.probe?.durationSeconds ?? candidate.video.durationSeconds ?? 0) < 15 * 60) reasons.add('not-full-episode');
      if (candidate.channelId !== source.channelId || candidate.video.channelId !== source.channelId || candidate.probe?.channelId !== source.channelId) reasons.add('publisher-channel-mismatch');
      if (candidate.probe?.availability !== 'playable' || candidate.probe.playableInEmbed !== true) reasons.add('embed-not-playable');
      if (!candidate.probe?.availableCountries.includes('US')) reasons.add('not-observed-in-us');
      const catalogueMatches = catalogueRows.filter((row) => row.numberSort === episodeNumber && row.episodeType === 'regular' && row.language === definition.language);
      if (catalogueMatches.length !== 1) reasons.add('catalogue-episode-version-not-unique');
      const catalogue = catalogueMatches.length === 1 ? catalogueMatches[0] : undefined;
      const matcherIssues: string[] = [];
      if (match?.titleId && match.titleId !== titleId) matcherIssues.push('title');
      if (catalogue && match?.episodeId && (match.episodeId !== catalogue.episodeId || match.versionId !== catalogue.versionId || match.language !== definition.language)) matcherIssues.push('episode-version');
      if (catalogue && match && matcherIssues.length > 0) {
        if (match.method === 'authoritative') reasons.add('authoritative-matcher-disagreement');
        else warnings.add('non-authoritative-matcher-disagreement-ignored');
        matcherDisagreements.push({
          episodeNumber,
          videoId: candidate.video.videoId,
          matchMethod: match.method,
          issues: matcherIssues,
          found: { titleId: match.titleId, episodeId: match.episodeId ?? null, versionId: match.versionId ?? null, language: match.language ?? null },
          expected: { titleId: titleId!, episodeId: catalogue.episodeId, versionId: catalogue.versionId, language: definition.language },
        });
      }
      const prior = episodeOwners.get(episodeNumber);
      if (prior && prior !== candidate.video.videoId) reasons.add('duplicate-video-for-episode');
      else episodeOwners.set(episodeNumber, candidate.video.videoId);
      const duplicate = catalogue ? db.prepare("SELECT 1 FROM episode_provider_mappings WHERE version_id=? AND provider_id='youtube-official' AND provider_resource_id=? LIMIT 1").get(catalogue.versionId, candidate.video.videoId) : undefined;
      if (duplicate) reasons.add('existing-official-youtube-duplicate');
      if (candidate.probe && catalogue) entries.push({ candidateId: candidate.candidateId, videoId: candidate.video.videoId, episodeNumber, episodeId: catalogue.episodeId, versionId: catalogue.versionId, observedAt: candidate.probe.observedAt });
    }
    const observedSingleEpisodes = [...episodeOwners.keys()].sort((left, right) => left - right);
    const missingCatalogueEpisodes = regularNumbers.filter((number) => !episodeOwners.has(number));
    const status = reasons.size === 0 ? 'proposed-not-applied' : 'hold';
    return {
      seriesId: definition.seriesId,
      label: definition.label,
      sourceId: definition.sourceId,
      publisher: source.publisher,
      channelId: source.channelId,
      identityEvidenceUrls: [...source.evidenceUrls],
      language: definition.language,
      titleId: title?.id ?? null,
      titleSourceId: title?.sourceId ?? null,
      catalogueTitle: title?.name ?? null,
      catalogueRegularEpisodes: regularNumbers.length,
      observedSingleEpisodes,
      missingCatalogueEpisodes,
      rejectedRangeOrSpecialVideos,
      status,
      heldReasons: [...reasons].sort(),
      warnings: [...warnings].sort(),
      matcherDisagreements,
      entries: status === 'proposed-not-applied' ? entries : [],
    };
  });
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  if (!/^[a-z_]+$/i.test(table)) throw new Error('INVALID_TABLE_NAME');
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

export function auditCatalogueExternalIds(db: DatabaseSync): CatalogueExternalIdAudit {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name));
  const titleColumns = tables.has('titles') ? tableColumns(db, 'titles') : [];
  const tmdbColumn = titleColumns.find((column) => /^tmdb(?:_id)?$/i.test(column));
  let tmdbRows = 0;
  if (tmdbColumn) tmdbRows = Number((db.prepare(`SELECT COUNT(*) AS count FROM titles WHERE ${tmdbColumn} IS NOT NULL`).get() as { count: number }).count);
  let aniListRows = 0;
  let malRows = 0;
  let distinctTitles = 0;
  if (tables.has('artwork_matches')) {
    const columns = new Set(tableColumns(db, 'artwork_matches'));
    const reviewedFilter = columns.has('review_status') ? " AND review_status='approved'" : '';
    if (columns.has('media_id')) aniListRows = Number((db.prepare(`SELECT COUNT(*) AS count FROM artwork_matches WHERE media_id IS NOT NULL${reviewedFilter}`).get() as { count: number }).count);
    if (columns.has('mal_id')) malRows = Number((db.prepare(`SELECT COUNT(*) AS count FROM artwork_matches WHERE mal_id IS NOT NULL${reviewedFilter}`).get() as { count: number }).count);
    if (columns.has('title_id')) distinctTitles = Number((db.prepare(`SELECT COUNT(DISTINCT title_id) AS count FROM artwork_matches WHERE 1=1${reviewedFilter}`).get() as { count: number }).count);
  }
  const available = tmdbRows + aniListRows + malRows > 0;
  return {
    status: available ? 'partial' : 'unavailable',
    tmdbRows,
    aniListRows,
    malRows,
    distinctTitles,
    reason: available
      ? 'Only populated, approved identifier rows may be used; names never create external identifiers.'
      : 'The catalogue has no populated and approved TMDB, AniList, or MAL identifier evidence; fuzzy names cannot create an authoritative crosswalk.',
  };
}

function increments(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

export function buildOfficialPublisherReview(
  config: OfficialYouTubeDiscoveryConfig,
  inventories: ReadonlyMap<string, SourceInventoryCheckpoint>,
  candidates: OfficialYouTubeReviewCandidate[],
  approval: OfficialYouTubeBatchApprovalPlan,
  externalIdCrosswalk: CatalogueExternalIdAudit,
  reviewedAt = new Date().toISOString(),
  seriesApprovalProposals: OfficialSeriesApprovalProposal[] = [],
): OfficialPublisherReview {
  if (!Number.isFinite(Date.parse(reviewedAt))) throw new Error('INVALID_REVIEW_TIME');
  const publishers = config.sources.map((source: OfficialPublisherSource) => {
    const inventory = inventories.get(source.id);
    if (!inventory) throw new Error(`MISSING_SOURCE_INVENTORY:${source.id}`);
    const sourceCandidates = candidates.filter((candidate) => candidate.sourceId === source.id);
    const entries = approval.entries.filter((entry) => entry.sourceId === source.id);
    const authoritative = sourceCandidates.flatMap((candidate) => {
      const match = candidate.match;
      if (match?.method !== 'authoritative' || !match.episodeId || !match.versionId) return [];
      return [{ videoId: candidate.video.videoId, titleId: match.titleId, episodeId: match.episodeId, versionId: match.versionId, language: match.language }];
    }).sort((left, right) => left.videoId.localeCompare(right.videoId));
    return {
      sourceId: source.id,
      publisher: source.publisher,
      channelId: source.channelId,
      identityEvidenceUrls: [...source.evidenceUrls],
      disposition: source.disposition,
      inventory: {
        completed: inventory.completed,
        pages: inventory.pages,
        enumerableVideos: Object.keys(inventory.videos).length,
        errors: [...new Set(inventory.errors.map((error) => error.code))].sort(),
      },
      embed: increments(sourceCandidates.map((candidate) => candidate.probe?.availability ?? 'not-probed')),
      catalogueMatches: {
        authoritative,
        exactAlias: sourceCandidates.filter((candidate) => candidate.match?.method === 'exact-alias').length,
        scoredAlias: sourceCandidates.filter((candidate) => candidate.match?.method === 'scored-alias').length,
        unmatched: sourceCandidates.filter((candidate) => !candidate.match).length,
      },
      approval: {
        eligible: entries.filter((entry) => entry.decision === 'eligible').length,
        held: entries.filter((entry) => entry.decision === 'hold').length,
        heldReasons: increments(entries.flatMap((entry) => entry.reasonCodes)),
      },
    };
  });
  return {
    version: 1,
    reviewedAt,
    sourceCount: config.sources.length,
    inventoryCompletedSources: publishers.filter((source) => source.inventory.completed).length,
    externalIdCrosswalk,
    publishers,
    seriesApprovalProposals,
    nonclaims: [
      'Publisher identity does not grant Solanime a reusable licence.',
      'Embed availability is an observation, not proof that media progressed.',
      'Exact and scored aliases remain non-authoritative without independent identifier evidence.',
      'Series proposals are deterministic report-only crosswalks and do not approve playback or establish reuse rights.',
      'This report does not enable playback policies or mutate the canonical catalogue.',
    ],
  };
}
