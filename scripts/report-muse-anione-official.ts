import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AdaptiveRequestScheduler,
  PublicYouTubeMetadataClient,
  inventoryOfficialPublisherSource,
  isFullEpisodeCandidate,
  loadOfficialYouTubeCatalogue,
  type ListedYouTubeVideo,
  type OfficialPublisherSource,
  type OfficialYouTubeDiscoveryConfig,
  type YouTubeVideoProbe,
} from '../server/ingestion/youtubeOfficialDiscovery.ts';
import {
  MUSE_ANIONE_SOURCE_IDS,
  buildMuseAniOneReviewEntry,
  normalizeOfficialSeriesTitle,
  officialSeriesTitleCandidates,
  parseOfficialChannelPlaylistsContinuation,
  parseOfficialChannelPlaylistsInitial,
  type MuseAniOneReviewEntry,
  type OfficialChannelPlaylist,
} from '../server/ingestion/museAniOneOfficialReview.ts';

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
const outputDirectory = resolve(required('out'));
const configPath = resolve(option('config') ?? resolve(root, 'config', 'official-youtube-discovery.json'));
const sourceFilter = new Set((option('sources') ?? MUSE_ANIONE_SOURCE_IDS.join(','))
  .split(',').map((value) => value.trim()).filter(Boolean));
const maximumPlaylistPages = positiveInteger('max-playlist-pages', 20, 100);
const maximumPlaylistsPerSource = positiveInteger('max-playlists-per-source', 250, 2_000);
const maximumVideosPerSource = positiveInteger('max-videos-per-source', 2_000, 20_000);
const probeBudget = positiveInteger('probe-budget', 2_000, 20_000);
const requestsPerSecond = positiveNumber('requests-per-second', 0.75, 4);
const observationRegion = option('observation-region')?.trim() || 'runtime-network';

