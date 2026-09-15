import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AdaptiveRequestScheduler,
  PublicYouTubeMetadataClient,
  loadOfficialYouTubeCatalogue,
  type OfficialPublisherSource,
  type OfficialYouTubeDiscoveryConfig,
  type SourceInventoryCheckpoint,
  type YouTubeVideoProbe,
} from '../server/ingestion/youtubeOfficialDiscovery.ts';
import {
  NOZOMI_CHANNEL_ID,
  NOZOMI_CHANNEL_URL,
  NOZOMI_PUBLISHER_EVIDENCE_URLS,
  NOZOMI_PUBLISHER_LABEL,
  NOZOMI_SERIES_CROSSWALKS,
  reviewNozomiEpisode,
  type NozomiOEmbedObservation,
  type NozomiReviewEntry,
} from '../server/ingestion/youtubeOfficialNozomiReview.ts';

const root = resolve(import.meta.dirname, '..');
const canonicalDatabase = resolve(root, 'data', 'solanime.sqlite').toLowerCase();
const option = (name: string): string | undefined => process.argv.slice(2)
  .find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const required = (name: string): string => {
  const value = option(name)?.trim();
  if (!value) throw new Error(`MISSING_${name.toUpperCase().replaceAll('-', '_')}`);
  return value;
};
const positiveInteger = (name: string, fallback: number, maximum: number): number => {
  const value = Number(option(name) ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`INVALID_${name.toUpperCase().replaceAll('-', '_')}`);
  return value;
};
const positiveNumber = (name: string, fallback: number, maximum: number): number => {
  const value = Number(option(name) ?? fallback);
  if (!Number.isFinite(value) || value <= 0 || value > maximum) throw new Error(`INVALID_${name.toUpperCase().replaceAll('-', '_')}`);
  return value;
};

const databasePath = resolve(required('database'));
const inventoryPath = resolve(required('inventory'));
const configPath = resolve(required('config'));
const outputDirectory = resolve(required('out'));
const concurrency = positiveInteger('concurrency', 4, 8);
const requestsPerSecond = positiveNumber('requests-per-second', 4, 4);
const probeBudget = positiveInteger('probe-budget', 2_000, 5_000);
const observationRegion = option('observation-region')?.trim() || 'runtime-network';

