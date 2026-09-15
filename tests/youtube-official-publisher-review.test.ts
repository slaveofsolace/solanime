import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { auditCatalogueExternalIds, buildOfficialPublisherReview, buildOfficialSeriesApprovalProposals } from '../server/ingestion/youtubeOfficialPublisherReview.ts';
import type { OfficialYouTubeDiscoveryConfig, OfficialYouTubeReviewCandidate, SourceInventoryCheckpoint } from '../server/ingestion/youtubeOfficialDiscovery.ts';
import type { OfficialYouTubeBatchApprovalPlan } from '../server/ingestion/youtubeOfficialBatchApproval.ts';

const source = { id: 'publisher-source', kind: 'channel' as const, publisher: 'Publisher', channelId: 'UCsj_CYajUSQ2ca8bYCMan9g', channelUrl: 'https://www.youtube.com/channel/UCsj_CYajUSQ2ca8bYCMan9g', evidenceUrls: ['https://publisher.example/evidence'], territoryNote: 'Varies.', defaultLanguage: 'sub', disposition: 'reference-only' as const };
const config: OfficialYouTubeDiscoveryConfig = { version: 1, shardCount: 500, playbackPolicies: [], sources: [source] };
const inventory: SourceInventoryCheckpoint = { version: 1, sourceId: source.id, sourceShard: 1, continuation: null, completed: true, pages: 1, estimatedTotalVideos: 1, videos: {}, duplicateOccurrences: 0, requests: 1, retryCount: 0, errors: [], startedAt: '2026-09-13T00:00:00Z', updatedAt: '2026-09-13T00:00:01Z' };
const candidate: OfficialYouTubeReviewCandidate = { candidateId: 'youtube:_3Gcm-iGAQk', sourceId: source.id, publisher: source.publisher, channelId: source.channelId, evidenceUrls: source.evidenceUrls, rightsDisposition: 'reference-only', autoEnabled: false, video: { videoId: '_3Gcm-iGAQk', title: 'Series Full Episode 1', channelId: source.channelId, channelLabel: 'Publisher', durationSeconds: 1440, publishedText: null, playlistIndex: 1 }, probe: { videoId: '_3Gcm-iGAQk', title: 'Series Full Episode 1', channelId: source.channelId, channelLabel: 'Publisher', durationSeconds: 1440, publishDate: '2026-09-13', availability: 'playable', playableInEmbed: true, reason: null, observedAt: '2026-09-13T00:00:02Z', observationRegion: 'US', availableCountries: ['US'] }, parsedEpisode: { kind: 'regular', number: 1 }, fullEpisodeCandidate: true, confidence: 1, decision: 'manual-review', reasonCodes: ['manual-rights-and-identity-review-required'], match: { titleId: 1, titleSourceId: 'title-1', episodeId: 2, episodeSourceId: 'episode-1', versionId: 3, versionSourceId: 'episode-1:sub', language: 'sub', method: 'authoritative' } };
const approval: OfficialYouTubeBatchApprovalPlan = { version: 1, evaluatedAt: '2026-09-13T00:00:03Z', inputManualReviewCandidates: 1, eligibleCount: 0, heldCount: 1, reasonCounts: { 'existing-official-youtube-duplicate': 1 }, rightsDisposition: 'reference-only-pending-explicit-approval', autoApplied: false, entries: [{ candidateId: candidate.candidateId, sourceId: source.id, videoId: candidate.video.videoId, channelId: source.channelId, title: candidate.video.title, durationSeconds: 1440, availability: 'playable', availableInUnitedStates: true, matchMethod: 'authoritative', titleId: 1, episodeId: 2, versionId: 3, language: 'sub', decision: 'hold', reasonCodes: ['existing-official-youtube-duplicate'], evidenceHash: 'a'.repeat(64) }] };

