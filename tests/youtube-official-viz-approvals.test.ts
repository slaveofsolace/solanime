import { describe, expect, it } from 'vitest';
import {
  VIZ_MEDIA_PUBLISHER,
  VIZ_MEDIA_PUBLISHER_IDENTITY_URL,
  isExactOfficialYouTubePublisher,
  officialYouTubePublisherPolicyForChannel,
  officialYouTubePublisherPolicyForChannelUrl,
} from '../shared/youtubeOfficialPublishers.ts';
import { VIZ_OFFICIAL_YOUTUBE_EPISODE_APPROVALS } from '../server/ingestion/youtubeOfficialVizApprovals.ts';
import discoveryConfig from '../config/official-youtube-discovery.json' with { type: 'json' };

const VIZ_CHANNEL_ID = 'UCV1da9peoqEwqr45bpTJsbQ';

describe('VIZ Media official YouTube publisher identity', () => {
  it('registers the exact VIZ publisher policy', () => {
    expect(VIZ_MEDIA_PUBLISHER.channelId).toBe(VIZ_CHANNEL_ID);
    expect(officialYouTubePublisherPolicyForChannel(VIZ_CHANNEL_ID)).toMatchObject({
      id: 'viz-media-official',
      publisher: VIZ_MEDIA_PUBLISHER,
      identityUrl: VIZ_MEDIA_PUBLISHER_IDENTITY_URL,
    });
    expect(
      officialYouTubePublisherPolicyForChannelUrl(VIZ_MEDIA_PUBLISHER.channelUrl),
    ).toMatchObject({ id: 'viz-media-official' });
  });

  it('rejects publisher drift on label, channel URL, or handle', () => {
    expect(isExactOfficialYouTubePublisher(VIZ_MEDIA_PUBLISHER)).toBe(true);
    for (const drift of [
      { ...VIZ_MEDIA_PUBLISHER, label: 'VIZ Media Official' },
      { ...VIZ_MEDIA_PUBLISHER, handleUrl: 'https://www.youtube.com/@viz-media' },
      { ...VIZ_MEDIA_PUBLISHER, channelUrl: 'https://www.youtube.com/@vizmedia' },
    ]) {
      expect(isExactOfficialYouTubePublisher(drift)).toBe(false);
    }
  });

  it('keeps every configured VIZ discovery source on the one reviewed channel', () => {
    const vizSources = discoveryConfig.sources.filter((source) =>
      source.id.startsWith('viz-'),
    );
    expect(vizSources.length).toBeGreaterThan(0);
    for (const source of vizSources) {
      expect(source.channelId).toBe(VIZ_CHANNEL_ID);
      expect(source.channelUrl).toBe(VIZ_MEDIA_PUBLISHER.channelUrl);
      expect(source.disposition).toBe('reference-only');
      expect(source.fullEpisodeEvidenceUrl).toBe(VIZ_MEDIA_PUBLISHER_IDENTITY_URL);
    }
  });
});

describe('VIZ Media approval registry gate', () => {
  it('enables no playback while the approval registry is empty', () => {
    const vizPolicies = discoveryConfig.playbackPolicies.filter(
      (policy) => policy.channelId === VIZ_CHANNEL_ID,
    );
    if (VIZ_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.length === 0) {
      expect(vizPolicies).toHaveLength(0);
      return;
    }
    expect(vizPolicies).toHaveLength(1);
    expect(vizPolicies[0]).toMatchObject({
      adapter: 'youtube-official',
      state: 'implemented',
      approvalRegistry: 'VIZ_OFFICIAL_YOUTUBE_EPISODE_APPROVALS',
    });
  });

  it('holds every approval to the reviewed VIZ channel and publisher evidence', () => {
    for (const approval of VIZ_OFFICIAL_YOUTUBE_EPISODE_APPROVALS) {
      expect(approval.video.channelId).toBe(VIZ_CHANNEL_ID);
      expect(approval.video.channelUrl).toBe(VIZ_MEDIA_PUBLISHER.channelUrl);
      expect(approval.video.handleUrl).toBe(VIZ_MEDIA_PUBLISHER.handleUrl);
      expect(approval.publisherIdentityUrl).toBe(VIZ_MEDIA_PUBLISHER_IDENTITY_URL);
      expect(approval.video.id).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(approval.catalogue.versionSourceId).toBe(
        `${approval.catalogue.episodeSourceId}:${approval.catalogue.language}`,
      );
      expect(approval.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});
