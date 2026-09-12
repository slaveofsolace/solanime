/** Public playback contract. Webpage embeds are never native media. */
export type MediaKind = 'direct' | 'hls' | 'dash';
export interface CaptionSource {
  url: string;
  language: string;
  label: string;
  default?: boolean;
}
export const isMediaKind = (kind: unknown): kind is MediaKind =>
  kind === 'direct' || kind === 'hls' || kind === 'dash';
export const UNSUPPORTED_SOURCE =
  'This source is not supported by the Solanime player. Choose another source or episode.';
