import type { AvailabilityState, PlaybackType } from '../types.ts';

export interface StoredProviderMapping {
  mappingId: number;
  providerId: string;
  label: string;
  language: string;
  providerResourceId: string | null;
  canonicalEmbedUrl: string | null;
  availability: AvailabilityState;
  unavailableReason: string | null;
}

export interface ProviderCapabilities {
  embed: boolean;
  seek: boolean;
  volume: boolean;
  fullscreen: boolean;
  subtitles: boolean;
  qualitySelection: boolean;
  progressEvents: boolean;
}

export interface ProviderResolution {
  attribution?: { label: string; url: string; license: string };
  mediaCrossOrigin?: 'anonymous' | 'none';
  kind?: 'native' | 'unsupported';
  result?: import('../../shared/playback').PlaybackResult;
  captions?: import('../../shared/playback').CaptionSource[];
  delivery?: 'native' | 'provider';
  allowedMediaHosts?: string[];
  mappingId: number;
  providerId: string;
  playbackType: PlaybackType;
  url?: string;
  embedUrl?: string;
  headers?: Record<string, string>;
  expiresAt?: string;
  status: 'resolved' | 'unavailable' | 'blocked' | 'unsupported';
  error?: { code: string; message: string; retryable?: boolean };
}

export interface ProviderAdapter {
  readonly id: string;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly playbackType: PlaybackType;
  readonly capabilities: ProviderCapabilities;
  readonly compatibleLanguages: readonly string[] | 'all';
  mapResource(mapping: StoredProviderMapping): {
    resourceId: string | null;
    embedUrl: string | null;
  };
  resolve(mapping: StoredProviderMapping, signal?: AbortSignal): Promise<ProviderResolution>;
}

export const NO_CAPABILITIES: ProviderCapabilities = Object.freeze({
  embed: false,
  seek: false,
  volume: false,
  fullscreen: false,
  subtitles: false,
  qualitySelection: false,
  progressEvents: false,
});