for (const path of [databasePath, inventoryPath, configPath]) if (!existsSync(path)) throw new Error(`INPUT_NOT_FOUND:${path}`);
if (databasePath.toLowerCase() === canonicalDatabase) throw new Error('CANONICAL_CATALOGUE_REFUSED');
const relativeOutput = relative(root, outputDirectory);
if (!relativeOutput.startsWith('..') && !isAbsolute(relativeOutput)) throw new Error('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
if (existsSync(outputDirectory)) throw new Error('OUTPUT_DIRECTORY_ALREADY_EXISTS');

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const config = readJson<OfficialYouTubeDiscoveryConfig>(configPath);
const source = config.sources.find((item) => item.id === 'nozomi-entertainment');
if (!source || source.channelId !== NOZOMI_CHANNEL_ID || source.channelUrl !== NOZOMI_CHANNEL_URL)
  throw new Error('NOZOMI_SOURCE_IDENTITY_MISMATCH');
if (source.disposition !== 'reference-only') throw new Error('NOZOMI_SOURCE_MUST_REMAIN_REFERENCE_ONLY');
const inventory = readJson<SourceInventoryCheckpoint>(inventoryPath);
if (!inventory.completed || inventory.sourceId !== source.id) throw new Error('NOZOMI_INVENTORY_INCOMPLETE_OR_WRONG_SOURCE');

const database = new DatabaseSync(databasePath, { readOnly: true });
const catalogue = loadOfficialYouTubeCatalogue(database);
database.close();

const listedEpisodes = Object.values(inventory.videos)
  .filter((video) => (video.durationSeconds ?? 0) >= 15 * 60 && /\bEpisode\b/i.test(video.title))
  .sort((left, right) => left.videoId.localeCompare(right.videoId));
const staticEntries = listedEpisodes.map((video) => reviewNozomiEpisode({ video, catalogue, runtimeRequired: false }));
const probeTargets = staticEntries
  .filter((entry) => entry.identity && entry.reasonCodes.length === 0)
  .slice(0, probeBudget);
const videosById = new Map(listedEpisodes.map((video) => [video.videoId, video]));

const scheduler = new AdaptiveRequestScheduler({
  globalConcurrency: concurrency,
  perHostConcurrency: concurrency,
  requestsPerSecond,
  burst: concurrency,
  circuitFailures: 8,
  circuitCooldownMs: 30_000,
});
let playerRequestCount = 0;
let oEmbedRequestCount = 0;
const client = new PublicYouTubeMetadataClient({
  scheduler,
  maxAttempts: 3,
  timeoutMs: 20_000,
  maxResponseBytes: 12 * 1024 * 1024,
  observationRegion,
  retryCapMs: 30_000,
  onRequest: () => { playerRequestCount += 1; },
});

async function boundedText(response: Response, maximumBytes: number): Promise<string> {
  const announced = Number(response.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > maximumBytes) {
    await response.body?.cancel();
    throw new Error('RESPONSE_TOO_LARGE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('EMPTY_RESPONSE');
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error('RESPONSE_TOO_LARGE');
    }
    parts.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function checkOEmbed(videoId: string): Promise<NozomiOEmbedObservation> {
  const checkedAt = new Date().toISOString();
  const endpoint = new URL('https://www.youtube.com/oembed');
  endpoint.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`);
  endpoint.searchParams.set('format', 'json');
  oEmbedRequestCount += 1;
  try {
    const text = await scheduler.run(endpoint.hostname, async () => {
      const response = await fetch(endpoint, {
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 SolanimeOfficialMetadata/1.0' },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP_${response.status}`);
      }
      return boundedText(response, 64 * 1024);
    });
    const value = JSON.parse(text) as Record<string, unknown>;
    const standard = value.type === 'video'
      && value.provider_name === 'YouTube'
      && typeof value.html === 'string'
      && value.html.includes(`/embed/${videoId}`);
    return {
      result: standard ? 'standard-embed-returned' : 'schema-mismatch',
      checkedAt,
      title: typeof value.title === 'string' ? value.title : null,
      authorName: typeof value.author_name === 'string' ? value.author_name : null,
      authorUrl: typeof value.author_url === 'string' ? value.author_url : null,
    };
  } catch (error) {
    return {
      result: 'unavailable',
      checkedAt,
      title: null,
      authorName: null,
      authorUrl: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function unavailableProbe(videoId: string, error: unknown): YouTubeVideoProbe {
  return {
    videoId,
    title: null,
    channelId: null,
    channelLabel: null,
    durationSeconds: null,
    publishDate: null,
    availability: 'unknown',
    playableInEmbed: null,
    reason: error instanceof Error ? error.message : String(error),
    observedAt: new Date().toISOString(),
    observationRegion,
    availableCountries: [],
  };
}

const runtimeEntries = new Map<string, NozomiReviewEntry>();
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, probeTargets.length || 1) }, async () => {
  for (;;) {
    const target = probeTargets[cursor++];
    if (!target) return;
    const video = videosById.get(target.videoId)!;
    let probe: YouTubeVideoProbe;
    try {
      probe = await client.probe(video.videoId);
    } catch (error) {
      probe = unavailableProbe(video.videoId, error);
    }
    const oEmbed = probe.availability === 'playable'
      && probe.playableInEmbed !== false
      && probe.channelId === NOZOMI_CHANNEL_ID
      ? await checkOEmbed(video.videoId)
      : null;
    runtimeEntries.set(video.videoId, reviewNozomiEpisode({ video, catalogue, probe, oEmbed }));
  }
}));

const entries = staticEntries.map((entry) => runtimeEntries.get(entry.videoId) ?? entry)
  .sort((left, right) => left.videoId.localeCompare(right.videoId));
const passes = entries.filter((entry) => entry.disposition === 'pass');
const holds = entries.filter((entry) => entry.disposition === 'hold');
const holdReasons: Record<string, number> = {};
for (const entry of holds) for (const reason of entry.reasonCodes)
  holdReasons[reason] = (holdReasons[reason] ?? 0) + 1;
