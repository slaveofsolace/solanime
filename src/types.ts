export type AvailabilityStatus =
  | 'observed'
  | 'available'
  | 'unavailable'
  | 'blocked'
  | 'stale'
  | 'unknown';

export type ResolutionStatus = 'resolved' | 'unavailable' | 'blocked';

export type PlaybackType =
  | 'iframe'
  | 'hls'
  | 'dash'
  | 'direct'
  | 'external'
  | 'download'
  | 'unknown';

export interface TitleSummary {
  id: string;
  sourceId?: string;
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
  description?: string | null;
  format?: string | null;
  airedFrom?: string | null;
  airedTo?: string | null;
  aliases?: TitleAlias[];
  related?: RelatedTitle[];
  episodes?: Episode[];
}

export interface TitleDetailResponse {
  title: TitleDetail;
  aliases: TitleAlias[];
  genres: Array<string | { id?: string; name: string }>;
  related: RelatedTitle[];
  episodes: Episode[];
}

export interface ProviderChoice {
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
}

export interface ImportStatus {
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
