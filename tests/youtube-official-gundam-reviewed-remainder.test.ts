import { describe, expect, it } from 'vitest';
import { GUNDAM_INFO_PUBLISHER, officialYouTubePublisherPolicyForChannel } from '../shared/youtubeOfficialPublishers.ts';
import { GUNDAM_REVIEWED_REMAINDER_OFFICIAL_YOUTUBE_EPISODE_APPROVALS } from '../server/ingestion/youtubeOfficialGundamReviewedRemainderApprovals.ts';

describe('reviewed Gundam official YouTube remainder', () => {
  it('keeps both exact series and episode identities distinct', () => {
    const approvals = GUNDAM_REVIEWED_REMAINDER_OFFICIAL_YOUTUBE_EPISODE_APPROVALS;
    expect(approvals).toHaveLength(2);
    expect(new Set(approvals.map((approval) => approval.id)).size).toBe(2);
    expect(new Set(approvals.map((approval) => approval.video.id)).size).toBe(2);
    expect(approvals.map((approval) => approval.catalogue.titleSourceId).sort()).toEqual(['4243', '6754']);
    for (const approval of approvals) {
      expect(approval.catalogue).toMatchObject({ source: 'anikoto', episodeNumber: '1', language: 'sub' });
      expect(approval.catalogue.versionSourceId).toBe(`${approval.catalogue.episodeSourceId}:sub`);
      expect(approval.video.channelId).toBe(GUNDAM_INFO_PUBLISHER.channelId);
      expect(approval.video.watchUrl).toBe(`https://www.youtube.com/watch?v=${approval.video.id}`);
      expect(officialYouTubePublisherPolicyForChannel(approval.video.channelId)?.publisher).toBe(GUNDAM_INFO_PUBLISHER);
      expect(Number.isFinite(Date.parse(approval.observedAt))).toBe(true);
    }
  });
});
