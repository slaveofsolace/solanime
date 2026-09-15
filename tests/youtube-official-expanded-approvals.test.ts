import { describe, expect, it, vi } from 'vitest';
import {
  EXPANDED_OFFICIAL_YOUTUBE_EPISODE_APPROVALS,
  REMOW_YAKITATE_JAPAN_EPISODE_APPROVALS,
  TMS_GOD_MARS_EPISODE_APPROVALS,
} from '../server/ingestion/youtubeOfficialExpandedApprovals.ts';
import { verifyOfficialYouTubeOEmbed } from '../server/ingestion/youtubeOfficial.ts';
import {
  officialYouTubePublisherPolicyForChannel,
  REMOW_PUBLISHER,
  TMS_PUBLISHER,
} from '../shared/youtubeOfficialPublishers.ts';

function sample<T>(values: readonly T[]): T[] {
  return [values[0], values[Math.floor(values.length / 2)], values[values.length - 1]];
}

describe('expanded official YouTube approvals', () => {
  it('contains exact, duplicate-free episode sequences for the two reviewed series', () => {
    expect(TMS_GOD_MARS_EPISODE_APPROVALS).toHaveLength(64);
    expect(REMOW_YAKITATE_JAPAN_EPISODE_APPROVALS).toHaveLength(69);
    expect(EXPANDED_OFFICIAL_YOUTUBE_EPISODE_APPROVALS).toHaveLength(133);
    expect(TMS_GOD_MARS_EPISODE_APPROVALS.map((approval) => Number(approval.catalogue.episodeNumber))).toEqual(Array.from({ length: 64 }, (_, index) => index + 1));
    expect(REMOW_YAKITATE_JAPAN_EPISODE_APPROVALS.map((approval) => Number(approval.catalogue.episodeNumber))).toEqual(Array.from({ length: 69 }, (_, index) => index + 1));
    expect(new Set(EXPANDED_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((approval) => approval.id))).toHaveLength(133);
    expect(new Set(EXPANDED_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((approval) => approval.video.id))).toHaveLength(133);
    expect(new Set(EXPANDED_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((approval) => `${approval.catalogue.titleSourceId}:${approval.catalogue.versionSourceId}`))).toHaveLength(133);
    for (const approval of EXPANDED_OFFICIAL_YOUTUBE_EPISODE_APPROVALS) {
      expect(approval.catalogue.source).toBe('anikoto');
      expect(approval.catalogue.language).toBe('sub');
      expect(approval.catalogue.versionSourceId).toBe(`${approval.catalogue.episodeSourceId}:sub`);
      expect(approval.video.watchUrl).toBe(`https://www.youtube.com/watch?v=${approval.video.id}`);
      expect(approval.episodeIdentityUrl).toBe(approval.video.watchUrl);
    }
    expect(TMS_GOD_MARS_EPISODE_APPROVALS.every((approval) => /^GOD MARS - EP\d{2}\b/.test(approval.video.title))).toBe(true);
    expect(REMOW_YAKITATE_JAPAN_EPISODE_APPROVALS.every((approval) => /^Full Episode \d{2}\s*\| Yakitate!! JAPAN \| It's Anime/.test(approval.video.title))).toBe(true);
  });

  it('uses exact first-party publisher policies and fails closed on label or channel drift', async () => {
    expect(officialYouTubePublisherPolicyForChannel(TMS_PUBLISHER.channelId)).toMatchObject({
      publisher: TMS_PUBLISHER,
      identityUrl: 'https://tmsanime.com/anime-on-tms-official-channel',
    });
    for (const approval of [...sample(TMS_GOD_MARS_EPISODE_APPROVALS), ...sample(REMOW_YAKITATE_JAPAN_EPISODE_APPROVALS)]) {
      const publisher = approval.video.channelId === TMS_PUBLISHER.channelId ? TMS_PUBLISHER : REMOW_PUBLISHER;
      const fetcher = vi.fn(async () => new Response(JSON.stringify({
        type: 'video',
        provider_name: 'YouTube',
        title: approval.video.title,
        author_name: publisher.label,
        author_url: publisher.handleUrl,
        html: `<iframe src="https://www.youtube.com/embed/${approval.video.id}"></iframe>`,
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
      await expect(verifyOfficialYouTubeOEmbed(approval, fetcher)).resolves.toEqual({ title: approval.video.title, author: publisher.label });
      expect(fetcher).toHaveBeenCalledOnce();
    }
    const drifted = { ...TMS_GOD_MARS_EPISODE_APPROVALS[0], video: { ...TMS_GOD_MARS_EPISODE_APPROVALS[0].video, channelId: 'UC00000000000000000000' } };
    await expect(verifyOfficialYouTubeOEmbed(drifted, vi.fn())).rejects.toThrow('INVALID_OFFICIAL_YOUTUBE_APPROVAL');
  });
});
