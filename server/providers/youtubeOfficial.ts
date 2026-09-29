import type { NativeCapabilities, PlaybackResult } from '../../shared/playback.ts';
import type { ApprovedNativeResource } from './native.ts';
import type { StoredProviderMapping } from './contract.ts';
import { unsupportedNative } from './native.ts';
import {
  isExactOfficialYouTubePublisher,
  officialYouTubePublisherPolicyForChannel,
  officialYouTubePublisherPolicyForChannelUrl,
} from '../../shared/youtubeOfficialPublishers.ts';

export { GUNDAM_INFO_PUBLISHER, REMOW_PUBLISHER } from '../../shared/youtubeOfficialPublishers.ts';

export const OFFICIAL_YOUTUBE_PROVIDER_ID = 'youtube-official' as const;
export const OFFICIAL_YOUTUBE_EMBED_HOST = 'www.youtube-nocookie.com' as const;
export const OFFICIAL_YOUTUBE_EMBED_BASIS =
  'Official publisher-hosted YouTube embed; copyright retained by the owner' as const;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const capabilities: NativeCapabilities = Object.freeze({
  seek: true,
  volume: true,
  fullscreen: true,
  progressEvents: true,
  subtitles: true,
  qualitySelection: true,
});

function exactHttps(value: string, expected: string): boolean {
  try {
    const url = new URL(value);
    return url.href === expected && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

export function officialYouTubeApprovalError(
  mapping: Pick<StoredProviderMapping, 'mappingId' | 'providerId' | 'providerResourceId' | 'language'>,
  resource: ApprovedNativeResource,
):
  | 'RESOURCE_IDENTITY_MISMATCH'
  | 'RESOURCE_NOT_APPROVED'
  | 'INVALID_YOUTUBE_VIDEO_ID'
  | null {
  if (
    mapping.providerId !== OFFICIAL_YOUTUBE_PROVIDER_ID ||
    resource.provider_id !== OFFICIAL_YOUTUBE_PROVIDER_ID ||
    resource.mapping_id !== mapping.mappingId ||
    resource.resource_id !== mapping.providerResourceId ||
    resource.language !== mapping.language
  )
    return 'RESOURCE_IDENTITY_MISMATCH';
  const publisherPolicy = officialYouTubePublisherPolicyForChannelUrl(
    resource.identity_evidence_url,
  );
  if (!VIDEO_ID.test(resource.resource_id)) return 'INVALID_YOUTUBE_VIDEO_ID';
  if (
    resource.enabled !== 1 ||
    !Number.isFinite(Date.parse(resource.approved_at)) ||
    !resource.edition.trim() ||
    resource.license !== OFFICIAL_YOUTUBE_EMBED_BASIS ||
    !publisherPolicy ||
    !exactHttps(resource.identity_evidence_url, publisherPolicy.publisher.channelUrl) ||
    !exactHttps(
      resource.rights_evidence_url,
      `https://www.youtube.com/watch?v=${resource.resource_id}`,
    )
  )
    return 'RESOURCE_NOT_APPROVED';
  return null;
}

export function hasApprovedOfficialYouTubeResource(
  mapping: Pick<StoredProviderMapping, 'mappingId' | 'providerId' | 'providerResourceId' | 'language'>,
  resource: ApprovedNativeResource | null | undefined,
): boolean {
  return !!resource && officialYouTubeApprovalError(mapping, resource) === null;
}

export function resolveOfficialYouTube(
  mapping: StoredProviderMapping,
  resource: ApprovedNativeResource,
): PlaybackResult {
  const invalid = officialYouTubeApprovalError(mapping, resource);
  if (invalid)
    return unsupportedNative(
      mapping,
      invalid,
      invalid === 'RESOURCE_IDENTITY_MISMATCH'
        ? 'The approved YouTube resource does not match this episode version.'
        : invalid === 'INVALID_YOUTUBE_VIDEO_ID'
          ? 'The approved YouTube video identifier is invalid.'
          : 'This YouTube upload has not passed the official-publisher approval gate.',
      false,
    );
  const publisher = officialYouTubePublisherPolicyForChannelUrl(
    resource.identity_evidence_url,
  )!.publisher;
  return {
    kind: 'official-youtube',
    mappingId: String(mapping.mappingId),
    providerId: OFFICIAL_YOUTUBE_PROVIDER_ID,
    language: mapping.language,
    format: 'iframe',
    videoId: resource.resource_id,
    allowedEmbedHosts: [OFFICIAL_YOUTUBE_EMBED_HOST],
    capabilities,
    publisher,
    expiresAt: null,
    attribution: {
      label: `${publisher.label} · YouTube`,
      url: resource.rights_evidence_url,
      license: OFFICIAL_YOUTUBE_EMBED_BASIS,
    },
  };
}

export function sanitizeOfficialYouTubeResolution(
  mapping: StoredProviderMapping,
  value: import('./contract.ts').ProviderResolution,
): import('./contract.ts').ProviderResolution {
  const expectedVideoId = mapping.providerResourceId ?? '';
  if (
    value.status !== 'resolved' ||
    value.kind !== 'official-youtube' ||
    value.delivery !== 'provider' ||
    value.playbackType !== 'iframe' ||
    mapping.providerId !== OFFICIAL_YOUTUBE_PROVIDER_ID ||
    value.providerId !== mapping.providerId ||
    value.mappingId !== mapping.mappingId ||
    value.videoId !== expectedVideoId ||
    !VIDEO_ID.test(value.videoId) ||
    !isExactOfficialYouTubePublisher(value.publisher) ||
    value.allowedEmbedHosts?.length !== 1 ||
    value.allowedEmbedHosts[0] !== OFFICIAL_YOUTUBE_EMBED_HOST
  )
    return {
      kind: 'unsupported',
      mappingId: mapping.mappingId,
      providerId: mapping.providerId,
      playbackType: 'iframe',
      status: 'unsupported',
      error: {
        code: 'OFFICIAL_EMBED_POLICY_REJECTED',
        message: 'The official YouTube player response failed Solanime’s publisher and identity policy.',
        retryable: false,
      },
    };
  const publisher = officialYouTubePublisherPolicyForChannel(value.publisher.channelId)!.publisher;
  return {
    kind: 'official-youtube',
    mappingId: mapping.mappingId,
    providerId: OFFICIAL_YOUTUBE_PROVIDER_ID,
    playbackType: 'iframe',
    status: 'resolved',
    delivery: 'provider',
    videoId: value.videoId,
    allowedEmbedHosts: [OFFICIAL_YOUTUBE_EMBED_HOST],
    capabilities,
    publisher,
    expiresAt: undefined,
    attribution: {
      label: `${publisher.label} · YouTube`,
      url: `https://www.youtube.com/watch?v=${value.videoId}`,
      license: OFFICIAL_YOUTUBE_EMBED_BASIS,
    },
  };
}
