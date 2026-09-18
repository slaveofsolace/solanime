import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { planOfficialYouTubeBatchApprovals } from '../server/ingestion/youtubeOfficialBatchApproval.ts';
import { REMOW_PUBLISHER } from '../server/providers/youtubeOfficial.ts';
import type { OfficialPublisherSource, OfficialYouTubeReviewCandidate } from '../server/ingestion/youtubeOfficialDiscovery.ts';

let db: DatabaseSync;

const source: OfficialPublisherSource = {
  id: 'remow-its-anime', kind: 'channel', publisher: REMOW_PUBLISHER.label,
  channelId: REMOW_PUBLISHER.channelId, channelUrl: REMOW_PUBLISHER.channelUrl,
  evidenceUrls: ['https://www.remow.com/en/service/'], fullEpisodeEvidenceUrl: 'https://www.remow.com/en/service/',
  territoryNote: 'Availability varies.', defaultLanguage: 'sub', disposition: 'reference-only',
  authoritativeMappings: [{ videoId: '_3Gcm-iGAQk', titleSourceId: '6771', episodeSourceId: '104039', versionSourceId: '104039:sub', language: 'sub', identityEvidenceUrls: ['https://www.youtube.com/watch?v=_3Gcm-iGAQk'] }],
};

function database(): DatabaseSync {
  const value = new DatabaseSync(':memory:');
  value.exec(`
    CREATE TABLE titles(id INTEGER PRIMARY KEY,source TEXT,source_id TEXT);
    CREATE TABLE episodes(id INTEGER PRIMARY KEY,title_id INTEGER,source_id TEXT);
    CREATE TABLE episode_versions(id INTEGER PRIMARY KEY,episode_id INTEGER,source_id TEXT,language TEXT);
    CREATE TABLE episode_provider_mappings(id INTEGER PRIMARY KEY,provider_id TEXT,provider_resource_id TEXT,source_mapping_id TEXT);
    CREATE TABLE native_resources(mapping_id INTEGER PRIMARY KEY,provider_id TEXT,resource_id TEXT);
    INSERT INTO titles VALUES(2479,'anikoto','6771');
    INSERT INTO episodes VALUES(40765,2479,'104039');
    INSERT INTO episode_versions VALUES(52526,40765,'104039:sub','sub');
  `);
  return value;
}

function candidate(overrides: Partial<OfficialYouTubeReviewCandidate> = {}): OfficialYouTubeReviewCandidate {
  return {
    candidateId: 'youtube:_3Gcm-iGAQk', sourceId: source.id, publisher: source.publisher,
    channelId: source.channelId, evidenceUrls: [...source.evidenceUrls], rightsDisposition: 'reference-only', autoEnabled: false,
    video: { videoId: '_3Gcm-iGAQk', title: "Full Episode 01 | B-PROJECT Passion*Love Call | It's Anime [Multi-Subs]", channelId: source.channelId, channelLabel: source.publisher, durationSeconds: 1435, publishedText: null, playlistIndex: 1 },
    probe: { videoId: '_3Gcm-iGAQk', title: "Full Episode 01 | B-PROJECT Passion*Love Call | It's Anime [Multi-Subs]", channelId: source.channelId, channelLabel: source.publisher, durationSeconds: 1435, publishDate: '2023-10-01', availability: 'playable', playableInEmbed: true, reason: null, observedAt: '2026-09-13T00:00:00.000Z', observationRegion: 'us-central', availableCountries: ['US'] },
    parsedEpisode: { kind: 'regular', number: 1 }, fullEpisodeCandidate: true, confidence: 1,
    decision: 'manual-review', reasonCodes: ['manual-rights-and-identity-review-required'],
    match: { titleId: 2479, titleSourceId: '6771', episodeId: 40765, episodeSourceId: '104039', versionId: 52526, versionSourceId: '104039:sub', language: 'sub', method: 'authoritative' },
    ...overrides,
  };
}

afterEach(() => db?.close());

describe('official YouTube batch approval gate', () => {
  it('admits only the exact independently reviewed authoritative crosswalk', () => {
    db = database();
    const plan = planOfficialYouTubeBatchApprovals(db, [candidate()], [source], '2026-09-13T20:00:00.000Z');
    expect(plan).toMatchObject({ inputManualReviewCandidates: 1, eligibleCount: 1, heldCount: 0, autoApplied: false });
    expect(plan.entries[0]).toMatchObject({ decision: 'eligible', reasonCodes: [] });
  });

  it('reconciles an exact reviewed approval even when discovery used a scored alias', () => {
    db = database();
    const scored = candidate({ match: { ...candidate().match!, method: 'scored-alias' } });
    const plan = planOfficialYouTubeBatchApprovals(db, [scored], [source], '2026-09-13T20:00:00.000Z');
    expect(plan.entries[0]).toMatchObject({ decision: 'eligible', reasonCodes: [] });
  });

  it('holds an otherwise valid record when the video is already mapped', () => {
    db = database();
    db.prepare("INSERT INTO episode_provider_mappings VALUES(1,'youtube-official','_3Gcm-iGAQk','youtube:_3Gcm-iGAQk')").run();
    const entry = planOfficialYouTubeBatchApprovals(db, [candidate()], [source], '2026-09-13T20:00:00.000Z').entries[0];
    expect(entry.decision).toBe('hold');
    expect(entry.reasonCodes).toContain('existing-official-youtube-duplicate');
  });

  it('holds exact aliases without independent review records and rejects packs', () => {
    db = database();
    const alias = candidate({
      candidateId: 'youtube:abcdefghijk',
      video: { ...candidate().video, videoId: 'abcdefghijk', title: 'B-PROJECT Full Episodes 01-03' },
      probe: { ...candidate().probe!, videoId: 'abcdefghijk', title: 'B-PROJECT Full Episodes 01-03' },
      match: { ...candidate().match!, method: 'exact-alias' },
    });
    const entry = planOfficialYouTubeBatchApprovals(db, [alias], [source], '2026-09-13T20:00:00.000Z').entries[0];
    expect(entry.decision).toBe('hold');
    expect(entry.reasonCodes).toEqual(expect.arrayContaining(['exact-alias-requires-independent-evidence', 'episode-pack-range-recap-or-binge']));
  });

  it('holds non-US, embed-disabled, special, ambiguous-language, and duplicate target records', () => {
    db = database();
    const first = candidate({ parsedEpisode: { kind: 'special', number: 1 }, probe: { ...candidate().probe!, availability: 'embed-disabled', playableInEmbed: false, availableCountries: ['JP'] } });
    const second = candidate({ candidateId: 'youtube:abcdefghijk', video: { ...candidate().video, videoId: 'abcdefghijk' }, probe: { ...candidate().probe!, videoId: 'abcdefghijk' } });
    const plan = planOfficialYouTubeBatchApprovals(db, [first, second], [source], '2026-09-13T20:00:00.000Z');
    expect(plan.eligibleCount).toBe(0);
    expect(plan.entries[0].reasonCodes).toEqual(expect.arrayContaining(['embed-not-playable', 'us-availability-unconfirmed', 'not-exact-single-regular-episode', 'duplicate-version-candidate']));
    expect(plan.entries[1].reasonCodes).toEqual(expect.arrayContaining(['authoritative-evidence-crosswalk-mismatch', 'reviewed-approval-record-missing-or-mismatched', 'duplicate-version-candidate']));
  });
});
