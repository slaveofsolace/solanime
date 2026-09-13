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
