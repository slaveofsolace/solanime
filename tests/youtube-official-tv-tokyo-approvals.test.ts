import { describe, expect, it, vi } from 'vitest';
import {
  TV_TOKYO_ANIME_PUBLISHER,
  TV_TOKYO_ANIME_PUBLISHER_IDENTITY_URL,
  officialYouTubePublisherPolicyForChannel,
} from '../shared/youtubeOfficialPublishers.ts';
import { verifyOfficialYouTubeOEmbed } from '../server/ingestion/youtubeOfficial.ts';
import { TV_TOKYO_OFFICIAL_YOUTUBE_EPISODE_APPROVALS } from '../server/ingestion/youtubeOfficialTvTokyoApprovals.ts';

describe('TV Tokyo official YouTube approvals', () => {
  it('preserves the exact reviewed BIRDIE WING episode identity', () => {
    expect(TV_TOKYO_OFFICIAL_YOUTUBE_EPISODE_APPROVALS).toHaveLength(1);
    const approval = TV_TOKYO_OFFICIAL_YOUTUBE_EPISODE_APPROVALS[0];
    expect(approval).toMatchObject({
      catalogue: {
        titleSourceId: '7075',
        episodeSourceId: '108650',
        versionSourceId: '108650:sub',
        episodeNumber: '1',
        language: 'sub',
      },
      video: {
        id: '5siOk87rL4U',
        channelId: TV_TOKYO_ANIME_PUBLISHER.channelId,
      },
      publisherIdentityUrl: TV_TOKYO_ANIME_PUBLISHER_IDENTITY_URL,
    });
  });

  it('uses the exact TV Tokyo publisher policy and rejects publisher drift', async () => {
    expect(officialYouTubePublisherPolicyForChannel(TV_TOKYO_ANIME_PUBLISHER.channelId)).toMatchObject({
      publisher: TV_TOKYO_ANIME_PUBLISHER,
      identityUrl: TV_TOKYO_ANIME_PUBLISHER_IDENTITY_URL,
    });
    const approval = TV_TOKYO_OFFICIAL_YOUTUBE_EPISODE_APPROVALS[0];
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      type: 'video',
      provider_name: 'YouTube',
      title: approval.video.title,
      author_name: TV_TOKYO_ANIME_PUBLISHER.label,
      author_url: TV_TOKYO_ANIME_PUBLISHER.handleUrl,
      html: `<iframe src="https://www.youtube.com/embed/${approval.video.id}"></iframe>`,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(verifyOfficialYouTubeOEmbed(approval, fetcher)).resolves.toEqual({
      title: approval.video.title,
      author: TV_TOKYO_ANIME_PUBLISHER.label,
    });
    const drifted = {
      ...approval,
      video: { ...approval.video, handleUrl: 'https://www.youtube.com/@spoofed' },
    };
    await expect(verifyOfficialYouTubeOEmbed(drifted, vi.fn())).rejects.toThrow(
      'INVALID_OFFICIAL_YOUTUBE_APPROVAL',
    );
  });
});
