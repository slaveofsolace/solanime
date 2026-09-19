import type { OfficialYouTubeEpisodeApproval } from './youtubeOfficial.ts';
import { TMS_PUBLISHER } from '../../shared/youtubeOfficialPublishers.ts';

type EpisodeRow = readonly [
  episodeNumber: string,
  episodeSourceId: string,
  videoId: string,
  videoTitle: string,
  observedAt: string,
];

const SHERLOCK_HOUND_ROWS = [
  ['1', '4952', 'hRQSoaSZWpQ', 'Sherlock Hound - EP01 A Small Client | English Dub | Full Episode', '2026-09-13T23:14:02.850Z'],
  ['2', '4953', 'fzfCkUDxYKU', 'Sherlock Hound - EP02 The Adventure of the Blue Carbuncle | English Dub | Full Episode', '2026-09-13T23:09:38.933Z'],
  ['3', '4954', '9Y3ZkFn3fAc', 'Sherlock Hound - EP03 Treasure under the Sea | English Dub | Full Episode', '2026-09-13T23:13:35.734Z'],
  ['4', '4955', 'GNvPv3Ey0k0', 'Sherlock Hound - EP04 The Sovereign Gold Coins | English Dub | Full Episode', '2026-09-13T23:09:54.941Z'],
  ['5', '4956', 'O84beIAGl7c', 'Sherlock Hound - EP05 Mrs. Hudson is Taken Hostage | English Dub | Full Episode', '2026-09-13T23:14:44.573Z'],
  ['6', '4957', 'SLjCNWSfl-s', 'Sherlock Hound - EP06 The White Cliffs of Dover | English Dub | Full Episode', '2026-09-13T23:16:16.303Z'],
  ['7', '4958', '7iHv_86VMnY', 'Sherlock Hound - EP07 A Sacred Image Disappears | English Dub | Full Episode', '2026-09-13T23:18:49.779Z'],
  ['8', '4959', '2nGxNPTjOrc', 'Sherlock Hound - EP08 The Green Balloon | English Dub | Full Episode', '2026-09-13T23:07:19.738Z'],
  ['9', '4960', 'B4VMJx_Jz9A', 'Sherlock Hound - EP09 The Stormy Getaway | English Dub | Full Episode', '2026-09-13T23:18:19.944Z'],
  ['10', '4961', 'x-cjXHMNkr0', 'Sherlock Hound - EP10 The Crown of Mazalin | English Dub | Full Episode', '2026-09-13T23:12:34.133Z'],
  ['11', '4962', '3Dx_YXg3L6c', 'Sherlock Hound - EP11 The Four Signatures | English Dub | Full Episode', '2026-09-13T23:17:35.580Z'],
  ['12', '4963', 'U6I59KjWOfg', 'Sherlock Hound - EP12 The Speckled Band | English Dub | Full Episode', '2026-09-13T23:16:52.761Z'],
  ['13', '4964', 'lD7lP96Hjh8', 'Sherlock Hound - EP13 The White Silver Getaway! | English Dub | Full Episode', '2026-09-13T23:07:36.719Z'],
  ['14', '4965', 'vS_SgspLawA', 'Sherlock Hound - EP14 The Coral Lobster | English Dub | Full Episode', '2026-09-13T23:16:21.547Z'],
  ['15', '4966', 'oCicaqN9kVY', 'Sherlock Hound - EP15 The Golden Statue of the Great Burglar | English Dub | Full Episode', '2026-09-13T23:14:03.987Z'],
  ['16', '4967', 'w_Et-bcRBtw', 'Sherlock Hound - EP16 The Runaway Freight Car | English Dub | Full Episode', '2026-09-13T23:11:14.281Z'],
  ['17', '4968', 'JXLDE3wAZe8', 'Sherlock Hound - EP17 The Secret of the Sacred Cross Sword | English Dub | Full Episode', '2026-09-13T23:11:19.551Z'],
  ['18', '4969', 'wpVdKuW9wAo', 'Sherlock Hound - EP18 The Adventure of the Three Students | English Dub | Full Episode', '2026-09-13T23:04:15.578Z'],
  ['19', '4970', 'NRX6iHi63tc', 'Sherlock Hound - EP19 The Rosetta Stone | English Dub | Full Episode', '2026-09-13T23:07:40.750Z'],
  ['20', '4971', 'Xg-peBBPebE', 'Sherlock Hound - EP20 The Adventure of the Thames Monster | English Dub | Full Episode', '2026-09-13T23:17:02.018Z'],
  ['21', '4972', 'iR12FKTeOoI', 'Sherlock Hound - EP21 The Secret of the Parrot | English Dub | Full Episode', '2026-09-13T23:09:05.341Z'],
  ['22', '4973', 'v33CTI2PhEI', 'Sherlock Hound - EP22 The Priceless French Doll | English Dub | Full Episode', '2026-09-13T23:18:23.025Z'],
  ['23', '4974', 'u8yo21muJvE', 'Sherlock Hound - EP23 The Bell of Big Ben | English Dub | Full Episode', '2026-09-13T23:11:27.816Z'],
  ['24', '4975', 'G05mq8NGmwE', 'Sherlock Hound - EP24 The Disappearance of the Splendid Royal Horse | English Dub | Full Episode', '2026-09-13T23:07:11.439Z'],
  ['25', '4976', 'e74orn9kToE', 'Sherlock Hound - EP25 Disturbance, The World Flight Championship! | English Dub | Full Episode', '2026-09-13T23:11:09.324Z'],
  ['26', '4977', 'ZeXgC8syEcY', 'Sherlock Hound - EP26 The Missing Bride Affair | English Dub | Full Episode', '2026-09-13T23:10:13.773Z'],
] as const satisfies readonly EpisodeRow[];

