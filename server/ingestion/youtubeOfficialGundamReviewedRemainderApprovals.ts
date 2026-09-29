import type { OfficialYouTubeEpisodeApproval } from './youtubeOfficial.ts';
import { GUNDAM_INFO_PUBLISHER } from '../../shared/youtubeOfficialPublishers.ts';

// These rows were held by the fuzzy discovery pass because "Gundam" appears
// throughout the publisher inventory. Each crosswalk was subsequently reviewed
// against the complete on-video series name, the stable catalogue identity,
// the official Gundam series page, and a current standard oEmbed response.
export const GUNDAM_REVIEWED_REMAINDER_OFFICIAL_YOUTUBE_EPISODE_APPROVALS:
  readonly OfficialYouTubeEpisodeApproval[] = Object.freeze([
    {
      id: 'gundam-info-sd-gundam-world-heroes-episode-1',
      catalogue: {
        source: 'anikoto',
        titleSourceId: '6754',
        titleSlug: 'sd-gundam-world-heroes-dyc0y',
        episodeSourceId: '103613',
        episodeNumber: '1',
        versionSourceId: '103613:sub',
        language: 'sub',
      },
      video: {
        id: 'a_ai9Ekrg58',
        title: 'SD GUNDAM WORLD HEROES - Episode 1 "Falling Destiny"（EN,HK,TW,CN,KR,TH,VN,IT,FR,ID sub）',
        watchUrl: 'https://www.youtube.com/watch?v=a_ai9Ekrg58',
        channelId: GUNDAM_INFO_PUBLISHER.channelId,
        channelUrl: GUNDAM_INFO_PUBLISHER.channelUrl,
        handleUrl: GUNDAM_INFO_PUBLISHER.handleUrl,
      },
      publisherIdentityUrl: 'https://en.gundam-official.com/feature/gwoy/',
      titleIdentityUrl: 'https://en.gundam.info/about-gundam/series-pages/sdw-heroes/',
      episodeIdentityUrl: 'https://www.youtube.com/watch?v=a_ai9Ekrg58',
      observedAt: '2026-09-13T23:22:54.327Z',
    },
    {
      id: 'gundam-info-build-divers-episode-1',
      catalogue: {
        source: 'anikoto',
        titleSourceId: '4243',
        titleSlug: 'gundam-build-divers-iwwch',
        episodeSourceId: '69976',
        episodeNumber: '1',
        versionSourceId: '69976:sub',
        language: 'sub',
      },
      video: {
        id: 'bktN_TdP6yI',
        title: 'Gundam Build Divers-Episode 1: Welcome to GBN (EN,TW,HK,KR,FR,IT,TH sub)',
        watchUrl: 'https://www.youtube.com/watch?v=bktN_TdP6yI',
        channelId: GUNDAM_INFO_PUBLISHER.channelId,
        channelUrl: GUNDAM_INFO_PUBLISHER.channelUrl,
        handleUrl: GUNDAM_INFO_PUBLISHER.handleUrl,
      },
      publisherIdentityUrl: 'https://en.gundam-official.com/feature/gwoy/',
      titleIdentityUrl: 'https://en.gundam.info/about-gundam/series-pages/builddivers/',
      episodeIdentityUrl: 'https://www.youtube.com/watch?v=bktN_TdP6yI',
      observedAt: '2026-09-13T23:22:57.237Z',
    },
  ]);
