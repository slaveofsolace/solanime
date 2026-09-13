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