const CARDFIGHT_VANGUARD_ROWS = [
  ['1', '43808', 'BgMllBwSKzM', 'Cardfight!! Vanguard - Ride 01 Vanguard of Destiny! | English Dub HD Remaster', '2026-09-18T05:19:29.526Z'],
  ['2', '43809', 'Xj1XDxKpzpg', 'Cardfight!! Vanguard - Ride 02 Ride to Victory! | English Dub HD Remaster', '2026-09-18T05:19:38.199Z'],
  ['3', '43810', 'apxQ3H80jPo', 'Cardfight!! Vanguard - Ride 03 Welcome to Card Capital | English Dub HD Remaster', '2026-09-18T05:19:41.040Z'],
  ['4', '43811', 'g2LRXbunIx4', 'Cardfight!! Vanguard - Ride 04 Assault! Twin Drive! | English Dub HD Remaster', '2026-09-18T05:19:28.859Z'],
  ['5', '43812', 'Sgebk58WbgQ', 'Cardfight!! Vanguard - Ride 05 Whirlwind! Kamui, the Grade-School Fighter! | English Dub HD Remaster', '2026-09-18T05:19:34.942Z'],
  ['6', '43813', 'THOcIlPV2GU', 'Cardfight!! Vanguard - Ride 06 The Mysterious Card Shop! | English Dub HD Remaster', '2026-09-18T05:19:26.748Z'],
  ['7', '43814', 'bkGE58F_Luk', 'Cardfight!! Vanguard - Ride 07 The Fearsome Soulblast! | English Dub HD Remaster', '2026-09-18T05:19:33.438Z'],
  ['8', '43815', 'EtsRO47fObg', 'Cardfight!! Vanguard - Ride 08 The King of Knights Enters the Fray! | English Dub HD Remaster', '2026-09-18T05:19:36.143Z'],
  ['9', '43816', 'rx1EzaO48D4', 'Cardfight!! Vanguard - Ride 09 The Shop Tournament Begins! | English Dub HD Remaster', '2026-09-18T05:19:40.050Z'],
  ['10', '43817', 'Lx2fH3jf3To', 'Cardfight!! Vanguard - Ride 10 Enter the Ninja Fighter! | English Dub HD Remaster', '2026-09-18T05:19:31.789Z'],
  ['11', '43818', 'kNgeiYmtunM', 'Cardfight!! Vanguard - Ride 11 Ninja Fighter Withdraws! | English Dub HD Remaster', '2026-09-18T05:19:34.264Z'],
  ['12', '43819', 'iopmGr0KyRE', 'Cardfight!! Vanguard - Ride 12 Aichi vs. Kamui | English Dub HD Remaster', '2026-09-18T05:19:42.053Z'],
  ['13', '43820', '2kqi2T7cipg', 'Cardfight!! Vanguard - Ride 13 Shop Tournament Winner Crowned! | English Dub HD Remaster', '2026-09-18T05:19:31.068Z'],
  ['14', '43821', 'YR8oidHbjyU', 'Cardfight!! Vanguard - Ride 14 The Fearsome Undead! The Granblue Deck! | English Dub HD Remaster', '2026-09-18T05:19:25.521Z'],
  ['15', '43822', '-eai084tsok', "Cardfight!! Vanguard - Ride 15 Thrilling! Emi's First Fight! | English Dub HD Remaster", '2026-09-18T05:19:39.304Z'],
  ['16', '43823', '4Bn3h6twLvo', 'Cardfight!! Vanguard - Ride 16 Team Q4 Heads for the Regional Tournament! | English Dub HD Remaster', '2026-09-18T05:19:27.976Z'],
  ['17', '43824', '9uLokLvXL1A', 'Cardfight!! Vanguard - Ride 17 New Allies | English Dub HD Remaster', '2026-09-18T05:19:37.373Z'],
  ['18', '43825', 'Mmpqs9mi0Og', 'Cardfight!! Vanguard - Ride 18 White-Hot Tournament! | English Dub HD Remaster', '2026-09-18T05:19:24.373Z'],
  ['19', '43826', 'KxlaTKVv8FQ', 'Cardfight!! Vanguard - Ride 19 Showdown! Nova Grappler! | English Dub HD Remaster', '2026-09-18T05:19:23.340Z'],
] as const satisfies readonly EpisodeRow[];

