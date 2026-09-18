import {
  TV_TOKYO_ANIME_PUBLISHER,
  TV_TOKYO_ANIME_PUBLISHER_IDENTITY_URL,
} from '../../shared/youtubeOfficialPublishers.ts';
import type { OfficialYouTubeEpisodeApproval } from './youtubeOfficial.ts';

// Exact manually reviewed crosswalk. TV Tokyo's own announcement identifies
// this channel, the public oEmbed response identifies the uploader and embed,
// and the official series site identifies episode 1. Availability remains
// controlled by TV Tokyo and YouTube and may be time- or territory-limited.
export const TV_TOKYO_OFFICIAL_YOUTUBE_EPISODE_APPROVALS = Object.freeze([
  {
    id: 'tv-tokyo-birdie-wing-episode-1',
    catalogue: {
      source: 'anikoto',
      titleSourceId: '7075',
      titleSlug: 'birdie-wing-golf-girls-story-fxwej',
      episodeSourceId: '108650',
      episodeNumber: '1',
      versionSourceId: '108650:sub',
      language: 'sub',
    },
    video: {
      id: '5siOk87rL4U',
      title: '【公式】BIRDIE WING -Golf Girls\' Story- 第1話「レインボーバレット」',
      watchUrl: 'https://www.youtube.com/watch?v=5siOk87rL4U',
      channelId: TV_TOKYO_ANIME_PUBLISHER.channelId,
      channelUrl: TV_TOKYO_ANIME_PUBLISHER.channelUrl,
      handleUrl: TV_TOKYO_ANIME_PUBLISHER.handleUrl,
    },
    publisherIdentityUrl: TV_TOKYO_ANIME_PUBLISHER_IDENTITY_URL,
    titleIdentityUrl: 'https://www.birdie-wing.net/',
    episodeIdentityUrl: 'https://www.birdie-wing.net/story/1.php',
    observedAt: '2026-09-18T05:05:05.743Z',
  },
] as const satisfies readonly OfficialYouTubeEpisodeApproval[]);
