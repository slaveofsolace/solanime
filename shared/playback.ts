/** Public playback contract. Webpage embeds are never native media. */
export type MediaKind = 'direct' | 'hls' | 'dash';
export interface CaptionSource {
  url: string;
  language: string;
  label: string;
  default?: boolean;
}
export interface NativeCapabilities {
  seek: boolean;
  volume: boolean;
  fullscreen: boolean;
  progressEvents: boolean;
  subtitles: boolean;
  qualitySelection: boolean;
}
export interface EmbedCapabilities {
  fullscreen: true;
  progressEvents: true;
  completionEvents: true;
  errorEvents: true;
  seek: false;
  volume: false;
  subtitles: false;
  qualitySelection: false;
}
export interface EmbedIframePolicy {
  sandbox: Array<'allow-scripts' | 'allow-same-origin' | 'allow-presentation'>;
  allow: Array<'autoplay' | 'fullscreen'>;
  referrerPolicy: 'no-referrer';
}
export interface EmbedMessageProtocol {
  origin: 'https://megaplay.buzz';
  channel: 'megacloud';
  events: Array<'time' | 'complete' | 'error'>;
  types: Array<'watching-log'>;
}
export interface OfficialYouTubePublisher {
  label: string;
  channelId: string;
  channelUrl: string;
  handleUrl: string;
}
export type PlaybackResult = {
  kind: 'native';
  mappingId: string;
  providerId: string;
  language: string;
  format: MediaKind;
  url: string;
  allowedMediaHosts: string[];
  mediaCrossOrigin?: 'anonymous' | 'none';
  capabilities: NativeCapabilities;
  captions: CaptionSource[];
  expiresAt: string | null;
  attribution?: { label: string; url: string; license: string };
} | {
  /** Provider-owned webpage shown inside Solanime; never native media. */
  kind: 'embed';
  mappingId: string;
  providerId: string;
  language: string;
  format: 'iframe';
  embedUrl: string;
  allowedEmbedHosts: ['megaplay.buzz'];
  capabilities: EmbedCapabilities;
  iframePolicy: EmbedIframePolicy;
  messageProtocol: EmbedMessageProtocol;
  expiresAt: string | null;
} | {
  /** Publisher-owned YouTube upload rendered by YouTube's standard player. */
  kind: 'official-youtube';
  mappingId: string;
  providerId: 'youtube-official';
  language: string;
  format: 'iframe';
  videoId: string;
  allowedEmbedHosts: ['www.youtube-nocookie.com'];
  capabilities: NativeCapabilities;
  publisher: OfficialYouTubePublisher;
  expiresAt: null;
  attribution: { label: string; url: string; license: string };
} | {
  kind: 'unsupported';
  mappingId: string;
  providerId: string;
  language: string;
  error: { code: string; message: string; retryable: boolean };
};
export const isMediaKind = (kind: unknown): kind is MediaKind =>
  kind === 'direct' || kind === 'hls' || kind === 'dash';
export const UNSUPPORTED_SOURCE =
  'This source is not supported by the Solanime player. Choose another source or episode.';
