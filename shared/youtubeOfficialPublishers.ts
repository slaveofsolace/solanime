import type { OfficialYouTubePublisher } from './playback.ts';

export type OfficialYouTubePublisherPolicy = Readonly<{
  id: string;
  publisher: Readonly<OfficialYouTubePublisher>;
  identityUrl: string;
  aliases: readonly string[];
}>;

export const REMOW_PUBLISHER = Object.freeze({
  label: "It's Anime powered by REMOW",
  channelId: 'UCsj_CYajUSQ2ca8bYCMan9g',
  channelUrl: 'https://www.youtube.com/channel/UCsj_CYajUSQ2ca8bYCMan9g',
  handleUrl: 'https://www.youtube.com/@ItsAnimeJP',
}) satisfies Readonly<OfficialYouTubePublisher>;

export const GUNDAM_INFO_PUBLISHER = Object.freeze({
  label: 'GUNDAM CHANNEL INTL',
  channelId: 'UCejtUitnpnf8Be-v5NuDSLw',
  channelUrl: 'https://www.youtube.com/channel/UCejtUitnpnf8Be-v5NuDSLw',
  handleUrl: 'https://www.youtube.com/@GundamInfo',
}) satisfies Readonly<OfficialYouTubePublisher>;

export const TMS_PUBLISHER = Object.freeze({
  label: 'Anime! on TMS Official Channel',
  channelId: 'UCzGf0DdUJVrsbcWL3e_tK1Q',
  channelUrl: 'https://www.youtube.com/channel/UCzGf0DdUJVrsbcWL3e_tK1Q',
  handleUrl: 'https://www.youtube.com/@AnimeonTMSOfficialChannel',
}) satisfies Readonly<OfficialYouTubePublisher>;

export const BEYBLADE_PUBLISHER = Object.freeze({
  label: 'BEYBLADE English - Official Channel',
  channelId: 'UCktgoAFaL39_rYfiMZiD9jw',
  channelUrl: 'https://www.youtube.com/channel/UCktgoAFaL39_rYfiMZiD9jw',
  handleUrl: 'https://www.youtube.com/@BeybladeOfficial',
}) satisfies Readonly<OfficialYouTubePublisher>;

export const NOZOMI_PUBLISHER = Object.freeze({
  label: 'Nozomi Entertainment',
  channelId: 'UCUlvYyW7UVtNJQ1KTv_Bsdg',
  channelUrl: 'https://www.youtube.com/channel/UCUlvYyW7UVtNJQ1KTv_Bsdg',
  handleUrl: 'https://www.youtube.com/@nozomient',
}) satisfies Readonly<OfficialYouTubePublisher>;

export const TV_TOKYO_ANIME_PUBLISHER = Object.freeze({
  label: 'テレ東アニメ',
  channelId: 'UC0OXPEQRKArB_EVyFMwDbAQ',
  channelUrl: 'https://www.youtube.com/channel/UC0OXPEQRKArB_EVyFMwDbAQ',
  handleUrl: 'https://www.youtube.com/@anitele_tx',
}) satisfies Readonly<OfficialYouTubePublisher>;

export const TV_TOKYO_ANIME_PUBLISHER_IDENTITY_URL =
  'https://www.tv-tokyo.co.jp/information/202603/5536.html';

export const NOZOMI_PUBLISHER_IDENTITY_URL =
  'https://www.crunchyroll.com/news/announcements/2022/8/4/crunchyroll-closes-deal-to-acquire-anime-superstore-right-stuf';

export const OFFICIAL_YOUTUBE_PUBLISHER_POLICIES: readonly OfficialYouTubePublisherPolicy[] =
  Object.freeze([
    Object.freeze({
      id: 'remow-its-anime',
      publisher: REMOW_PUBLISHER,
      identityUrl: 'https://www.remow.com/en/service/',
      aliases: Object.freeze(['REMOW']),
    }),
    Object.freeze({
      id: 'gundam-info',
      publisher: GUNDAM_INFO_PUBLISHER,
      identityUrl: 'https://en.gundam-official.com/feature/gwoy/',
      aliases: Object.freeze(['GUNDAM.INFO', 'GundamInfo']),
    }),
    Object.freeze({
      id: 'tms-anime-official',
      publisher: TMS_PUBLISHER,
      identityUrl: 'https://tmsanime.com/anime-on-tms-official-channel',
      aliases: Object.freeze(['TMS Entertainment', 'TMS Anime']),
    }),
    Object.freeze({
      id: 'beyblade-english',
      publisher: BEYBLADE_PUBLISHER,
      identityUrl: 'https://beyblade.com/episodes/',
      aliases: Object.freeze(['BEYBLADE Official', 'BEYBLADE English']),
    }),
    Object.freeze({
      id: 'nozomi-entertainment',
      publisher: NOZOMI_PUBLISHER,
      identityUrl: NOZOMI_PUBLISHER_IDENTITY_URL,
      aliases: Object.freeze(['Nozomi Entertainment', 'Right Stuf', 'Nozomi']),
    }),
    Object.freeze({
      id: 'tv-tokyo-anime',
      publisher: TV_TOKYO_ANIME_PUBLISHER,
      identityUrl: TV_TOKYO_ANIME_PUBLISHER_IDENTITY_URL,
      aliases: Object.freeze(['TV Tokyo Anime', 'テレ東アニメ']),
    }),
  ]);

export function officialYouTubePublisherPolicyForChannel(
  channelId: string,
): OfficialYouTubePublisherPolicy | null {
  return OFFICIAL_YOUTUBE_PUBLISHER_POLICIES.find(
    (policy) => policy.publisher.channelId === channelId,
  ) ?? null;
}

export function officialYouTubePublisherPolicyForChannelUrl(
  channelUrl: string,
): OfficialYouTubePublisherPolicy | null {
  return OFFICIAL_YOUTUBE_PUBLISHER_POLICIES.find(
    (policy) => policy.publisher.channelUrl === channelUrl,
  ) ?? null;
}

export function isExactOfficialYouTubePublisher(
  publisher: OfficialYouTubePublisher | null | undefined,
): publisher is OfficialYouTubePublisher {
  if (!publisher) return false;
  const policy = officialYouTubePublisherPolicyForChannel(publisher.channelId);
  return !!policy &&
    publisher.label === policy.publisher.label &&
    publisher.channelUrl === policy.publisher.channelUrl &&
    publisher.handleUrl === policy.publisher.handleUrl;
}
