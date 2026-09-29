import { describe, expect, it } from 'vitest';
import { TMS_PUBLISHER, officialYouTubePublisherPolicyForChannel } from '../shared/youtubeOfficialPublishers.ts';
import { TMS_LOST_CANVAS_OFFICIAL_YOUTUBE_EPISODE_APPROVALS } from '../server/ingestion/youtubeOfficialLostCanvasApprovals.ts';

describe('TMS Lost Canvas official YouTube approvals', () => {
  it('preserves all 26 unique episode and video identities', () => {
    const approvals = TMS_LOST_CANVAS_OFFICIAL_YOUTUBE_EPISODE_APPROVALS;
    expect(approvals).toHaveLength(26);
    expect(approvals.map((approval) => Number(approval.catalogue.episodeNumber))).toEqual(
      Array.from({ length: 26 }, (_, index) => index + 1),
    );
    expect(new Set(approvals.map((approval) => approval.id)).size).toBe(26);
    expect(new Set(approvals.map((approval) => approval.video.id)).size).toBe(26);
    expect(new Set(approvals.map((approval) => approval.catalogue.versionSourceId)).size).toBe(26);
  });

  it('uses the reviewed catalogue crosswalk and implemented TMS publisher policy', () => {
    for (const approval of TMS_LOST_CANVAS_OFFICIAL_YOUTUBE_EPISODE_APPROVALS) {
      expect(approval.catalogue).toMatchObject({
        source: 'anikoto',
        titleSourceId: '796',
        titleSlug: 'saint-seiya-knights-of-the-zodiac-brrn4',
        language: 'sub',
      });
      expect(approval.catalogue.versionSourceId).toBe(`${approval.catalogue.episodeSourceId}:sub`);
      expect(approval.video.channelId).toBe(TMS_PUBLISHER.channelId);
      expect(approval.video.title).toMatch(/^SAINT SEIYA - THE LOST CANVAS - EP\d{2}.+\| English Sub \| Full Episode$/);
      expect(approval.video.watchUrl).toBe(`https://www.youtube.com/watch?v=${approval.video.id}`);
      expect(officialYouTubePublisherPolicyForChannel(approval.video.channelId)?.publisher).toBe(TMS_PUBLISHER);
      expect(Number.isFinite(Date.parse(approval.observedAt))).toBe(true);
    }
  });
});
