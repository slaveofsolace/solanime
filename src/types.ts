import type { CatalogueArtwork } from '../shared/artwork';

export type AvailabilityStatus =
  | 'observed'
  | 'available'
  | 'unavailable'
  | 'blocked'
  | 'stale'
  | 'unknown'
  | 'unsupported';

export type ResolutionStatus = 'resolved' | 'unavailable' | 'blocked' | 'unsupported';

export type PlaybackType =
  | 'iframe'
  | 'hls'
  | 'dash'
  | 'direct'
  | 'external'
  | 'download'
  | 'unknown'
  | 'unsupported';

export interface TitleSummary extends CatalogueArtwork {
  id: string;
  source?: string;
  sourceId?: string;
  canonicalUrl?: string;
  slug: string;
  name: string;
  title?: string;
  englishTitle?: string | null;
  imageUrl?: string | null;
  posterUrl?: string | null;
  synopsis?: string | null;
  type?: string | null;
  status?: string | null;
  releaseYear?: number | null;
  year?: number | null;
  genres?: Array<string | { id?: string; name: string }>;
  languages?: string[];
  episodeCount?: number;
  updatedAt?: string;
}

export interface TitleAlias {
  id?: string;
  name?: string;
  value?: string;
  language?: string | null;
  kind?: string | null;
}

export interface RelatedTitle extends Partial<TitleSummary> {
  sourceId: string;
  relationshipType: string;
  label?: string | null;
  sourceUrl?: string | null;
}

export interface EpisodeVersion {
  id: string;
  language: string;
  label?: string;
  providerCount: number;
  availability?: AvailabilityStatus;
}

export interface Episode {
  id: string;
  sourceId?: string;
  number?: string | number | null;
  label?: string | null;
  title?: string | null;
  slug?: string;
  versions: EpisodeVersion[];
}

export interface TitleDetail extends TitleSummary {
  collectionState?: 'complete' | 'partial' | 'pending' | 'metadata-only' | 'unknown';
  description?: string | null;
  format?: string | null;
  airedFrom?: string | null;
  airedTo?: string | null;
  aliases?: TitleAlias[];
  related?: RelatedTitle[];
  episodes?: Episode[];
}

export interface TitleDetailResponse {
  collectionState?: 'complete' | 'partial' | 'pending' | 'metadata-only' | 'unknown';
  title: TitleDetail;
  aliases: TitleAlias[];
  genres: Array<string | { id?: string; name: string }>;
  related: RelatedTitle[];
  episodes: Episode[];
}

export interface ProviderChoice {
  supported?: boolean;
  mappingId: string;
  providerId: string;
  label: string;
  aliases?: string[];
  playbackType: PlaybackType;
  status: AvailabilityStatus;
  capabilities?: string[] | Record<string, boolean>;
  lastSuccessfulResolution?: string | null;
  lastPlaybackVerification?: string | null;
  reason?: string | null;
}

export interface ProvidersResponse {
  episode: Episode;
  version: EpisodeVersion;
  providers: ProviderChoice[];
}

export interface PlaybackResolution {
  kind?: 'native' | 'unsupported';
  captions?: import('../shared/playback').CaptionSource[];
  delivery?: 'native' | 'provider';
  mediaCrossOrigin?: 'anonymous' | 'none';
  attribution?: { label: string; url: string; license: string };
  allowedMediaHosts?: string[];
  mappingId: string;
  providerId: string;
  playbackType: PlaybackType;
  url?: string | null;
  embedUrl?: string | null;
  expiresAt?: string | null;
  status: ResolutionStatus;
  error?: string | { code?: string; message?: string } | null;
}

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
}

export interface CatalogueFacets {
  genres?: FacetOption[];
  types?: FacetOption[];
  statuses?: FacetOption[];
  languages?: FacetOption[];
}

export interface CatalogueResponse {
  items: TitleSummary[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  facets?: CatalogueFacets;
}

export interface ApiProblem {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export interface WatchHistoryEntry {
  titleId: string;
  slug: string;
  title: string;
  imageUrl?: string | null;
  episodeId: string;
  episodeLabel: string;
  language: string;
  position?: number;
  duration?: number;
  watchedAt: string;
}

export interface EpisodeComment {
  id: string;
  episodeId: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface CommunityComment {
  id: string;
  episodeId: string;
  author: { name: string; avatar: 'ruby' | 'ocean' | 'violet' | 'emerald' | 'amber' };
  body: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  ownedByViewer: boolean;
}

export interface CommunityCommentsPage {
  items: CommunityComment[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface WatchedEpisode {
  episodeId: string;
  language: string;
  watchedAt: string;
}

export interface Preferences {
  preferredLanguage: string;
  autoplayNext: boolean;
  rememberProgress: boolean;
  theme?: 'dark' | 'light';
  accent?: string;
  embedMode?: 'compatible' | 'restricted';
  motion?: 'system' | 'reduced';
}

export interface ImportStatus {
  runtime?: 'local' | 'cloudflare-workers';
  backupMode?: 'local-api' | 'operator-cli';
  syncEnabled?: boolean;
  sourceRefreshEnabled?: boolean;
  dispatchAllowance?: {
    status: 'quota_paused' | 'available';
    retryAt: string | null;
    minimumHeadroom: {
      writtenRows: number;
      queueOperations: number;
    };
  };
  cloudBudget?: {
    day: string;
    writtenRowsReserved: number;
    queueOperationsReserved: number;
    limits: { dailyWrittenRows: number; dailyQueueOperations: number };
    accountScope: string;
  };
  snapshot?: {
    jobs: Array<{
      id: string;
      runId: number;
      taskId?: number;
      status: string;
      importedBatches: number;
      totalBatches: number;
      totalRows: number;
      createdAt?: string;
      availableAt?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    }>;
    storage?: string;
    publicAssetServing?: boolean;
  };
  latestRun: null | {
    id: number;
    mode: string;
    status: string;
    tasks_discovered: number;
    tasks_completed: number;
    tasks_failed: number;
    checkpoint_json: string;
    started_at?: string | null;
    updated_at: string;
  };
  coverage: null | Record<string, string | number | null>;
  counts: {
    titles: number;
    episodes: number;
    versions: number;
    mappings: number;
    pendingTasks: number;
  };
  taskStages: Array<{
    taskType: string;
    completed: number;
    pending: number;
    failed: number;
    total: number;
  }>;
  recentErrors: Array<{
    id: number;
    runId: number;
    taskKey: string;
    code: string;
    message: string;
    updatedAt: string;
  }>;
  providers: Array<{
    id: string;
    label: string;
    adapterState: string;
    identityState: string;
    playbackType: string;
    mappingCount: number;
    lastSuccessfulResolution?: string | null;
    lastPlaybackVerification?: string | null;
  }>;
}
