import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  AdaptiveRequestScheduler,
  DiscoveryHttpError,
  OfficialYouTubeCatalogueMatcher,
  OFFICIAL_YOUTUBE_MATCHER_REVISION,
  PublicYouTubeMetadataClient,
  inventoryOfficialPublisherSource,
  extractSeriesIdentitySegments,
  inferEpisodeLanguage,
  isEpisodePackOrRange,
  isFullEpisodeCandidate,
  parseEpisodeIdentity,
  parseYouTubeContinuation,
  parseYouTubeInitialListing,
  parseYouTubePlayerProbe,
  probeOfficialYouTubeShard,
  stableShard,
  validateOfficialYouTubeDiscoveryConfig,
  type CatalogueTitleRecord,
  type OfficialPublisherSource,
  type SourceInventoryCheckpoint,
} from '../server/ingestion/youtubeOfficialDiscovery.ts';

const source: OfficialPublisherSource = {
  id: 'official-publisher', kind: 'channel', publisher: 'Publisher',
  channelId: 'UCsj_CYajUSQ2ca8bYCMan9g',
  channelUrl: 'https://www.youtube.com/channel/UCsj_CYajUSQ2ca8bYCMan9g',
  evidenceUrls: ['https://publisher.example/evidence'], territoryNote: 'Varies by region.',
  defaultLanguage: 'sub', disposition: 'reference-only',
};

function renderer(videoId = '_3Gcm-iGAQk', title = 'Series Name Full Episode 01', seconds = '24:00') {
  return { videoRenderer: { videoId, title: { simpleText: title }, lengthText: { simpleText: seconds }, shortBylineText: { runs: [{ text: 'Publisher', navigationEndpoint: { browseEndpoint: { browseId: source.channelId } } }] } } };
}

function initialHtml(data: unknown): string {
  return `<script>var ytInitialData = ${JSON.stringify(data)};</script><script>ytcfg.set({"INNERTUBE_API_KEY":"public-key","INNERTUBE_CLIENT_VERSION":"2.20260913.00.00","INNERTUBE_CONTEXT_CLIENT_NAME":"WEB"});</script>`;
}

function watchHtml(overrides: Record<string, unknown> = {}): string {
  return `<script>var ytInitialPlayerResponse = ${JSON.stringify({
    playabilityStatus: { status: 'OK', playableInEmbed: true },
    videoDetails: { videoId: '_3Gcm-iGAQk', title: 'Series Name Full Episode 01', channelId: source.channelId, author: 'Publisher', lengthSeconds: '1440' },
    microformat: { playerMicroformatRenderer: { publishDate: '2026-09-01', availableCountries: ['US', 'CA'] } },
    streamingData: { formats: [{ url: 'https://media.example/never-return-this' }] },
    ...overrides,
  })};</script>`;
}

const catalogue: CatalogueTitleRecord[] = [{
  id: 1, sourceId: 'title-1', slug: 'series-name', name: 'Series Name', aliases: ['Series Name'],
  episodes: [{ id: 2, sourceId: 'episode-1', numberText: '1', numberSort: 1, label: 'Episode 1', versions: [{ id: 3, sourceId: 'episode-1:sub', language: 'sub' }] }],
}];

