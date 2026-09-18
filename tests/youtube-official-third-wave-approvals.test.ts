import { describe, expect, it } from 'vitest';
import {
  REMOW_PUBLISHER,
  TMS_PUBLISHER,
  officialYouTubePublisherPolicyForChannel,
} from '../shared/youtubeOfficialPublishers.ts';
import { THIRD_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS } from '../server/ingestion/youtubeOfficialThirdWaveApprovals.ts';

describe('third-wave official YouTube approvals', () => {
  it('preserves 228 unique reviewed video and catalogue-version identities', () => {
    expect(THIRD_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS).toHaveLength(228);
    expect(new Set(THIRD_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((approval) => approval.id)).size).toBe(228);
    expect(new Set(THIRD_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((approval) => approval.video.id)).size).toBe(228);
    expect(new Set(THIRD_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((approval) => approval.catalogue.versionSourceId)).size).toBe(228);
  });

  it('uses only implemented TMS and REMOW publisher policies', () => {
    const allowedChannels = new Set<string>([TMS_PUBLISHER.channelId, REMOW_PUBLISHER.channelId]);
    for (const approval of THIRD_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS) {
      expect(allowedChannels.has(approval.video.channelId)).toBe(true);
      expect(officialYouTubePublisherPolicyForChannel(approval.video.channelId)).toBeDefined();
      expect(approval.catalogue.versionSourceId).toBe(`${approval.catalogue.episodeSourceId}:${approval.catalogue.language}`);
      expect(approval.video.watchUrl).toBe(`https://www.youtube.com/watch?v=${approval.video.id}`);
      expect(Number.isFinite(Date.parse(approval.observedAt))).toBe(true);
    }
  });

  it('keeps subtitle and dub crosswalks distinct', () => {
    expect(THIRD_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.some((approval) =>
      approval.id === 'tms-sonic-x-dub-episode-51'
      && approval.catalogue.versionSourceId === '64163:dub')).toBe(true);
    expect(THIRD_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.some((approval) =>
      approval.id === 'tms-sonic-x-sub-episode-51'
      && approval.catalogue.versionSourceId === '64163:sub')).toBe(true);
  });
});
