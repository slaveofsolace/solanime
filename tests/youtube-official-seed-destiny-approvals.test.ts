import { describe, expect, it } from 'vitest';
import { GUNDAM_INFO_PUBLISHER, officialYouTubePublisherPolicyForChannel } from '../shared/youtubeOfficialPublishers.ts';
import { GUNDAM_SEED_DESTINY_OFFICIAL_YOUTUBE_EPISODE_APPROVALS } from '../server/ingestion/youtubeOfficialSeedDestinyApprovals.ts';

describe('Gundam SEED Destiny official YouTube approvals', () => {
  it('preserves all 50 unique episode and video identities', () => {
    const approvals = GUNDAM_SEED_DESTINY_OFFICIAL_YOUTUBE_EPISODE_APPROVALS;
    expect(approvals).toHaveLength(50);
    expect(approvals.map((approval) => Number(approval.catalogue.episodeNumber))).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1),
    );
    expect(new Set(approvals.map((approval) => approval.id)).size).toBe(50);
    expect(new Set(approvals.map((approval) => approval.video.id)).size).toBe(50);
    expect(new Set(approvals.map((approval) => approval.catalogue.versionSourceId)).size).toBe(50);
  });

  it('uses the reviewed catalogue crosswalk and implemented Gundam publisher policy', () => {
    for (const approval of GUNDAM_SEED_DESTINY_OFFICIAL_YOUTUBE_EPISODE_APPROVALS) {
      expect(approval.catalogue).toMatchObject({
        source: 'anikoto',
        titleSourceId: '2296',
        titleSlug: 'mobile-suit-gundam-seed-destiny-rp0ht',
        language: 'sub',
      });
      expect(approval.catalogue.versionSourceId).toBe(`${approval.catalogue.episodeSourceId}:sub`);
      expect(approval.video.channelId).toBe(GUNDAM_INFO_PUBLISHER.channelId);
      expect(approval.video.title).toMatch(/^Mobile Suit Gundam SEED DESTINY HD Remaster - Episode\d+ \(w\/subtitles\)$/);
      expect(approval.video.watchUrl).toBe(`https://www.youtube.com/watch?v=${approval.video.id}`);
      expect(approval.titleIdentityUrl).toBe('https://es.gundam.info/movies/movie/movies_movie_20171002_141p.html');
      expect(approval.episodeIdentityUrl).toBe(approval.titleIdentityUrl);
      expect(officialYouTubePublisherPolicyForChannel(approval.video.channelId)?.publisher).toBe(GUNDAM_INFO_PUBLISHER);
      expect(Number.isFinite(Date.parse(approval.observedAt))).toBe(true);
    }
  });
});