describe('official YouTube discovery', () => {
  it('parses an initial page, continuation, and duplicate occurrences deterministically', async () => {
    const first = parseYouTubeInitialListing(initialHtml({ contents: [renderer()], continuationCommand: { token: 'next-page-token-12345' }, channelMetadataRenderer: { externalId: source.channelId, title: 'Publisher' } }));
    expect(first.videos).toHaveLength(1);
    expect(first.continuation).toBe('next-page-token-12345');
    const second = parseYouTubeContinuation({ items: [renderer(), renderer('abcdefghijk', 'Series Name Full Episode 02')], continuationCommand: { token: 'final-page-token-12345' } });
    expect(second.videos.map((video) => video.videoId)).toEqual(['_3Gcm-iGAQk', 'abcdefghijk']);
    const list = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce({ ...second, continuation: null });
    const checkpoints: unknown[] = [];
    const result = await inventoryOfficialPublisherSource(source, { list }, null, { shardCount: 500, maxPages: 2, requestBudget: 2, checkpoint: (value) => { checkpoints.push(structuredClone(value)); } });
    expect(result.completed).toBe(true);
    expect(Object.keys(result.videos)).toHaveLength(2);
    expect(result.duplicateOccurrences).toBe(1);
    expect(checkpoints).toHaveLength(2);
  });

  it('prefers the video-list continuation item over unrelated continuation commands', () => {
    const page = parseYouTubeContinuation({
      unrelatedPanel: { continuationCommand: { token: 'unrelated-token' } },
      items: [renderer()],
      continuationItemViewModel: { continuationEndpoint: { continuationCommand: { token: 'video-list-token' } } },
    });
    expect(page.continuation).toBe('video-list-token');
  });

  it('resumes inventory from the saved continuation without repeating completed work', async () => {
    const list = vi.fn().mockResolvedValue({ videos: [renderer('abcdefghijk', 'Series Name Full Episode 02')], continuation: null, channelId: source.channelId, channelLabel: 'Publisher', estimatedTotalVideos: 2 });
    const existing: SourceInventoryCheckpoint = { version: 1, sourceId: source.id, sourceShard: stableShard(`source:${source.id}`), continuation: 'resume-token', completed: false, pages: 1, estimatedTotalVideos: 2, videos: {}, duplicateOccurrences: 0, requests: 1, retryCount: 0, errors: [], startedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
    existing.videos = { '_3Gcm-iGAQk': parseYouTubeContinuation({ item: renderer() }).videos[0] };
    const result = await inventoryOfficialPublisherSource(source, { list }, existing, { shardCount: 500, maxPages: 3, requestBudget: 3, checkpoint: vi.fn() });
    expect(list).toHaveBeenCalledWith(source, 'resume-token');
    expect(Object.keys(result.videos)).toHaveLength(2);
  });

  it('classifies region and embed failures and never returns media URLs', () => {
    const playable = parseYouTubePlayerProbe(watchHtml(), '_3Gcm-iGAQk', 'test');
    expect(playable).toMatchObject({ availability: 'playable', playableInEmbed: true, durationSeconds: 1440 });
    expect(JSON.stringify(playable)).not.toContain('media.example');
    const blocked = parseYouTubePlayerProbe(watchHtml({ playabilityStatus: { status: 'UNPLAYABLE', reason: 'Not available in your country' } }), '_3Gcm-iGAQk', 'test');
    expect(blocked.availability).toBe('region-blocked');
    const disabled = parseYouTubePlayerProbe(watchHtml({ playabilityStatus: { status: 'UNPLAYABLE', playableInEmbed: false } }), '_3Gcm-iGAQk', 'test');
    expect(disabled.availability).toBe('embed-disabled');
  });

  it('parses specials and offsets while holding ambiguous matches', () => {
    expect(parseEpisodeIdentity('Series OVA Special Episode 2')).toEqual({ kind: 'special', number: 2 });
    expect(parseEpisodeIdentity('Series Prologue')).toEqual({ kind: 'prologue', number: null });
    expect(parseEpisodeIdentity('【公式】BIRDIE WING 第1話「レインボーバレット」')).toEqual({ kind: 'regular', number: 1 });
    expect(parseEpisodeIdentity('Hell Teacher S1:E26 • Secret of the Demon Hand')).toEqual({ kind: 'regular', number: 26 });
    expect(parseEpisodeIdentity('Cardfight!! Vanguard - Ride 19 Showdown!')).toEqual({ kind: 'regular', number: 19 });
    expect(parseEpisodeIdentity('BEYBLADE X | NOUVEL ÉPISODE ! | Ép.29 Masque et Petits Pains')).toEqual({ kind: 'regular', number: 29 });
    expect(inferEpisodeLanguage('SONIC X EP01 | English Dub | Full Episode', 'sub')).toBe('dub');
    expect(inferEpisodeLanguage('BIRDIE WING 第1話 | English Sub', 'dub')).toBe('sub');
    expect(inferEpisodeLanguage('No explicit language', 'sub')).toBe('sub');
    expect(extractSeriesIdentitySegments('Full Episode 14 | Yakitate!! JAPAN | English Sub')).toEqual(['Yakitate!! JAPAN']);
    expect(extractSeriesIdentitySegments('The Gutsy Frog - EP28 The Kingdom of Frogs / Blow Away the Cold | English Sub')).toEqual(['The Gutsy Frog']);
    expect(extractSeriesIdentitySegments('True Cooking Master Boy S1:E3 • The Strange Invitation | ENG SUB')).toEqual(['True Cooking Master Boy']);
    const offsetSource = { ...source, seriesHints: [{ aliases: ['Series Name'], titleSourceId: 'title-1', episodeOffset: -1 }] };
    const video = parseYouTubeContinuation({ item: renderer('_3Gcm-iGAQk', 'Series Name Full Episode 02') }).videos[0];
    const probe = parseYouTubePlayerProbe(watchHtml(), '_3Gcm-iGAQk', 'test');
    expect(new OfficialYouTubeCatalogueMatcher(catalogue).match(offsetSource, video, probe).match?.episodeId).toBe(2);
    const ambiguousCatalogue = [...catalogue, { ...catalogue[0], id: 4, sourceId: 'title-2', slug: 'series-name-2' }];
    const ambiguous = new OfficialYouTubeCatalogueMatcher(ambiguousCatalogue).match(source, parseYouTubeContinuation({ item: renderer() }).videos[0], probe);
    expect(ambiguous.decision).toBe('hold');
    expect(ambiguous.reasonCodes).toContain('ambiguous-title');
  });

  it('does not match a catalogue title found only inside an episode subtitle', () => {
    const falsePositiveCatalogue: CatalogueTitleRecord[] = [{
      id: 4,
      sourceId: 'kingdom',
      slug: 'kingdom',
      name: 'Kingdom',
      aliases: ['Kingdom'],
      episodes: [{ id: 5, sourceId: 'kingdom-28', numberText: '28', numberSort: 28, label: 'Episode 28', versions: [{ id: 6, sourceId: 'kingdom-28:sub', language: 'sub' }] }],
    }];
    const video = parseYouTubeContinuation({ item: renderer('_3Gcm-iGAQk', 'The Gutsy Frog - EP28 The Kingdom of Frogs | English Sub') }).videos[0];
    const probe = parseYouTubePlayerProbe(watchHtml(), '_3Gcm-iGAQk', 'test');
    const result = new OfficialYouTubeCatalogueMatcher(falsePositiveCatalogue).match(source, video, probe);
    expect(result.match).toBeNull();
    expect(result.decision).toBe('hold');
    expect(result.reasonCodes).toContain('title-not-matched');
  });

  it('filters clips, assigns one of 500 stable shards, and resumes probe checkpoints', async () => {
    const full = parseYouTubeContinuation({ item: renderer() }).videos[0];
    const clip = { ...full, title: 'Series Name preview clip', durationSeconds: 120 };
    expect(isFullEpisodeCandidate(full)).toBe(true);
    expect(isFullEpisodeCandidate(clip)).toBe(false);
    expect(isFullEpisodeCandidate({ ...full, title: '【公式】BIRDIE WING 第1話「レインボーバレット」' })).toBe(true);
    expect(isFullEpisodeCandidate({ ...full, title: '【公式】進撃の巨人 第23話〜第25話' })).toBe(false);
    expect(isFullEpisodeCandidate({ ...full, title: 'Hell Teacher S1:E26 • Secret of the Demon Hand' })).toBe(true);
    expect(isFullEpisodeCandidate({ ...full, title: 'Cardfight!! Vanguard - Ride 19 Showdown!' })).toBe(true);
    expect(isFullEpisodeCandidate({ ...full, title: 'BEYBLADE X | NOUVEL ÉPISODE ! | Ép.29 Masque et Petits Pains' })).toBe(true);
    expect(isEpisodePackOrRange('BEYBLADE | Ep.33 First | Ep.34 Second')).toBe(true);
    expect(isEpisodePackOrRange('TASOKARE HOTEL EP1-12 | FULL EPISODE')).toBe(true);
    expect(isEpisodePackOrRange('Full Episode 1～3 | My Deer Friend Nokotan')).toBe(true);
    expect(isEpisodePackOrRange('Episode 1, 2 & 3')).toBe(true);
    expect(isEpisodePackOrRange('BEYBLADE BURST EVOLUTION | Ép.1, 2 & 3 | 60 Minutes !')).toBe(true);
    expect(isEpisodePackOrRange("BEYBLADE BURST EVOLUTION | Ép.1 Nouveau Départ ! | Ép.2 L'Esprit Combatif !")).toBe(true);
    expect(isFullEpisodeCandidate({ ...full, title: 'BEYBLADE | Ep.33 First | Ep.34 Second' })).toBe(false);
    expect(stableShard(full.videoId, 500)).toBe(stableShard(full.videoId, 500));
    expect(stableShard(full.videoId, 500)).toBeLessThan(500);
    const probe = parseYouTubePlayerProbe(watchHtml(), '_3Gcm-iGAQk', 'test');
    const existing = { version: 1 as const, shard: 1, completed: false, probes: { [full.videoId]: probe }, candidates: {}, requests: 1, retryCount: 0, errors: [], startedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
    const client = { probe: vi.fn() };
    const result = await probeOfficialYouTubeShard(1, [full], client, existing, { concurrency: 2, requestBudget: 10, source, matcher: new OfficialYouTubeCatalogueMatcher(catalogue), checkpoint: vi.fn() });
    expect(client.probe).not.toHaveBeenCalled();
    expect(result.completed).toBe(true);
  });

  it('rematches completed probe checkpoints when the matcher revision changes without refetching', async () => {
    const full = parseYouTubeContinuation({ item: renderer() }).videos[0];
    const probe = parseYouTubePlayerProbe(watchHtml(), '_3Gcm-iGAQk', 'test');
    const stale = {
      version: 1 as const,
      matcherRevision: 'older-rules',
      shard: 1,
      completed: true,
      probes: { [full.videoId]: probe },
      candidates: {},
      requests: 1,
      retryCount: 0,
      errors: [],
      startedAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    };
    const client = { probe: vi.fn() };
    const result = await probeOfficialYouTubeShard(1, [full], client, stale, {
      concurrency: 2,
      requestBudget: 1,
      source,
      matcher: new OfficialYouTubeCatalogueMatcher(catalogue),
      matcherRevision: OFFICIAL_YOUTUBE_MATCHER_REVISION,
      checkpoint: vi.fn(),
    });
    expect(client.probe).not.toHaveBeenCalled();
    expect(result.matcherRevision).toBe(OFFICIAL_YOUTUBE_MATCHER_REVISION);
    expect(result.candidates[full.videoId]?.match?.versionSourceId).toBe('episode-1:sub');
    expect(result.completed).toBe(true);
  });

  it('honors Retry-After on retryable responses', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(new Response(watchHtml(), { status: 200 }));
    const scheduler = new AdaptiveRequestScheduler({ globalConcurrency: 1, perHostConcurrency: 1, requestsPerSecond: 100, burst: 1, circuitFailures: 4, circuitCooldownMs: 1000, sleep });
    const client = new PublicYouTubeMetadataClient({ fetcher, scheduler, maxAttempts: 2, timeoutMs: 1000, maxResponseBytes: 100_000, observationRegion: 'test', retryCapMs: 5000, sleep });
    await expect(client.probe('_3Gcm-iGAQk')).resolves.toMatchObject({ availability: 'playable' });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('retries one transient successful HTML response that lacks listing data', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRequest = vi.fn();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('<!doctype html><title>Uploads from Publisher - YouTube</title>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
      .mockResolvedValueOnce(new Response(initialHtml({ contents: [renderer()], channelMetadataRenderer: { externalId: source.channelId, title: 'Publisher' } }), { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const scheduler = new AdaptiveRequestScheduler({ globalConcurrency: 1, perHostConcurrency: 1, requestsPerSecond: 100, burst: 2, circuitFailures: 4, circuitCooldownMs: 1000, sleep });
    const client = new PublicYouTubeMetadataClient({ fetcher, scheduler, maxAttempts: 2, timeoutMs: 1000, maxResponseBytes: 100_000, observationRegion: 'test', retryCapMs: 5000, sleep, onRequest });
    await expect(client.list(source, null)).resolves.toMatchObject({ channelId: source.channelId });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(onRequest).toHaveBeenLastCalledWith(expect.objectContaining({ retry: true }));
  });

  it('opens the scheduler circuit after bounded repeated failures', async () => {
    const scheduler = new AdaptiveRequestScheduler({ globalConcurrency: 1, perHostConcurrency: 1, requestsPerSecond: 100, burst: 2, circuitFailures: 2, circuitCooldownMs: 60_000 });
    const fail = () => scheduler.run('www.youtube.com', async () => { throw new DiscoveryHttpError('UPSTREAM_UNAVAILABLE', 'down', true, 503); });
    await expect(fail()).rejects.toThrow('down');
    await expect(fail()).rejects.toThrow('down');
    await expect(fail()).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
  });

  it('keeps discovery sources separate from the explicit playback allowlist', () => {
    const discoveryOnly = { ...source, id: 'second-official-source', channelId: 'UCzGf0DdUJVrsbcWL3e_tK1Q', channelUrl: 'https://www.youtube.com/channel/UCzGf0DdUJVrsbcWL3e_tK1Q' };
    expect(() => validateOfficialYouTubeDiscoveryConfig({ version: 1, shardCount: 500, sources: [source, discoveryOnly], playbackPolicies: [{ id: 'remow-reviewed-v1', channelId: source.channelId, sourceIds: [source.id], adapter: 'youtube-official', state: 'implemented', approvalRegistry: 'REMOW_EPISODE_APPROVALS' }] })).not.toThrow();
    expect(() => validateOfficialYouTubeDiscoveryConfig({ version: 1, shardCount: 500, sources: [source, discoveryOnly], playbackPolicies: [{ id: 'bad-policy', channelId: source.channelId, sourceIds: [discoveryOnly.id], adapter: 'youtube-official', state: 'implemented', approvalRegistry: 'UNREVIEWED' }] })).toThrow('PLAYBACK_POLICY_SOURCE_MISMATCH');
  });

  it('loads the expanded publisher inventory with only reviewed playback policies', () => {
    const config = JSON.parse(readFileSync(new URL('../config/official-youtube-discovery.json', import.meta.url), 'utf8'));
    expect(() => validateOfficialYouTubeDiscoveryConfig(config)).not.toThrow();
    expect(config.sources).toHaveLength(44);
    expect(new Set(config.sources.map((entry: OfficialPublisherSource) => entry.id)).size).toBe(44);
    expect(config.sources.every((entry: OfficialPublisherSource) => entry.disposition === 'reference-only')).toBe(true);
    expect(config.sources.find((entry: OfficialPublisherSource) => entry.id === 'nozomi-entertainment')).toMatchObject({ discoveryMode: 'inventory-only' });
    expect(config.playbackPolicies.map((policy: { id: string }) => policy.id)).toEqual([
      'remow-reviewed-v1',
      'gundam-reviewed-v1',
      'tms-reviewed-v1',
      'beyblade-reviewed-v1',
      'beyblade-french-reviewed-v1',
      'beyblade-german-reviewed-v1',
      'beyblade-spanish-reviewed-v1',
      'beyblade-dutch-reviewed-v1',
      'beyblade-portuguese-brazil-reviewed-v1',
      'beyblade-italian-reviewed-v1',
      'nozomi-reviewed-v1',
      'tv-tokyo-reviewed-v1',
    ]);
  });
});
