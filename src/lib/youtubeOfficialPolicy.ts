import type { PlaybackResolution } from '../types';

export const YOUTUBE_OFFICIAL_PROVIDER_ID = 'youtube-official' as const;
export const YOUTUBE_PRIVACY_HOST = 'www.youtube-nocookie.com' as const;
export const REMOW_CHANNEL_ID = 'UCsj_CYajUSQ2ca8bYCMan9g' as const;
export const REMOW_PUBLISHER_LABEL = "It's Anime powered by REMOW" as const;
export const YOUTUBE_IFRAME_ALLOW =
  'autoplay; encrypted-media; fullscreen; picture-in-picture' as const;
export const YOUTUBE_IFRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-presentation' as const;

export type OfficialYouTubeResolution = PlaybackResolution & {
  kind: 'official-youtube';
  providerId: typeof YOUTUBE_OFFICIAL_PROVIDER_ID;
  delivery: 'provider';
  playbackType: 'iframe';
  status: 'resolved';
  videoId: string;
  publisher: NonNullable<PlaybackResolution['publisher']>;
};

export function isOfficialYouTubeResolution(
  value: PlaybackResolution | null | undefined,
): value is OfficialYouTubeResolution {
  return !!value &&
    value.kind === 'official-youtube' &&
    value.providerId === YOUTUBE_OFFICIAL_PROVIDER_ID &&
    value.delivery === 'provider' &&
    value.playbackType === 'iframe' &&
    value.status === 'resolved' &&
    /^[A-Za-z0-9_-]{11}$/.test(value.videoId ?? '') &&
    value.allowedEmbedHosts?.length === 1 &&
    value.allowedEmbedHosts[0] === YOUTUBE_PRIVACY_HOST &&
    value.publisher?.label === REMOW_PUBLISHER_LABEL &&
    value.publisher?.channelId === REMOW_CHANNEL_ID &&
    value.publisher.channelUrl === `https://www.youtube.com/channel/${REMOW_CHANNEL_ID}` &&
    value.publisher.handleUrl === 'https://www.youtube.com/@ItsAnimeJP' &&
    !value.url &&
    !value.embedUrl;
}

export function officialYouTubeEmbedUrl(
  resolution: PlaybackResolution,
  pageOrigin: string,
): string | null {
  if (!isOfficialYouTubeResolution(resolution)) return null;
  try {
    const origin = new URL(pageOrigin);
    if (
      origin.origin !== pageOrigin ||
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.username ||
      origin.password
    )
      return null;
    const url = new URL(`https://${YOUTUBE_PRIVACY_HOST}/embed/${resolution.videoId}`);
    url.searchParams.set('enablejsapi', '1');
    url.searchParams.set('origin', origin.origin);
    url.searchParams.set('playsinline', '1');
    url.searchParams.set('rel', '0');
    return url.href;
  } catch {
    return null;
  }
}

export function officialYouTubeError(code: number): { code: string; message: string } {
  if (code === 2)
    return { code: 'YOUTUBE_INVALID_IDENTIFIER', message: 'YouTube rejected this video identifier.' };
  if (code === 5)
    return { code: 'YOUTUBE_HTML5_ERROR', message: 'The YouTube player could not start HTML5 playback in this browser.' };
  if (code === 100)
    return { code: 'YOUTUBE_VIDEO_UNAVAILABLE', message: 'This official upload is no longer public.' };
  if (code === 101 || code === 150)
    return { code: 'YOUTUBE_EMBED_DISABLED', message: 'The publisher does not currently permit this video to play on other sites.' };
  if (code === 153)
    return { code: 'YOUTUBE_REFERRER_REJECTED', message: 'YouTube could not verify this site as the requesting player. Check the site referrer policy and try again.' };
  return { code: 'YOUTUBE_PLAYBACK_UNAVAILABLE', message: 'This official upload is unavailable in the current browser or region.' };
}
