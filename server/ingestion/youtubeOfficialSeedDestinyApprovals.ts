import type { OfficialYouTubeEpisodeApproval } from './youtubeOfficial.ts';
import { GUNDAM_INFO_PUBLISHER } from '../../shared/youtubeOfficialPublishers.ts';

type SeedDestinyRow = readonly [
  episodeNumber: string,
  episodeSourceId: string,
  videoId: string,
  videoTitle: string,
  observedAt: string,
];

// Manually reviewed against Gundam's official 50-episode HD Remaster listing
// and the immutable discovery/probe record. Runtime imports use these stable
// catalogue identities and never infer a match from title text.
const SEED_DESTINY_ROWS = [
  ['1', '40357', 'paEVAzRhX2k', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode1 (w/subtitles)', '2026-09-13T23:24:31.173Z'],
  ['2', '40358', 'vyQquPdMrno', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode2 (w/subtitles)', '2026-09-13T23:21:42.455Z'],
  ['3', '40359', 'AD_PSpuDOw4', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode3 (w/subtitles)', '2026-09-13T23:24:03.125Z'],
  ['4', '40360', 'nWg54ZaezAo', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode4 (w/subtitles)', '2026-09-13T23:21:26.202Z'],
  ['5', '40361', 'en897kxbX7A', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode5 (w/subtitles)', '2026-09-13T23:23:18.538Z'],
  ['6', '40362', 'tY5jzpXILiI', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode6 (w/subtitles)', '2026-09-13T23:24:44.911Z'],
  ['7', '40363', 'TjIss69vHM0', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode7 (w/subtitles)', '2026-09-13T23:21:46.482Z'],
  ['8', '40364', '2bqdyfvPT5o', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode8 (w/subtitles)', '2026-09-13T23:24:32.738Z'],
  ['9', '40365', '1LC4w2zII1c', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode9 (w/subtitles)', '2026-09-13T23:24:46.227Z'],
  ['10', '40366', 'OnO1hXvNTNI', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode10 (w/subtitles)', '2026-09-13T23:23:40.496Z'],
  ['11', '40367', 'VYKjatpgKJ0', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode11 (w/subtitles)', '2026-09-13T23:23:05.302Z'],
  ['12', '40368', 'bNwaMtLQHDg', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode12 (w/subtitles)', '2026-09-13T23:22:07.916Z'],
  ['13', '40369', 'le8hTBgIycQ', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode13 (w/subtitles)', '2026-09-13T23:22:13.106Z'],
  ['14', '40370', 'f9k6qKkXo18', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode14 (w/subtitles)', '2026-09-13T23:23:51.112Z'],
  ['15', '40371', '5sf5Bg9fTnI', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode15 (w/subtitles)', '2026-09-13T23:22:31.840Z'],
  ['16', '40372', 'CtPgRBHseqQ', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode16 (w/subtitles)', '2026-09-13T23:21:47.757Z'],
  ['17', '40373', 'GKvVi-j7p9U', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode17 (w/subtitles)', '2026-09-13T23:22:28.899Z'],
  ['18', '40374', '1EqL7CSXX0s', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode18 (w/subtitles)', '2026-09-13T23:24:07.183Z'],
  ['19', '40375', 'G0MTr1fKehQ', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode19 (w/subtitles)', '2026-09-13T23:23:56.316Z'],
  ['20', '40376', 'EEVFIvpDIYI', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode20 (w/subtitles)', '2026-09-13T23:22:53.010Z'],
  ['21', '40377', 'haLsUSKKgTY', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode21 (w/subtitles)', '2026-09-13T23:24:08.408Z'],
  ['22', '40378', 'K1P1SVQHQ0c', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode22 (w/subtitles)', '2026-09-13T23:23:37.606Z'],
  ['23', '40379', 'Q0QALnQq16c', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode23 (w/subtitles)', '2026-09-13T23:24:40.674Z'],
  ['24', '40380', 'aou_jG-Ixfs', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode24 (w/subtitles)', '2026-09-13T23:21:51.830Z'],
  ['25', '40381', 'zdmDPCam9js', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode25 (w/subtitles)', '2026-09-13T23:23:17.355Z'],
  ['26', '40382', 'FPODPa-6GMQ', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode26 (w/subtitles)', '2026-09-13T23:23:47.079Z'],
  ['27', '40383', '5RueiBE8--I', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode27 (w/subtitles)', '2026-09-13T23:23:13.254Z'],
  ['28', '40384', 'M9PQI5N3wKQ', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode28 (w/subtitles)', '2026-09-13T23:24:23.220Z'],
  ['29', '40385', 'OuiO9Bh-Vwg', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode29 (w/subtitles)', '2026-09-13T23:22:15.508Z'],
  ['30', '40386', 'aCoxKeOwZ5o', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode30 (w/subtitles)', '2026-09-13T23:23:10.535Z'],
  ['31', '40387', 'XQ--oYA7qoU', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode31 (w/subtitles)', '2026-09-13T23:22:30.431Z'],
  ['32', '40388', 'gywx_XzEvDQ', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode32 (w/subtitles)', '2026-09-13T23:23:20.032Z'],
  ['33', '40389', 'nk_h-P6tzJo', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode33 (w/subtitles)', '2026-09-13T23:22:46.305Z'],
  ['34', '40390', '3lE2h_ATjTw', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode34 (w/subtitles)', '2026-09-13T23:22:01.107Z'],
  ['35', '40391', 'Z7Kn31ZhxSY', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode35 (w/subtitles)', '2026-09-13T23:24:39.283Z'],
  ['36', '40392', 'TcINwjTluos', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode36 (w/subtitles)', '2026-09-13T23:22:32.899Z'],
  ['37', '40393', '4CvIzaTNSus', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode37 (w/subtitles)', '2026-09-13T23:21:55.954Z'],
  ['38', '40394', 'Ur75uHUSncw', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode38 (w/subtitles)', '2026-09-13T23:22:38.496Z'],
  ['39', '40395', 'gMJaDX0P18w', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode39 (w/subtitles)', '2026-09-13T23:22:03.915Z'],
  ['40', '40396', 'lP-Rl7OGtI0', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode40 (w/subtitles)', '2026-09-13T23:21:29.099Z'],
  ['41', '40397', '8oCqfAepXfc', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode41 (w/subtitles)', '2026-09-13T23:23:39.183Z'],
  ['42', '40398', 'D75f0t7yLa8', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode42 (w/subtitles)', '2026-09-13T23:23:25.492Z'],
  ['43', '40399', 'V3TtcKvIkR0', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode43 (w/subtitles)', '2026-09-13T23:23:06.539Z'],
  ['44', '40400', 'd04Mbt2zaTw', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode44 (w/subtitles)', '2026-09-13T23:23:16.078Z'],
  ['45', '40401', 'w3dsEgwIGLE', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode45 (w/subtitles)', '2026-09-13T23:21:37.327Z'],
  ['46', '40402', 'JbZrvFORiCo', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode46 (w/subtitles)', '2026-09-13T23:22:55.723Z'],
  ['47', '40403', 'wdTPZb7jqAc', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode47 (w/subtitles)', '2026-09-13T23:23:57.728Z'],
  ['48', '40404', 'CSkG9DT0XJo', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode48 (w/subtitles)', '2026-09-13T23:23:48.568Z'],
  ['49', '40405', '4ySqySVqMkQ', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode49 (w/subtitles)', '2026-09-13T23:21:58.521Z'],
  ['50', '40406', 'SbDAut9weJ4', 'Mobile Suit Gundam SEED DESTINY HD Remaster - Episode50 (w/subtitles)', '2026-09-13T23:24:20.509Z'],
] as const satisfies readonly SeedDestinyRow[];

const SEED_DESTINY_OFFICIAL_EPISODE_LIST =
  'https://es.gundam.info/movies/movie/movies_movie_20171002_141p.html';

export const GUNDAM_SEED_DESTINY_OFFICIAL_YOUTUBE_EPISODE_APPROVALS:
  readonly OfficialYouTubeEpisodeApproval[] = Object.freeze(SEED_DESTINY_ROWS.map(([
    episodeNumber,
    episodeSourceId,
    videoId,
    videoTitle,
    observedAt,
  ]) => ({
    id: `gundam-info-seed-destiny-episode-${episodeNumber}`,
    catalogue: {
      source: 'anikoto' as const,
      titleSourceId: '2296',
      titleSlug: 'mobile-suit-gundam-seed-destiny-rp0ht',
      episodeSourceId,
      episodeNumber,
      versionSourceId: `${episodeSourceId}:sub`,
      language: 'sub',
    },
    video: {
      id: videoId,
      title: videoTitle,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      channelId: GUNDAM_INFO_PUBLISHER.channelId,
      channelUrl: GUNDAM_INFO_PUBLISHER.channelUrl,
      handleUrl: GUNDAM_INFO_PUBLISHER.handleUrl,
    },
    publisherIdentityUrl: 'https://en.gundam-official.com/feature/gwoy/',
    titleIdentityUrl: SEED_DESTINY_OFFICIAL_EPISODE_LIST,
    episodeIdentityUrl: SEED_DESTINY_OFFICIAL_EPISODE_LIST,
    observedAt,
  })));
