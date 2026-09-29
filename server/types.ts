export type AvailabilityState =
  | 'observed'
  | 'available'
  | 'unavailable'
  | 'blocked'
  | 'stale'
  | 'unknown';
export type PlaybackType = 'iframe' | 'hls' | 'dash' | 'direct' | 'download' | 'unknown';
export type EvidenceClass =
  | 'direct_observation'
  | 'public_response'
  | 'third_party_code'
  | 'inference'
  | 'unknown';

export type ApiErrorCode =
  | 'RATE_LIMITED'
  | 'INVALID_RESPONSE'
  | 'INVALID_QUERY'
  | 'INVALID_REVIEW'
  | 'IMPORT_QUOTA_PAUSED'
  | 'INVALID_BUDGET'
  | 'RESERVATION_CONFLICT'
  | 'INVALID_IMPORT'
  | 'IMPORT_TOO_LARGE'
  | 'IMPORT_CHECKSUM_MISMATCH'
  | 'IMPORT_CONFLICT'
  | 'IMPORT_IDENTITY_CONFLICT'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'ADMIN_UNCONFIGURED'
  | 'UNAVAILABLE'
  | 'BLOCKED'
  | 'INVALID_PROVIDER_RESOURCE'
  | 'UPSTREAM_CHANGED'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: Record<string, unknown> };
}

export interface SnapshotProviderMapping {
  sourceMappingId: string;
  providerId: string;
  providerResourceId?: string | null;
  canonicalEmbedUrl?: string | null;
  availability?: AvailabilityState;
  unavailableReason?: string | null;
  mappingOrigin?: 'native' | 'external_mapper';
  publicExportAllowed?: boolean;
}

export interface SnapshotVersion {
  sourceId: string;
  language: string;
  label?: string | null;
  audioLanguage?: string | null;
  subtitleLanguage?: string | null;
  availability?: AvailabilityState;
  providers?: SnapshotProviderMapping[];
}

export interface SnapshotEpisode {
  sourceId: string;
  number: string;
  numberSort?: number | null;
  label?: string | null;
  thumbnailUrl?: string | null;
  thumbnailOrigin?: string | null;
  thumbnailReuseStatus?: string | null;
  durationSeconds?: number | null;
  seasonNumber?: number | null;
  slug: string;
  canonicalUrl: string;
  episodeType?: string;
  availability?: AvailabilityState;
  versions: SnapshotVersion[];
}

export interface SnapshotTitle {
  sourceId: string;
  slug: string;
  canonicalUrl: string;
  name: string;
  description?: string | null;
  format?: string | null;
  releaseYear?: number | null;
  status?: string | null;
  artworkUrl?: string | null;
  artworkOrigin?: string | null;
  artworkReuseStatus?: string;
  availability?: AvailabilityState;
  aliases?: Array<{ name: string; language?: string | null; type?: string }>;
  genres?: string[];
  related?: Array<{
    sourceId: string;
    relationshipType: string;
    label?: string | null;
    sourceUrl?: string | null;
  }>;
  episodes: SnapshotEpisode[];
}

export interface CatalogueSnapshot {
  schemaVersion: 1;
  source: 'anikoto' | 'tvmaze' | 'wikipedia-movie' | 'wikipedia-tv';
  observedAt: string;
  denominator?: { titles?: number; scope: string };
  titles: SnapshotTitle[];
}