describe('official publisher review', () => {
  it('summarizes authoritative mappings, embed status, evidence, and held reasons', () => {
    const report = buildOfficialPublisherReview(config, new Map([[source.id, inventory]]), [candidate], approval, { status: 'unavailable', tmdbRows: 0, aniListRows: 0, malRows: 0, distinctTitles: 0, reason: 'No identifiers.' }, '2026-09-13T00:00:04Z');
    expect(report.publishers[0]).toMatchObject({ identityEvidenceUrls: source.evidenceUrls, embed: { playable: 1 }, catalogueMatches: { authoritative: [{ videoId: '_3Gcm-iGAQk', titleId: 1, episodeId: 2, versionId: 3, language: 'sub' }] }, approval: { eligible: 0, held: 1, heldReasons: { 'existing-official-youtube-duplicate': 1 } } });
  });

  it('reports an exact external-identifier schema gap without inventing name matches', () => {
    const db = new DatabaseSync(':memory:');
    db.exec("CREATE TABLE titles(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE artwork_matches(title_id INTEGER,media_id INTEGER,mal_id INTEGER,review_status TEXT); INSERT INTO artwork_matches VALUES(1,100,200,'disabled');");
    expect(auditCatalogueExternalIds(db)).toEqual(expect.objectContaining({ status: 'unavailable', tmdbRows: 0, aniListRows: 0, malRows: 0, distinctTitles: 0 }));
    db.exec("INSERT INTO artwork_matches VALUES(2,101,201,'approved')");
    expect(auditCatalogueExternalIds(db)).toEqual(expect.objectContaining({ status: 'partial', aniListRows: 1, malRows: 1, distinctTitles: 1 }));
    db.close();
  });

  it('proposes only exact single-episode official series rows that align with the catalogue', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE titles(id INTEGER PRIMARY KEY,source TEXT,source_id TEXT,name TEXT);
      CREATE TABLE title_aliases(title_id INTEGER,alias TEXT);
      CREATE TABLE episodes(id INTEGER PRIMARY KEY,title_id INTEGER,number_sort REAL,episode_type TEXT);
      CREATE TABLE episode_versions(id INTEGER PRIMARY KEY,episode_id INTEGER,language TEXT);
      CREATE TABLE episode_provider_mappings(version_id INTEGER,provider_id TEXT,provider_resource_id TEXT);
      INSERT INTO titles VALUES(10,'anikoto','god-mars','God Mars'),(20,'anikoto','pluto','Pluto');
      INSERT INTO episodes VALUES(11,10,1,'regular'),(12,10,2,'regular'),(21,20,1,'regular');
      INSERT INTO episode_versions VALUES(13,11,'sub'),(14,12,'sub'),(22,21,'sub');`);
    const tms = { ...source, id: 'tms-god-mars-playlist', publisher: 'TMS Entertainment', channelId: 'UCzGf0DdUJVrsbcWL3e_tK1Q' };
    const gundam = { ...source, id: 'gundam-info' };
    const remow = { ...source, id: 'remow-its-anime' };
    const proposalCandidate: OfficialYouTubeReviewCandidate = {
      ...candidate,
      candidateId: 'youtube:abcdefghijk',
      sourceId: tms.id,
      publisher: tms.publisher,
      channelId: tms.channelId,
      video: { ...candidate.video, videoId: 'abcdefghijk', title: 'GOD MARS - EP01 Who Am I?! | English Sub | Full Episode', channelId: tms.channelId },
      probe: { ...candidate.probe!, videoId: 'abcdefghijk', title: 'GOD MARS - EP01 Who Am I?! | English Sub | Full Episode', channelId: tms.channelId, availableCountries: ['US'] },
      parsedEpisode: { kind: 'regular', number: 1 },
      match: { titleId: 20, titleSourceId: 'pluto', episodeId: 21, episodeSourceId: 'pluto-episode-1', versionId: 22, versionSourceId: 'pluto-episode-1:sub', language: 'sub', method: 'scored-alias' },
    };
    const configWithSeries: OfficialYouTubeDiscoveryConfig = { version: 1, shardCount: 500, playbackPolicies: [], sources: [tms, gundam, remow] };
    const proposals = buildOfficialSeriesApprovalProposals(configWithSeries, [proposalCandidate], db);
    expect(proposals.find((item) => item.seriesId === 'god-mars')).toMatchObject({
      status: 'proposed-not-applied',
      observedSingleEpisodes: [1],
      missingCatalogueEpisodes: [2],
      warnings: ['non-authoritative-matcher-disagreement-ignored'],
      matcherDisagreements: [{ episodeNumber: 1, videoId: 'abcdefghijk', matchMethod: 'scored-alias', issues: ['title', 'episode-version'], found: { titleId: 20 }, expected: { titleId: 10, episodeId: 11, versionId: 13, language: 'sub' } }],
      entries: [{ videoId: 'abcdefghijk', episodeId: 11, versionId: 13 }],
    });
    expect(proposals.find((item) => item.seriesId === 'after-war-gundam-x')).toMatchObject({ status: 'hold', heldReasons: expect.arrayContaining(['no-single-episode-videos']) });
    const authoritativeMismatch = buildOfficialSeriesApprovalProposals(configWithSeries, [{
      ...proposalCandidate,
      match: { ...proposalCandidate.match!, method: 'authoritative' },
    }], db).find((item) => item.seriesId === 'god-mars');
    expect(authoritativeMismatch).toMatchObject({ status: 'hold', heldReasons: ['authoritative-matcher-disagreement'], entries: [] });
    db.close();
  });
});
