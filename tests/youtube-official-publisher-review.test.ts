import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { auditCatalogueExternalIds, buildOfficialPublisherReview, buildOfficialSeriesApprovalProposals } from '../server/ingestion/youtubeOfficialPublisherReview.ts';
import type { OfficialYouTubeDiscoveryConfig, OfficialYouTubeReviewCandidate, SourceInventoryCheckpoint } from '../server/ingestion/youtubeOfficialDiscovery.ts';
import type { OfficialYouTubeBatchApprovalPlan } from '../server/ingestion/youtubeOfficialBatchApproval.ts';

const source = { id: 'publisher-source', kind: 'channel' as const, publisher: 'Publisher', channelId: 'UCsj_CYajUSQ2ca8bYCMan9g', channelUrl: 'https://www.youtube.com/channel/UCsj_CYajUSQ2ca8bYCMan9g', evidenceUrls: ['https://publisher.example/evidence'], fullEpisodeEvidenceUrl: 'https://publisher.example/full-episodes', territoryNote: 'Varies.', defaultLanguage: 'sub', disposition: 'reference-only' as const };
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
    const tmsChannel = { ...source, id: 'tms-anime-official', publisher: 'TMS Entertainment', channelId: 'UCzGf0DdUJVrsbcWL3e_tK1Q' };
    const configWithSeries: OfficialYouTubeDiscoveryConfig = { version: 1, shardCount: 500, playbackPolicies: [], sources: [tms, tmsChannel, gundam, remow] };
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

  it('proposes observed exact subtitled episodes while reporting partial-series gaps', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE titles(id INTEGER PRIMARY KEY,source TEXT,source_id TEXT,name TEXT);
      CREATE TABLE title_aliases(title_id INTEGER,alias TEXT);
      CREATE TABLE episodes(id INTEGER PRIMARY KEY,title_id INTEGER,number_sort REAL,episode_type TEXT);
      CREATE TABLE episode_versions(id INTEGER PRIMARY KEY,episode_id INTEGER,language TEXT);
      CREATE TABLE episode_provider_mappings(version_id INTEGER,provider_id TEXT,provider_resource_id TEXT);
      INSERT INTO titles VALUES
        (10,'anikoto','tetsujin','Tetsujin 28'),(20,'anikoto','mazinger','God Mazinger'),
        (30,'anikoto','actually','Actually, I am...'),(40,'anikoto','tsukumogami','We Rent Tsukumogami'),
        (50,'anikoto','brave','Brave 10'),(60,'anikoto','boogiepop','Boogiepop Phantom');
      INSERT INTO episodes VALUES
        (11,10,1,'regular'),(12,10,4,'regular'),(21,20,11,'regular'),(31,30,1,'regular'),
        (41,40,9,'regular'),(51,50,7,'regular'),(61,60,5,'regular');
      INSERT INTO episode_versions VALUES
        (101,11,'sub'),(102,12,'sub'),(201,21,'sub'),(301,31,'sub'),(401,41,'sub'),(501,51,'sub'),(601,61,'sub');`);
    const tms = { ...source, id: 'tms-anime-official', publisher: 'TMS Entertainment', channelId: 'UCzGf0DdUJVrsbcWL3e_tK1Q' };
    const remow = { ...source, id: 'remow-its-anime' };
    const candidates = [
      ['tms-anime-official', 'tetsujin01', 'New Tetsujin 28 - EP04 The Robot Birdman | English Sub | Full Episode'],
      ['tms-anime-official', 'mazinger001', 'GOD MAZINGER - EP11 The Captive Aira | English Sub | Full Episode'],
      ['tms-anime-official', 'actually001', "Actually, I am… - EP01 I'll Confess! | English Sub | Full Episode"],
      ['tms-anime-official', 'tsukumo0001', 'We Rent Tsukumogami - EP09 Hisoku | English Sub | Full Episode'],
      ['tms-anime-official', 'brave100001', 'BRAVE 10 - EP07 Sword and Fan | English Sub | Full Episode'],
      ['remow-its-anime', 'boogie00001', "Full Episode 5 | BOOGIEPOP PHANTOM | It's Anime［Multi-Subs］"],
    ].map(([sourceId, videoId, title], index): OfficialYouTubeReviewCandidate => {
      const channelId = sourceId === 'tms-anime-official' ? tms.channelId : remow.channelId;
      return {
        ...candidate,
        candidateId: `youtube:${videoId}`,
        sourceId,
        publisher: sourceId === 'tms-anime-official' ? tms.publisher : remow.publisher,
        channelId,
        video: { ...candidate.video, videoId, title, channelId, durationSeconds: 1_440 },
        probe: { ...candidate.probe!, videoId, title, channelId, durationSeconds: 1_440, availableCountries: ['US'] },
        parsedEpisode: { kind: 'regular', number: [4, 11, 1, 9, 7, 5][index] },
        match: null,
      };
    });
    const proposals = buildOfficialSeriesApprovalProposals({ version: 1, shardCount: 500, playbackPolicies: [], sources: [
      { ...tms, id: 'tms-god-mars-playlist', kind: 'playlist', playlistId: 'PLj2Ugc-vxcWGDWFMIlD5i-gz3u2s4tMa-' },
      tms,
      { ...source, id: 'gundam-info' },
      remow,
    ] }, candidates, db);
    const expected = ['new-tetsujin-28', 'god-mazinger', 'actually-i-am', 'we-rent-tsukumogami', 'brave-10', 'boogiepop-phantom'];
    expect(proposals.filter((proposal) => expected.includes(proposal.seriesId))).toEqual(expect.arrayContaining(expected.map((seriesId) => expect.objectContaining({ seriesId, status: 'proposed-not-applied', publishedAudioLanguage: 'sub', entries: [expect.any(Object)] }))));
    expect(proposals.find((proposal) => proposal.seriesId === 'new-tetsujin-28')).toMatchObject({ observedSingleEpisodes: [4], missingCatalogueEpisodes: [1] });
    db.close();
  });

  it('holds dubbed publisher episodes when the catalogue only has a subtitled version', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE titles(id INTEGER PRIMARY KEY,source TEXT,source_id TEXT,name TEXT);
      CREATE TABLE title_aliases(title_id INTEGER,alias TEXT);
      CREATE TABLE episodes(id INTEGER PRIMARY KEY,title_id INTEGER,number_sort REAL,episode_type TEXT);
      CREATE TABLE episode_versions(id INTEGER PRIMARY KEY,episode_id INTEGER,language TEXT);
      CREATE TABLE episode_provider_mappings(version_id INTEGER,provider_id TEXT,provider_resource_id TEXT);
      INSERT INTO titles VALUES(10,'anikoto','sonic','Sonic X'),(20,'anikoto','devil','The Devil Lady'),(30,'anikoto','sherlock','Sherlock Hound'),(40,'anikoto','cybersix','Cybersix');
      INSERT INTO episodes VALUES(11,10,1,'regular'),(21,20,5,'regular'),(31,30,8,'regular'),(41,40,5,'regular');
      INSERT INTO episode_versions VALUES(12,11,'sub'),(22,21,'sub'),(32,31,'sub'),(42,41,'sub');`);
    const tms = { ...source, id: 'tms-anime-official', publisher: 'TMS Entertainment', channelId: 'UCzGf0DdUJVrsbcWL3e_tK1Q' };
    const titles = [
      'SONIC X - EP01 Chaos Control Freaks | English Dub | Full Episode',
      'Go Nagai\'s "The Devil Lady" - EP05 Shark | English Dub | Full Episode',
      'Sherlock Hound - EP08 The Green Balloon | English Dub | Full Episode',
      'CYBERSIX - EP05 Lori is Missing | English Dub | Full Episode',
    ];
    const candidates = titles.map((title, index): OfficialYouTubeReviewCandidate => ({
      ...candidate,
      candidateId: `youtube:dubvideo00${index}`,
      sourceId: tms.id,
      publisher: tms.publisher,
      channelId: tms.channelId,
      video: { ...candidate.video, videoId: `dubvideo00${index}`, title, channelId: tms.channelId },
      probe: { ...candidate.probe!, videoId: `dubvideo00${index}`, title, channelId: tms.channelId, availableCountries: ['US'] },
      match: null,
    }));
    const proposals = buildOfficialSeriesApprovalProposals({ version: 1, shardCount: 500, playbackPolicies: [], sources: [
      { ...tms, id: 'tms-god-mars-playlist', kind: 'playlist', playlistId: 'PLj2Ugc-vxcWGDWFMIlD5i-gz3u2s4tMa-' }, tms, { ...source, id: 'gundam-info' }, { ...source, id: 'remow-its-anime' },
    ] }, candidates, db);
    for (const seriesId of ['sonic-x', 'the-devil-lady', 'sherlock-hound', 'cybersix']) {
      expect(proposals.find((proposal) => proposal.seriesId === seriesId)).toMatchObject({ status: 'hold', publishedAudioLanguage: 'dub', heldReasons: expect.arrayContaining(['published-audio-language-catalogue-version-mismatch']), entries: [] });
    }
    db.close();
  });

  it('rejects an episode unless duration, channel, embed, territory, and unmapped-version gates all pass', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE titles(id INTEGER PRIMARY KEY,source TEXT,source_id TEXT,name TEXT);
      CREATE TABLE title_aliases(title_id INTEGER,alias TEXT);
      CREATE TABLE episodes(id INTEGER PRIMARY KEY,title_id INTEGER,number_sort REAL,episode_type TEXT);
      CREATE TABLE episode_versions(id INTEGER PRIMARY KEY,episode_id INTEGER,language TEXT);
      CREATE TABLE episode_provider_mappings(version_id INTEGER,provider_id TEXT,provider_resource_id TEXT);
      INSERT INTO titles VALUES(10,'anikoto','tetsujin','Tetsujin 28');
      INSERT INTO episodes VALUES(11,10,4,'regular');
      INSERT INTO episode_versions VALUES(12,11,'sub');
      INSERT INTO episode_provider_mappings VALUES(12,'youtube-official','existing001');`);
    const tms = { ...source, id: 'tms-anime-official', publisher: 'TMS Entertainment', channelId: 'UCzGf0DdUJVrsbcWL3e_tK1Q' };
    const proposalCandidate: OfficialYouTubeReviewCandidate = {
      ...candidate,
      candidateId: 'youtube:strictgate1',
      sourceId: tms.id,
      publisher: tms.publisher,
      channelId: tms.channelId,
      video: { ...candidate.video, videoId: 'strictgate1', title: 'New Tetsujin 28 - EP04 The Robot Birdman | English Sub | Full Episode', channelId: 'UCwrong_channel_identity', durationSeconds: 900 },
      probe: { ...candidate.probe!, videoId: 'strictgate1', title: 'New Tetsujin 28 - EP04 The Robot Birdman | English Sub | Full Episode', channelId: 'UCwrong_channel_identity', durationSeconds: 900, availability: 'embed-disabled', playableInEmbed: false, availableCountries: [] },
      match: null,
    };
    const proposal = buildOfficialSeriesApprovalProposals({ version: 1, shardCount: 500, playbackPolicies: [], sources: [
      { ...tms, id: 'tms-god-mars-playlist', kind: 'playlist', playlistId: 'PLj2Ugc-vxcWGDWFMIlD5i-gz3u2s4tMa-' }, tms, { ...source, id: 'gundam-info' }, { ...source, id: 'remow-its-anime' },
    ] }, [proposalCandidate], db).find((item) => item.seriesId === 'new-tetsujin-28');
    expect(proposal).toMatchObject({
      status: 'hold',
      heldReasons: expect.arrayContaining(['not-full-episode', 'publisher-channel-mismatch', 'embed-not-playable', 'not-observed-in-us', 'existing-official-youtube-mapping']),
      rejectedSingleEpisodes: [4],
      rejectedReasons: { 'embed-not-playable': 1, 'existing-official-youtube-mapping': 1, 'not-full-episode': 1, 'not-observed-in-us': 1, 'publisher-channel-mismatch': 1 },
      entries: [],
    });
    db.close();
  });

  it('keeps known fuzzy catalogue hazards explicitly excluded', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE titles(id INTEGER PRIMARY KEY,source TEXT,source_id TEXT,name TEXT);
      CREATE TABLE title_aliases(title_id INTEGER,alias TEXT);
      CREATE TABLE episodes(id INTEGER PRIMARY KEY,title_id INTEGER,number_sort REAL,episode_type TEXT);
      CREATE TABLE episode_versions(id INTEGER PRIMARY KEY,episode_id INTEGER,language TEXT);
      CREATE TABLE episode_provider_mappings(version_id INTEGER,provider_id TEXT,provider_resource_id TEXT);
      INSERT INTO titles VALUES(10,'anikoto','lost','Saint Seiya: The Lost Canvas'),(20,'anikoto','frog','The Gutsy Frog');
      INSERT INTO episodes VALUES(11,10,1,'regular'),(21,20,1,'regular');
      INSERT INTO episode_versions VALUES(12,11,'sub'),(22,21,'sub');`);
    const tms = { ...source, id: 'tms-anime-official', publisher: 'TMS Entertainment', channelId: 'UCzGf0DdUJVrsbcWL3e_tK1Q' };
    const candidates = [
      'SAINT SEIYA - THE LOST CANVAS - EP01 The Promise | English Sub | Full Episode',
      'The Gutsy Frog - EP01 Pyonkichi Arrives | English Sub',
    ].map((title, index): OfficialYouTubeReviewCandidate => ({ ...candidate, candidateId: `youtube:excluded00${index}`, sourceId: tms.id, publisher: tms.publisher, channelId: tms.channelId, video: { ...candidate.video, videoId: `excluded00${index}`, title, channelId: tms.channelId }, probe: { ...candidate.probe!, videoId: `excluded00${index}`, title, channelId: tms.channelId, availableCountries: ['US'] }, match: null }));
    const proposals = buildOfficialSeriesApprovalProposals({ version: 1, shardCount: 500, playbackPolicies: [], sources: [
      { ...tms, id: 'tms-god-mars-playlist', kind: 'playlist', playlistId: 'PLj2Ugc-vxcWGDWFMIlD5i-gz3u2s4tMa-' }, tms, { ...source, id: 'gundam-info' }, { ...source, id: 'remow-its-anime' },
    ] }, candidates, db);
    expect(proposals.find((proposal) => proposal.seriesId === 'saint-seiya-lost-canvas-excluded')).toMatchObject({ status: 'hold', heldReasons: expect.arrayContaining(['excluded-fuzzy-target-is-knights-of-the-zodiac']), entries: [] });
    expect(proposals.find((proposal) => proposal.seriesId === 'the-gutsy-frog-excluded')).toMatchObject({ status: 'hold', heldReasons: expect.arrayContaining(['excluded-ambiguous-fuzzy-catalogue-hits']), entries: [] });
    db.close();
  });
});