if (!existsSync(databasePath)) throw new Error('DATABASE_NOT_FOUND');
if (databasePath.toLowerCase() === canonicalDatabase) throw new Error('CANONICAL_CATALOGUE_REFUSED');
const relativeOutput = relative(root, outputDirectory);
if (!relativeOutput.startsWith('..') && !isAbsolute(relativeOutput)) throw new Error('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
if (existsSync(outputDirectory)) throw new Error('OUTPUT_DIRECTORY_ALREADY_EXISTS');

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const config = readJson<OfficialYouTubeDiscoveryConfig>(configPath);
const sources = config.sources.filter((source) => sourceFilter.has(source.id));
if (!sources.length) throw new Error('NO_SELECTED_SOURCES');
if (sources.some((source) => !MUSE_ANIONE_SOURCE_IDS.includes(source.id as typeof MUSE_ANIONE_SOURCE_IDS[number])))
  throw new Error('SOURCE_OUTSIDE_MUSE_ANIONE_SCOPE');

const database = new DatabaseSync(databasePath, { readOnly: true });
const catalogue = loadOfficialYouTubeCatalogue(database);
database.close();
const exactTitles = new Map<string, typeof catalogue>();
for (const title of catalogue) for (const alias of title.aliases) {
  const normalized = normalizeOfficialSeriesTitle(alias);
  if (!normalized) continue;
  const bucket = exactTitles.get(normalized) ?? [];
  if (!bucket.some((item) => item.id === title.id)) bucket.push(title);
  exactTitles.set(normalized, bucket);
}

const scheduler = new AdaptiveRequestScheduler({
  globalConcurrency: 2,
  perHostConcurrency: 2,
  requestsPerSecond,
  burst: 1,
  circuitFailures: 4,
  circuitCooldownMs: 60_000,
});
let requestCount = 0;

async function boundedText(response: Response, maximumBytes = 12 * 1024 * 1024): Promise<string> {
  const announced = Number(response.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > maximumBytes) {
    await response.body?.cancel();
    throw new Error('RESPONSE_TOO_LARGE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('EMPTY_RESPONSE');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error('RESPONSE_TOO_LARGE');
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function requestText(url: URL, init: RequestInit = {}, maximumBytes?: number): Promise<string> {
  requestCount += 1;
  return scheduler.run(url.hostname, async () => {
    const response = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: init.method === 'POST' ? 'application/json' : 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 SolanimeOfficialMetadata/1.0',
        ...init.headers,
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP_${response.status}`);
    }
    return boundedText(response, maximumBytes);
  });
}

async function channelPlaylists(source: OfficialPublisherSource): Promise<OfficialChannelPlaylist[]> {
  const url = new URL(`${source.channelUrl}/playlists`);
  url.searchParams.set('hl', 'en');
  const initial = parseOfficialChannelPlaylistsInitial(await requestText(url), source.channelId);
  const playlists = new Map(initial.playlists.map((playlist) => [playlist.playlistId, playlist]));
  let continuation = initial.continuation;
  let pages = 1;
  while (continuation && pages < maximumPlaylistPages && playlists.size < maximumPlaylistsPerSource) {
    const endpoint = new URL('https://www.youtube.com/youtubei/v1/browse');
    endpoint.searchParams.set('key', initial.session.apiKey);
    const data = JSON.parse(await requestText(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: initial.session.clientVersion,
            hl: 'en',
            visitorData: initial.session.visitorData,
          },
        },
        continuation,
      }),
    })) as unknown;
    const parsed = parseOfficialChannelPlaylistsContinuation(data);
    for (const playlist of parsed.playlists) playlists.set(playlist.playlistId, playlist);
    continuation = parsed.continuation;
    pages += 1;
  }
  return [...playlists.values()]
    .sort((left, right) => left.playlistId.localeCompare(right.playlistId))
    .slice(0, maximumPlaylistsPerSource);
}

const metadataClient = new PublicYouTubeMetadataClient({
  scheduler,
  maxAttempts: 3,
  timeoutMs: 20_000,
  maxResponseBytes: 12 * 1024 * 1024,
  observationRegion,
  retryCapMs: 30_000,
  onRequest: () => { requestCount += 1; },
});

function exactCatalogueTitles(playlist: OfficialChannelPlaylist): typeof catalogue {
  const matches = new Map<number, typeof catalogue[number]>();
  for (const candidate of officialSeriesTitleCandidates(playlist.title)) {
    for (const title of exactTitles.get(candidate) ?? []) matches.set(title.id, title);
  }
  return [...matches.values()].sort((left, right) => left.id - right.id);
}

function isExactSingleEpisodeCandidate(video: ListedYouTubeVideo): boolean {
  const parsed = /\b(?:episode|ep\.?)\s*[-#:]*\s*\d+(?:\.\d+)?\b|(?:^|\s)#\d+(?:\.\d+)?(?:\s|$)/i.test(video.title);
  const excluded = /\b(?:trailer|teaser|preview|highlight|clip|opening|ending|creditless|music video|shorts?|pv|recap|compilation|marathon)\b/i.test(video.title)
    || /\bepisodes?\s*\d+\s*[-&+]\s*\d+\b/i.test(video.title);
  return parsed && !excluded && (video.durationSeconds === null || video.durationSeconds >= 120);
}

async function listPlaylistVideos(
  source: OfficialPublisherSource,
  playlist: OfficialChannelPlaylist,
  index: number,
): Promise<ListedYouTubeVideo[]> {
  const playlistSource: OfficialPublisherSource = {
    ...source,
    id: `${source.id}-playlist-${index + 1}`,
    kind: 'playlist',
    playlistId: playlist.playlistId,
  };
  const state = await inventoryOfficialPublisherSource(playlistSource, metadataClient, null, {
    shardCount: 1,
    maxPages: 50,
    requestBudget: 50,
    checkpoint: () => undefined,
  });
  return Object.values(state.videos)
    .filter((video) => !video.channelId || video.channelId === source.channelId)
    .slice(0, maximumVideosPerSource);
}

async function oEmbed(videoId: string): Promise<Record<string, unknown>> {
  const endpoint = new URL('https://www.youtube.com/oembed');
  endpoint.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`);
  endpoint.searchParams.set('format', 'json');
  try {
    const value = JSON.parse(await requestText(endpoint, { headers: { Accept: 'application/json' } }, 64 * 1024)) as Record<string, unknown>;
    return {
      result: value.type === 'video' && value.provider_name === 'YouTube' && typeof value.html === 'string' && value.html.includes(`/embed/${videoId}`)
        ? 'standard-embed-returned'
        : 'schema-mismatch',
      title: typeof value.title === 'string' ? value.title : null,
      authorName: typeof value.author_name === 'string' ? value.author_name : null,
      authorUrl: typeof value.author_url === 'string' ? value.author_url : null,
    };
  } catch (error) {
    return { result: 'unavailable', error: error instanceof Error ? error.message : String(error) };
  }
}

let remainingProbes = probeBudget;
const entries: MuseAniOneReviewEntry[] = [];
const sourceReports: Array<Record<string, unknown>> = [];
const representativeEmbeds: Array<Record<string, unknown>> = [];

for (const source of sources) {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  let playlists: OfficialChannelPlaylist[] = [];
  try {
    playlists = await channelPlaylists(source);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const playlistReports: Array<Record<string, unknown>> = [];
  let enumeratedVideos = 0;
  let exactPlaylistCount = 0;
  for (const [index, playlist] of playlists.entries()) {
    const matches = exactCatalogueTitles(playlist);
    const playlistReport: Record<string, unknown> = {
      playlistId: playlist.playlistId,
      playlistUrl: `https://www.youtube.com/playlist?list=${playlist.playlistId}`,
      title: playlist.title,
      advertisedVideos: playlist.videoCount,
      exactCatalogueTitleIds: matches.map((title) => title.id),
      enumeration: 'not-required-non-exact-title',
      enumeratedVideos: 0,
    };
    if (matches.length === 1) {
      exactPlaylistCount += 1;
      try {
        const videos = await listPlaylistVideos(source, playlist, index);
        playlistReport.enumeration = 'completed-public-playlist';
        playlistReport.enumeratedVideos = videos.length;
        playlistReport.videoObservations = videos;
        enumeratedVideos += videos.length;
        const candidates = videos.filter((video) => isFullEpisodeCandidate(video) || isExactSingleEpisodeCandidate(video));
        for (const video of candidates) {
          if (remainingProbes <= 0) break;
          remainingProbes -= 1;
          let probe: YouTubeVideoProbe;
          try {
            probe = await metadataClient.probe(video.videoId);
          } catch (error) {
            probe = {
              videoId: video.videoId,
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
          entries.push(buildMuseAniOneReviewEntry({ source, playlist, video, probe, catalogue }));
        }
      } catch (error) {
        playlistReport.enumeration = 'failed';
        playlistReport.error = error instanceof Error ? error.message : String(error);
      }
    }
    playlistReports.push(playlistReport);
  }
  const sourceEntries = entries.filter((entry) => entry.sourceId === source.id);
  const representative = sourceEntries
    .filter((entry) => entry.disposition === 'proposal')
    .sort((left, right) => left.videoId.localeCompare(right.videoId))[0]
    ?? sourceEntries.sort((left, right) => left.videoId.localeCompare(right.videoId))[0];
  if (representative) representativeEmbeds.push({
    sourceId: source.id,
    videoId: representative.videoId,
    checkedAt: new Date().toISOString(),
    ...(await oEmbed(representative.videoId)),
  });
  sourceReports.push({
    sourceId: source.id,
    publisher: source.publisher,
    channelId: source.channelId,
    channelUrl: source.channelUrl,
    identityEvidenceUrls: source.evidenceUrls,
    territoryNote: source.territoryNote,
    startedAt,
    completedAt: new Date().toISOString(),
    playlistPagesCompleted: errors.length ? false : true,
    discoveredPlaylists: playlists.length,
    exactCataloguePlaylists: exactPlaylistCount,
    enumeratedVideos,
    proposalEntries: sourceEntries.filter((entry) => entry.disposition === 'proposal').length,
    heldEntries: sourceEntries.filter((entry) => entry.disposition === 'hold').length,
    errors,
    playlists: playlistReports,
  });
}

entries.sort((left, right) => left.sourceId.localeCompare(right.sourceId)
  || left.playlistId.localeCompare(right.playlistId)
  || (left.identity?.episodeId ?? Number.MAX_SAFE_INTEGER) - (right.identity?.episodeId ?? Number.MAX_SAFE_INTEGER)
  || left.videoId.localeCompare(right.videoId));
const holdReasons: Record<string, number> = {};
for (const entry of entries.filter((item) => item.disposition === 'hold')) {
  for (const reason of entry.reasonCodes) holdReasons[reason] = (holdReasons[reason] ?? 0) + 1;
}
const generatedAt = new Date().toISOString();
const report = {
  version: 1,
  generatedAt,
  decision: 'HOLD',
  candidateAndCurrentStage: 'Muse Asia and Ani-One official YouTube episode crosswalk; runtime-proof stage for proposal rows, metadata-verified or HOLD for all other observations.',
  why: 'Only exact catalogue title, regular episode, language-version, publisher-channel, current public playability, and standard embed observations become proposals. Integration and release remain separately reviewed.',
  resourceBrief: {
    function: 'Map exact Solanime catalogue episodes to ordinary publisher-operated YouTube embeds without downloading or proxying media.',
    allowedSources: 'Muse Communication and Medialink/Ani-One operated YouTube channels identified by the publishers.',
    forbidden: ['media download', 'membership bypass', 'region bypass', 'DRM bypass', 'URL extraction', 'source relabeling'],
    runtime: 'YouTube privacy-enhanced iframe player with normal YouTube controls and attribution.',
  },
  inputs: {
    database: databasePath,
    databaseOpenedReadOnly: true,
    config: configPath,
    sourceIds: sources.map((source) => source.id),
    observationRegion,
  },
  budgets: {
    requestsPerSecond,
    maximumPlaylistPages,
    maximumPlaylistsPerSource,
    maximumVideosPerSource,
    probeBudget,
    requestsMade: requestCount,
    probesRemaining: remainingProbes,
  },
  counts: {
    sources: sources.length,
    playlists: sourceReports.reduce((sum, source) => sum + Number(source.discoveredPlaylists), 0),
    exactCataloguePlaylists: sourceReports.reduce((sum, source) => sum + Number(source.exactCataloguePlaylists), 0),
    enumeratedVideos: sourceReports.reduce((sum, source) => sum + Number(source.enumeratedVideos), 0),
    reviewedEpisodeCandidates: entries.length,
    exactPlayableProposals: entries.filter((entry) => entry.disposition === 'proposal').length,
    held: entries.filter((entry) => entry.disposition === 'hold').length,
  },
  holdReasons,
  officialEmbedBasis: {
    help: 'https://support.google.com/youtube/answer/171780?hl=en',
    playerDocumentation: 'https://developers.google.com/youtube/player_parameters',
    requiredMinimumFunctionality: 'https://developers.google.com/youtube/terms/required-minimum-functionality',
    developerPolicies: 'https://developers.google.com/youtube/terms/developer-policies',
  },
  publisherEvidence: {
    muse: ['https://www.e-muse.com/en/', 'https://www.e-muse.com/en/social-media/'],
    aniOne: ['https://www.medialink.com.hk/en/Anione.aspx', 'https://www1.hkexnews.hk/listedco/listconews/sehk/2023/1129/2023112901559.pdf'],
  },
  sources: sourceReports,
  representativeOEmbedChecks: representativeEmbeds,
  proposals: entries.filter((entry) => entry.disposition === 'proposal'),
  holds: entries.filter((entry) => entry.disposition === 'hold'),
  exactNextAction: 'Review proposal rows, add explicit publisher allowlist policies and immutable approval entries in a separate integration change, then verify deployed media progression from supported viewer territories before production enablement.',
  knownNonclaims: [
    'Publisher identity does not grant Solanime a licence to download, proxy, alter, or redistribute the audiovisual files.',
    'A public playlist, oEmbed response, iframe HTML response, or HTTP 200 does not prove media progression.',
    'Territory availability is viewer-specific and time-sensitive; rows observed as blocked are held.',
    'This report did not change the canonical catalogue, approval registry, player policy, deployment, or provider mappings.',
    'Proposal means exact report candidate, not human acceptance, production approval, or release readiness.',
  ],
};

mkdirSync(outputDirectory, { recursive: false });
writeFileSync(resolve(outputDirectory, 'proposal-report.json'), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
writeFileSync(resolve(outputDirectory, 'verification-summary.json'), `${JSON.stringify({
  generatedAt,
  decision: report.decision,
  counts: report.counts,
  holdReasons,
  representativeOEmbedChecks: representativeEmbeds,
  knownNonclaims: report.knownNonclaims,
}, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ outputDirectory, decision: report.decision, counts: report.counts, holdReasons })}\n`);