const observedAvailability: Record<string, number> = {};
for (const entry of runtimeEntries.values()) {
  const availability = entry.probe?.availability ?? 'not-probed';
  observedAvailability[availability] = (observedAvailability[availability] ?? 0) + 1;
}
const generatedAt = new Date().toISOString();
const report = {
  version: 1,
  generatedAt,
  decision: passes.length ? 'PASS' : 'HOLD',
  candidateAndCurrentStage: 'Nozomi Entertainment official YouTube exact catalogue crosswalk; runtime-proof candidates remain report-only pending separate approval.',
  why: passes.length
    ? 'At least one upload satisfied the explicit series/season/format crosswalk, exact episode and language version, current publisher player identity, current ordinary embed playability, and current oEmbed publisher check.'
    : 'No upload satisfied every exact identity, language, availability, ordinary embed, and publisher gate in the current observation.',
  resourceBrief: {
    function: 'Map exact Solanime episodes to current Nozomi Entertainment publisher-operated ordinary YouTube embeds.',
    allowedSource: NOZOMI_CHANNEL_URL,
    forbidden: ['media download', 'URL extraction', 'proxying', 'region bypass', 'login or age-gate bypass', 'DRM bypass', 'source relabeling'],
    runtime: 'YouTube privacy-enhanced iframe player with normal YouTube controls and attribution.',
  },
  publisherIdentity: {
    publisher: 'Nozomi Entertainment / Right Stuf / Crunchyroll',
    currentYouTubeLabelRequired: NOZOMI_PUBLISHER_LABEL,
    channelId: NOZOMI_CHANNEL_ID,
    channelUrl: NOZOMI_CHANNEL_URL,
    evidenceUrls: [...NOZOMI_PUBLISHER_EVIDENCE_URLS],
    sourceConfigEvidenceUrls: source.evidenceUrls,
  },
  inputs: {
    database: databasePath,
    databaseOpenedReadOnly: true,
    inventory: inventoryPath,
    inventoryCompleted: inventory.completed,
    config: configPath,
    observationRegion,
  },
  budgets: {
    concurrency,
    requestsPerSecond,
    probeBudget,
    playerRequests: playerRequestCount,
    oEmbedRequests: oEmbedRequestCount,
  },
  counts: {
    inventoriedUniqueVideos: Object.keys(inventory.videos).length,
    longFormEpisodeLabels: listedEpisodes.length,
    explicitSeriesCrosswalkRules: NOZOMI_SERIES_CROSSWALKS.length,
    staticallyExactEpisodeVersions: probeTargets.length,
    currentPlayerProbes: runtimeEntries.size,
    currentOEmbedChecks: [...runtimeEntries.values()].filter((entry) => entry.oEmbed).length,
    exactSafeApprovalCandidates: passes.length,
    held: holds.length,
  },
  observedAvailability: Object.fromEntries(Object.entries(observedAvailability).sort(([left], [right]) => left.localeCompare(right))),
  holdReasons: Object.fromEntries(Object.entries(holdReasons).sort(([left], [right]) => left.localeCompare(right))),
  crosswalks: NOZOMI_SERIES_CROSSWALKS,
  safeApprovalCandidates: passes,
  holds,
  officialEmbedBasis: {
    help: 'https://support.google.com/youtube/answer/171780?hl=en',
    playerDocumentation: 'https://developers.google.com/youtube/player_parameters',
    requiredMinimumFunctionality: 'https://developers.google.com/youtube/terms/required-minimum-functionality',
    developerPolicies: 'https://developers.google.com/youtube/terms/developer-policies',
  },
  exactNextAction: passes.length
    ? 'Review only safeApprovalCandidates, create immutable per-video approval records in a separate authorized change, and verify actual media progression from the deployed viewer territory before enablement.'
    : 'Do not create approvals. Re-run this bounded report only when Nozomi changes current ordinary embed availability or supplies an authorized interface.',
  knownNonclaims: [
    'PASS is a report candidate disposition, not an approval-registry mutation, production enablement, or proof of deployed media progression.',
    'Publisher identity does not grant permission to download, proxy, alter, or redistribute audiovisual files.',
    'A current player response and oEmbed response establish ordinary embed metadata, not viewer-global availability.',
    'Entries with unmarked audio/subtitle language, split catalogue segmentation, ambiguous production identity, or mismatched language remain HOLD.',
    'This report did not change the catalogue database, native-resource registry, player policy, deployment, or provider mappings.',
  ],
};

mkdirSync(outputDirectory, { recursive: false });
writeFileSync(resolve(outputDirectory, 'proposal-report.json'), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
writeFileSync(resolve(outputDirectory, 'verification-summary.json'), `${JSON.stringify({
  version: 1,
  generatedAt,
  decision: report.decision,
  publisherIdentity: report.publisherIdentity,
  counts: report.counts,
  observedAvailability: report.observedAvailability,
  holdReasons: report.holdReasons,
  safeApprovalCandidates: passes.map((entry) => ({
    videoId: entry.videoId,
    videoTitle: entry.videoTitle,
    crosswalkId: entry.crosswalkId,
    identity: entry.identity,
    probe: entry.probe,
    oEmbed: entry.oEmbed,
  })),
  knownNonclaims: report.knownNonclaims,
}, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({
  outputDirectory,
  decision: report.decision,
  counts: report.counts,
  observedAvailability: report.observedAvailability,
  holdReasons: report.holdReasons,
}, null, 2)}\n`);