const TMS_PUBLISHER_IDENTITY_URL = 'https://tmsanime.com/anime-on-tms-official-channel';
const SUPPLEMENTAL_DUB = Object.freeze({
  createIfMissing: true as const,
  versionLabel: 'Dubbed' as const,
  audioLanguage: 'en' as const,
  subtitleLanguage: null,
});

function approvals(
  rows: readonly EpisodeRow[],
  definition: Readonly<{
    idPrefix: string;
    titleSourceId: string;
    titleSlug: string;
    titleIdentityUrl: string;
  }>,
): readonly OfficialYouTubeEpisodeApproval[] {
  return Object.freeze(rows.map(([episodeNumber, episodeSourceId, videoId, videoTitle, observedAt]) => ({
    id: `tms-dub-${definition.idPrefix}-episode-${episodeNumber}`,
    editionLabel: 'English dub',
    supplementalVersion: SUPPLEMENTAL_DUB,
    catalogue: {
      source: 'anikoto' as const,
      titleSourceId: definition.titleSourceId,
      titleSlug: definition.titleSlug,
      episodeSourceId,
      episodeNumber,
      versionSourceId: `${episodeSourceId}:dub`,
      language: 'dub',
    },
    video: {
      id: videoId,
      title: videoTitle,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      channelId: TMS_PUBLISHER.channelId,
      channelUrl: TMS_PUBLISHER.channelUrl,
      handleUrl: TMS_PUBLISHER.handleUrl,
    },
    publisherIdentityUrl: TMS_PUBLISHER_IDENTITY_URL,
    titleIdentityUrl: definition.titleIdentityUrl,
    episodeIdentityUrl: `https://www.youtube.com/watch?v=${videoId}`,
    observedAt,
  })));
}

export const TMS_SHERLOCK_HOUND_OFFICIAL_YOUTUBE_EPISODE_APPROVALS = approvals(
  SHERLOCK_HOUND_ROWS,
  {
    idPrefix: 'sherlock-hound',
    titleSourceId: '290',
    titleSlug: 'sherlock-hound-wnraa',
    titleIdentityUrl: 'https://www.tms-e.co.jp/global/alltitles/1980s/051102.html',
  },
);

export const TMS_CARDFIGHT_VANGUARD_OFFICIAL_YOUTUBE_EPISODE_APPROVALS = approvals(
  CARDFIGHT_VANGUARD_ROWS,
  {
    idPrefix: 'cardfight-vanguard',
    titleSourceId: '2518',
    titleSlug: 'cardfight-vanguard-bsacg',
    titleIdentityUrl: 'https://en.cf-vanguard.com/animation/',
  },
);
