import type { OfficialYouTubeEpisodeApproval } from './youtubeOfficial.ts';
import { TMS_PUBLISHER } from '../../shared/youtubeOfficialPublishers.ts';

type LostCanvasRow = readonly [
  episodeNumber: string,
  episodeSourceId: string,
  videoId: string,
  videoTitle: string,
  observedAt: string,
];

// Manually reviewed against TMS's official series listing, the TMS title page,
// and the immutable discovery/probe record. The Anikoto title uses the franchise
// name, so this explicit crosswalk is intentionally not inferred at import time.
const LOST_CANVAS_ROWS = [
  ['1', '13589', 'CHjrTHd1Ru4', 'SAINT SEIYA - THE LOST CANVAS - EP01 Promise | English Sub | Full Episode', '2026-09-13T23:11:52.438Z'],
  ['2', '13590', 'pUBdibiBY9c', 'SAINT SEIYA - THE LOST CANVAS - EP02 The Awakening of Hades | English Sub | Full Episode', '2026-09-13T23:11:55.462Z'],
  ['3', '13591', '_87OkwHpa6w', 'SAINT SEIYA - THE LOST CANVAS - EP03 The Holy War Begins | English Sub | Full Episode', '2026-09-13T23:06:40.552Z'],
  ['4', '13592', 'bHcuA1fB_ZY', 'SAINT SEIYA - THE LOST CANVAS - EP04 The Prayer Wreaths | English Sub | Full Episode', '2026-09-13T23:06:07.232Z'],
  ['5', '13593', 'aFAEH_BWUfw', 'SAINT SEIYA - THE LOST CANVAS - EP05 The Poison Rose | English Sub | Full Episode', '2026-09-13T23:15:03.443Z'],
  ['6', '13594', 'a1B2QuA8kBQ', 'SAINT SEIYA - THE LOST CANVAS - EP06 Floral Funeral Procession | English Sub | Full Episode', '2026-09-13T23:03:30.736Z'],
  ['7', '13595', 'v8HNOoUO7to', 'SAINT SEIYA - THE LOST CANVAS - EP07 Golden Rain | English Sub | Full Episode', '2026-09-13T23:17:41.109Z'],
  ['8', '13596', 'Gwt7aCCoO6E', 'SAINT SEIYA - THE LOST CANVAS - EP08 A Favorable Wind | English Sub | Full Episode', '2026-09-13T23:14:51.378Z'],
  ['9', '13597', 'T-gp4W48KT0', 'SAINT SEIYA - THE LOST CANVAS - EP09 Giant Star | English Sub | Full Episode', '2026-09-13T23:19:25.694Z'],
  ['10', '13598', '6DZuiREaTFI', 'SAINT SEIYA - THE LOST CANVAS - EP10 The Avent | English Sub | Full Episode', '2026-09-13T23:11:49.690Z'],
  ['11', '13599', '1GHubGw19YY', 'SAINT SEIYA - THE LOST CANVAS - EP11 Unreachable | English Sub | Full Episode', '2026-09-13T23:15:33.357Z'],
  ['12', '13600', 'mYl44TXYXJg', 'SAINT SEIYA - THE LOST CANVAS - EP12 Relentless Sacrifice | English Sub | Full Episode', '2026-09-13T23:18:13.389Z'],
  ['13', '13601', '_8OmWkiEDxc', 'SAINT SEIYA - THE LOST CANVAS - EP13 The Departure | English Sub | Full Episode', '2026-09-13T23:11:33.107Z'],
  ['14', '13602', 'bdOsnCuiYjM', 'SAINT SEIYA - THE LOST CANVAS - EP14 The Forest of Death | English Sub | Full Episode', '2026-09-13T23:16:36.581Z'],
  ['15', '13603', 'zzrqKu5Lah4', 'SAINT SEIYA - THE LOST CANVAS - EP15 If I Could Return to that Day | English Sub | Full Episode', '2026-09-13T23:14:43.135Z'],
  ['16', '13604', 'fpOSRfDWGVY', 'SAINT SEIYA - THE LOST CANVAS - EP16 Gods and Pawns | English Sub | Full Episode', '2026-09-13T23:10:40.745Z'],
  ['17', '13605', 'jp-zDWkecJY', 'SAINT SEIYA - THE LOST CANVAS - EP17 Trash | English Sub | Full Episode', '2026-09-13T23:18:34.951Z'],
  ['18', '13606', 'iJeyp7TKWCk', 'SAINT SEIYA - THE LOST CANVAS - EP18 I Only Want You to Live | English Sub | Full Episode', '2026-09-13T23:10:32.673Z'],
  ['19', '13607', 'vMSnHXkHTgs', 'SAINT SEIYA - THE LOST CANVAS - EP19 Lonely Blade | English Sub | Full Episode', '2026-09-13T23:15:54.792Z'],
  ['20', '13608', 'VMvbTqJMXVk', 'SAINT SEIYA - THE LOST CANVAS - EP20 Prison of Dreams | English Sub | Full Episode', '2026-09-13T23:10:47.376Z'],
  ['21', '13609', 'U5DBAkpt4SE', 'SAINT SEIYA - THE LOST CANVAS - EP21 Beyond the Dream | English Sub | Full Episode', '2026-09-13T23:04:42.611Z'],
  ['22', '13610', '4vjTxh44FrQ', 'SAINT SEIYA - THE LOST CANVAS - EP22 The Path of Righteousness | English Sub | Full Episode', '2026-09-13T23:14:49.930Z'],
  ['23', '13611', 'IGAKlI4-BdA', 'SAINT SEIYA - THE LOST CANVAS - EP23 Excalibur | English Sub | Full Episode', '2026-09-13T23:12:35.361Z'],
  ['24', '13612', 'HhZRomQXoUA', 'SAINT SEIYA - THE LOST CANVAS - EP24 Hour of the Final Battle | English Sub | Full Episode', '2026-09-13T23:19:05.758Z'],
  ['25', '13613', 'rl6P6gZfSPY', 'SAINT SEIYA - THE LOST CANVAS - EP25 The Many, Many Years | English Sub | Full Episode', '2026-09-13T23:04:01.324Z'],
  ['26', '13614', 'DBo5d7CVBR4', 'SAINT SEIYA - THE LOST CANVAS - EP26 Be Yourself | English Sub | Full Episode', '2026-09-13T23:11:21.198Z'],
] as const satisfies readonly LostCanvasRow[];

export const TMS_LOST_CANVAS_OFFICIAL_YOUTUBE_EPISODE_APPROVALS:
  readonly OfficialYouTubeEpisodeApproval[] = Object.freeze(LOST_CANVAS_ROWS.map(([
    episodeNumber,
    episodeSourceId,
    videoId,
    videoTitle,
    observedAt,
  ]) => ({
    id: `tms-lost-canvas-episode-${episodeNumber}`,
    catalogue: {
      source: 'anikoto' as const,
      titleSourceId: '796',
      titleSlug: 'saint-seiya-knights-of-the-zodiac-brrn4',
      episodeSourceId,
      episodeNumber,
      versionSourceId: `${episodeSourceId}:sub`,
      language: 'sub',
    },
    video: {
      id: videoId,
      title: videoTitle,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      channelId: TMS_PUBLISHER.channelId,
      channelUrl: TMS_PUBLISHER.channelUrl,
      handleUrl: TMS_PUBLISHER.handleUrl,
    },
    publisherIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel',
    titleIdentityUrl: 'https://www.tms-e.co.jp/global/alltitles/2000s/639401.html',
    episodeIdentityUrl: `https://www.youtube.com/watch?v=${videoId}`,
    observedAt,
  })));
