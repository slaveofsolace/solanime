import type { DatabaseSync } from 'node:sqlite';

export const DEFAULT_YOUTUBE_SHARD_COUNT = 500;
export const OFFICIAL_YOUTUBE_MATCHER_REVISION = '2026-09-18-series-segment-v5';
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;

export interface OfficialPublisherSource {
  id: string;
  kind: 'channel' | 'playlist';
  discoveryMode?: 'generic' | 'inventory-only';
  publisher: string;
  channelId: string;
  channelUrl: string;
  playlistId?: string;
  evidenceUrls: string[];
  fullEpisodeEvidenceUrl?: string;
  territoryNote: string;
  defaultLanguage: string;
  disposition: 'reference-only';
  seriesHints?: Array<{
    aliases: string[];
    titleSourceId?: string;
    episodeOffset?: number;
  }>;
  authoritativeMappings?: Array<{
    videoId: string;
    titleSourceId: string;
    episodeSourceId: string;
    versionSourceId: string;
    language: string;
    identityEvidenceUrls: string[];
  }>;
}

export interface OfficialYouTubePlaybackPolicy {
  id: string;
  channelId: string;
  sourceIds: string[];
  adapter: 'youtube-official';
  state: 'implemented';
  approvalRegistry: string;
}

export interface OfficialYouTubeDiscoveryConfig {
  version: 1;
  shardCount: number;
  playbackPolicies: OfficialYouTubePlaybackPolicy[];
  sources: OfficialPublisherSource[];
}

export interface ListedYouTubeVideo {
  videoId: string;
  title: string;
  channelId: string | null;
  channelLabel: string | null;
  durationSeconds: number | null;
  publishedText: string | null;
  playlistIndex: number | null;
}

export interface ListingSession {
  apiKey: string;
  clientName: string;
  clientVersion: string;
  visitorData?: string;
}

export interface ListedYouTubePage {
  videos: ListedYouTubeVideo[];
  continuation: string | null;
  channelId: string | null;
  channelLabel: string | null;
  estimatedTotalVideos: number | null;
  session?: ListingSession;
}

export interface YouTubeVideoProbe {
  videoId: string;
  title: string | null;
  channelId: string | null;
  channelLabel: string | null;
  durationSeconds: number | null;
  publishDate: string | null;
  availability: 'playable' | 'region-blocked' | 'embed-disabled' | 'login-required' | 'unavailable' | 'unknown';
  playableInEmbed: boolean | null;
  reason: string | null;
  observedAt: string;
  observationRegion: string;
  availableCountries: string[];
}

export interface CatalogueVersionRecord {
  id: number;
  sourceId: string;
  language: string;
}

export interface CatalogueEpisodeRecord {
  id: number;
  sourceId: string;
  numberText: string;
  numberSort: number | null;
  label: string | null;
  versions: CatalogueVersionRecord[];
}

export interface CatalogueTitleRecord {
  id: number;
  sourceId: string;
  slug: string;
  name: string;
  aliases: string[];
  episodes: CatalogueEpisodeRecord[];
}

export interface OfficialYouTubeReviewCandidate {
  candidateId: string;
  sourceId: string;
  publisher: string;
  channelId: string;
  evidenceUrls: string[];
  rightsDisposition: 'reference-only';
  autoEnabled: false;
  video: ListedYouTubeVideo;
  probe: YouTubeVideoProbe | null;
  parsedEpisode: { kind: 'regular' | 'special' | 'prologue'; number: number | null } | null;
  fullEpisodeCandidate: boolean;
  confidence: number;
  decision: 'manual-review' | 'hold';
  reasonCodes: string[];
  match: null | {
    titleId: number;
    titleSourceId: string;
    episodeId: number | null;
    episodeSourceId: string | null;
    versionId: number | null;
    versionSourceId: string | null;
    language: string;
    method: 'authoritative' | 'exact-alias' | 'scored-alias';
  };
}

export interface SourceInventoryCheckpoint {
  version: 1;
  sourceId: string;
  sourceShard: number;
  continuation: string | null;
  completed: boolean;
  pages: number;
  estimatedTotalVideos: number | null;
  videos: Record<string, ListedYouTubeVideo>;
  duplicateOccurrences: number;
  requests: number;
  retryCount: number;
  errors: Array<{ at: string; code: string; message: string }>;
  startedAt: string;
  updatedAt: string;
}

export interface ProbeShardCheckpoint {
  version: 1;
  matcherRevision?: string;
  shard: number;
  completed: boolean;
  probes: Record<string, YouTubeVideoProbe>;
  candidates: Record<string, OfficialYouTubeReviewCandidate>;
  requests: number;
  retryCount: number;
  errors: Array<{ videoId: string; at: string; code: string; message: string }>;
  startedAt: string;
  updatedAt: string;
}

export class DiscoveryHttpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export function stableShard(value: string, shardCount = DEFAULT_YOUTUBE_SHARD_COUNT): number {
  if (!Number.isSafeInteger(shardCount) || shardCount < 1 || shardCount > 10_000)
    throw new Error('INVALID_SHARD_COUNT');
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % shardCount;
}

export function validateOfficialPublisherSource(source: OfficialPublisherSource): void {
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(source.id)) throw new Error('INVALID_SOURCE_ID');
  if (!source.publisher.trim() || !CHANNEL_ID.test(source.channelId)) throw new Error('INVALID_SOURCE_IDENTITY');
  if (source.channelUrl !== `https://www.youtube.com/channel/${source.channelId}`)
    throw new Error('INVALID_SOURCE_CHANNEL_URL');
  if (source.kind === 'playlist' && (!source.playlistId || !PLAYLIST_ID.test(source.playlistId)))
    throw new Error('INVALID_SOURCE_PLAYLIST');
  if (!source.evidenceUrls.length || source.evidenceUrls.some((value) => {
    try { return new URL(value).protocol !== 'https:'; } catch { return true; }
  })) throw new Error('INVALID_SOURCE_EVIDENCE');
  if (source.disposition !== 'reference-only') throw new Error('INVALID_SOURCE_DISPOSITION');
  if (source.discoveryMode && !['generic', 'inventory-only'].includes(source.discoveryMode))
    throw new Error('INVALID_SOURCE_DISCOVERY_MODE');
  if (source.fullEpisodeEvidenceUrl) {
    try { if (new URL(source.fullEpisodeEvidenceUrl).protocol !== 'https:') throw new Error(); }
    catch { throw new Error('INVALID_FULL_EPISODE_EVIDENCE'); }
  }
  for (const hint of source.seriesHints ?? []) {
    if (!hint.aliases.length || hint.aliases.some((alias) => !alias.trim())
      || (hint.episodeOffset !== undefined && (!Number.isSafeInteger(hint.episodeOffset) || Math.abs(hint.episodeOffset) > 10_000)))
      throw new Error('INVALID_SERIES_HINT');
  }
  const authoritativeVideos = new Set<string>();
  for (const mapping of source.authoritativeMappings ?? []) {
    if (!VIDEO_ID.test(mapping.videoId) || !mapping.titleSourceId || !mapping.episodeSourceId || !mapping.versionSourceId || !mapping.identityEvidenceUrls.length)
      throw new Error('INVALID_AUTHORITATIVE_MAPPING');
    if (authoritativeVideos.has(mapping.videoId)) throw new Error('DUPLICATE_AUTHORITATIVE_MAPPING');
    if (mapping.identityEvidenceUrls.some((value) => { try { return new URL(value).protocol !== 'https:'; } catch { return true; } }))
      throw new Error('INVALID_AUTHORITATIVE_EVIDENCE');
    authoritativeVideos.add(mapping.videoId);
  }
}

export function validateOfficialYouTubeDiscoveryConfig(config: OfficialYouTubeDiscoveryConfig): void {
  if (config.version !== 1 || !Number.isSafeInteger(config.shardCount) || config.shardCount < 1 || config.shardCount > 10_000)
    throw new Error('INVALID_DISCOVERY_CONFIG');
  const byId = new Map<string, OfficialPublisherSource>();
  for (const source of config.sources) {
    validateOfficialPublisherSource(source);
    if (byId.has(source.id)) throw new Error(`DUPLICATE_SOURCE:${source.id}`);
    byId.set(source.id, source);
  }
  const policyIds = new Set<string>();
  const policyChannels = new Set<string>();
  for (const policy of config.playbackPolicies) {
    if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(policy.id) || policyIds.has(policy.id)) throw new Error('INVALID_PLAYBACK_POLICY_ID');
    if (!CHANNEL_ID.test(policy.channelId) || policyChannels.has(policy.channelId)) throw new Error('INVALID_PLAYBACK_POLICY_CHANNEL');
    if (policy.adapter !== 'youtube-official' || policy.state !== 'implemented' || !policy.approvalRegistry.trim() || !policy.sourceIds.length
      || new Set(policy.sourceIds).size !== policy.sourceIds.length)
      throw new Error('INVALID_PLAYBACK_POLICY');
    if (policy.sourceIds.some((sourceId) => byId.get(sourceId)?.channelId !== policy.channelId)) throw new Error('PLAYBACK_POLICY_SOURCE_MISMATCH');
    policyIds.add(policy.id);
    policyChannels.add(policy.channelId);
  }
}

function balancedJson(text: string, marker: string): unknown {
  let from = 0;
  for (;;) {
    const markerIndex = text.indexOf(marker, from);
    if (markerIndex < 0) break;
    const start = text.indexOf('{', markerIndex + marker.length);
    if (start < 0 || start - markerIndex > 256) {
      from = markerIndex + marker.length;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) {
        try { return JSON.parse(text.slice(start, index + 1)); } catch { break; }
      }
    }
    from = markerIndex + marker.length;
  }
  throw new DiscoveryHttpError('YOUTUBE_SCHEMA_CHANGED', `Missing or malformed ${marker}.`, false);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function renderedText(value: unknown): string | null {
  const object = record(value);
  if (!object) return typeof value === 'string' ? value : null;
  if (typeof object.simpleText === 'string') return object.simpleText;
  if (Array.isArray(object.runs)) {
    const text = object.runs.map((run) => record(run)?.text).filter((part): part is string => typeof part === 'string').join('');
    return text || null;
  }
  return null;
}

function durationSeconds(value: string | null): number | null {
  if (!value || !/^\d{1,3}(?::\d{1,2}){1,2}$/.test(value.trim())) return null;
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function nestedString(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) current = record(current)?.[key];
  return typeof current === 'string' ? current : null;
}

function videoRenderer(value: unknown): ListedYouTubeVideo | null {
  const renderer = record(value);
  const videoId = renderer?.videoId;
  const title = renderedText(renderer?.title);
  if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId) || !title) return null;
  const bylineRuns = record(renderer?.shortBylineText)?.runs;
  const byline = record(Array.isArray(bylineRuns) ? bylineRuns[0] : null);
  const channelId = nestedString(byline, ['navigationEndpoint', 'browseEndpoint', 'browseId']);
  const index = Number(renderedText(renderer?.index));
  return {
    videoId,
    title,
    channelId: channelId && CHANNEL_ID.test(channelId) ? channelId : null,
    channelLabel: typeof byline?.text === 'string' ? byline.text : null,
    durationSeconds: durationSeconds(renderedText(renderer?.lengthText)),
    publishedText: renderedText(renderer?.publishedTimeText),
    playlistIndex: Number.isSafeInteger(index) && index > 0 ? index : null,
  };
}

function lockupVideo(value: unknown): ListedYouTubeVideo | null {
  const model = record(value);
  const videoId = model?.contentId;
  if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId) || model?.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
  const metadata = record(record(model.metadata)?.lockupMetadataViewModel);
  const title = nestedString(metadata, ['title', 'content']);
  if (!title) return null;
  const rows = record(record(metadata?.metadata)?.contentMetadataViewModel)?.metadataRows;
  const firstPart = Array.isArray(rows)
    ? record(Array.isArray(record(rows[0])?.metadataParts) ? (record(rows[0])?.metadataParts as unknown[])[0] : null)
    : null;
  const channelText = record(firstPart?.text);
  const commandRuns = channelText?.commandRuns;
  const firstCommand = record(Array.isArray(commandRuns) ? commandRuns[0] : null);
  const channelId = nestedString(firstCommand, ['onTap', 'innertubeCommand', 'browseEndpoint', 'browseId']);
  let duration: string | null = null;
  let playlistIndex: number | null = null;
  walk(model, (key, child) => {
    if (key === 'thumbnailBadgeViewModel') {
      const text = record(child)?.text;
      if (typeof text === 'string' && /^\d{1,3}(?::\d{1,2}){1,2}$/.test(text)) duration ??= text;
    }
    if (key === 'watchEndpoint') {
      const endpoint = record(child);
      if (endpoint?.videoId === videoId && Number.isSafeInteger(endpoint.index)) playlistIndex ??= Number(endpoint.index) + 1;
    }
  });
  return {
    videoId,
    title,
    channelId: channelId && CHANNEL_ID.test(channelId) ? channelId : null,
    channelLabel: typeof channelText?.content === 'string' ? channelText.content : null,
    durationSeconds: durationSeconds(duration),
    publishedText: null,
    playlistIndex,
  };
}

function walk(value: unknown, visitor: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor);
    return;
  }
  const object = record(value);
  if (!object) return;
  for (const [key, child] of Object.entries(object)) {
    visitor(key, child);
    walk(child, visitor);
  }
}

function listingFromData(value: unknown): Omit<ListedYouTubePage, 'session'> {
  const videos = new Map<string, ListedYouTubeVideo>();
  const continuations: string[] = [];
  const itemContinuations: string[] = [];
  let channelId: string | null = null;
  let channelLabel: string | null = null;
  let estimatedTotalVideos: number | null = null;
  walk(value, (key, child) => {
    if (['videoRenderer', 'gridVideoRenderer', 'playlistVideoRenderer'].includes(key)) {
      const parsed = videoRenderer(child);
      if (parsed) videos.set(parsed.videoId, parsed);
    }
    if (key === 'lockupViewModel') {
      const parsed = lockupVideo(child);
      if (parsed) videos.set(parsed.videoId, parsed);
    }
    if (key === 'continuationCommand') {
      const token = record(child)?.token;
      if (typeof token === 'string' && token.length < 16_384) continuations.push(token);
    }
    if (key === 'continuationItemRenderer' || key === 'continuationItemViewModel') {
      walk(child, (nestedKey, nestedChild) => {
        if (nestedKey !== 'continuationCommand') return;
        const token = record(nestedChild)?.token;
        if (typeof token === 'string' && token.length < 16_384) itemContinuations.push(token);
      });
    }
    if (key === 'channelMetadataRenderer') {
      const metadata = record(child);
      if (typeof metadata?.externalId === 'string' && CHANNEL_ID.test(metadata.externalId)) channelId = metadata.externalId;
      if (typeof metadata?.title === 'string') channelLabel = metadata.title;
    }
    const text = renderedText(child);
    const total = text?.match(/^([\d,.]+)\s+videos?$/i);
    if (total) {
      const count = Number(total[1].replaceAll(',', ''));
      if (Number.isSafeInteger(count)) estimatedTotalVideos = Math.max(estimatedTotalVideos ?? 0, count);
    }
  });
  return { videos: [...videos.values()], continuation: itemContinuations[0] ?? continuations[0] ?? null, channelId, channelLabel, estimatedTotalVideos };
}

function configString(html: string, name: string): string | null {
  const match = html.match(new RegExp(`"${name}":"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`));
  if (!match) return null;
  try { return JSON.parse(`"${match[1]}"`); } catch { return null; }
}

export function parseYouTubeInitialListing(html: string): ListedYouTubePage {
  const data = balancedJson(html, 'ytInitialData');
  const apiKey = configString(html, 'INNERTUBE_API_KEY');
  const clientVersion = configString(html, 'INNERTUBE_CLIENT_VERSION');
  if (!apiKey || !clientVersion) throw new DiscoveryHttpError('YOUTUBE_SCHEMA_CHANGED', 'Missing public page continuation configuration.', false);
  return {
    ...listingFromData(data),
    session: {
      apiKey,
      clientName: 'WEB',
      clientVersion,
      visitorData: configString(html, 'VISITOR_DATA') ?? undefined,
    },
  };
}

export function parseYouTubeContinuation(value: unknown): ListedYouTubePage {
  return listingFromData(value);
}

export function parseYouTubePlayerProbe(
  html: string,
  expectedVideoId: string,
  observationRegion: string,
  observedAt = new Date().toISOString(),
): YouTubeVideoProbe {
  if (!VIDEO_ID.test(expectedVideoId)) throw new Error('INVALID_VIDEO_ID');
  const root = record(balancedJson(html, 'ytInitialPlayerResponse')) ?? {};
  const details = record(root.videoDetails) ?? {};
  const playability = record(root.playabilityStatus) ?? {};
  const microformat = record(record(root.microformat)?.playerMicroformatRenderer) ?? {};
  const id = typeof details.videoId === 'string' ? details.videoId : expectedVideoId;
  if (id !== expectedVideoId) throw new DiscoveryHttpError('VIDEO_IDENTITY_MISMATCH', 'YouTube returned a different video identity.', false);
  const status = typeof playability.status === 'string' ? playability.status : 'UNKNOWN';
  const reason = typeof playability.reason === 'string' ? playability.reason : null;
  const playableInEmbed = typeof playability.playableInEmbed === 'boolean' ? playability.playableInEmbed : null;
  let availability: YouTubeVideoProbe['availability'] = 'unknown';
  if (status === 'OK' && playableInEmbed !== false) availability = 'playable';
  else if (playableInEmbed === false) availability = 'embed-disabled';
  else if (status === 'LOGIN_REQUIRED') availability = 'login-required';
  else if (/country|region|location/i.test(reason ?? '')) availability = 'region-blocked';
  else if (['ERROR', 'UNPLAYABLE'].includes(status)) availability = 'unavailable';
  const seconds = Number(details.lengthSeconds);
  const countries = Array.isArray(microformat.availableCountries)
    ? microformat.availableCountries.filter((country): country is string => typeof country === 'string' && /^[A-Z]{2}$/.test(country)).slice(0, 300)
    : [];
  return {
    videoId: id,
    title: typeof details.title === 'string' ? details.title : null,
    channelId: typeof details.channelId === 'string' && CHANNEL_ID.test(details.channelId) ? details.channelId : null,
    channelLabel: typeof details.author === 'string' ? details.author : null,
    durationSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    publishDate: typeof microformat.publishDate === 'string' ? microformat.publishDate : null,
    availability,
    playableInEmbed,
    reason,
    observedAt,
    observationRegion,
    availableCountries: countries,
  };
}

export function parseEpisodeIdentity(title: string): { kind: 'regular' | 'special' | 'prologue'; number: number | null } | null {
  if (/\bprologue\b/i.test(title)) return { kind: 'prologue', number: null };
  const special = title.match(/\b(?:special|ova|oad|sp)(?:\s+special)?\s*(?:episode\s*)?(\d+(?:\.\d+)?)?/i);
  if (special) return { kind: 'special', number: special[1] ? Number(special[1]) : null };
  const regular = title.match(/\b(?:full\s*)?(?:episode|ep\.?|e)\s*[-#:]*\s*(\d+(?:\.\d+)?)/i)
    ?? title.match(/\bs\d+\s*:\s*e\s*(\d+(?:\.\d+)?)/i)
    ?? title.match(/\bride\s*[-#:]*\s*(\d+(?:\.\d+)?)/i)
    ?? title.match(/(?:^|\s)ép\.?\s*[-#:]*\s*(\d+(?:\.\d+)?)/i)
    ?? title.match(/(?:^|\s)#(\d+(?:\.\d+)?)(?:\s|$)/)
    ?? title.match(/第\s*(\d+(?:\.\d+)?)\s*話/);
  return regular ? { kind: 'regular', number: Number(regular[1]) } : null;
}

export function inferEpisodeLanguage(title: string, fallback: string): string {
  if (/\b(?:english|eng)\s*dub\b|\bdual\s*audio\b|\bdubbed\b/i.test(title)) return 'dub';
  if (/\b(?:english|eng)\s*sub\b|\bmulti[-\s]*subs?\b|\bsubbed\b|\bw\/?\s*subtitles\b/i.test(title)) return 'sub';
  return fallback;
}

export function isEpisodePackOrRange(title: string): boolean {
  return /\b(?:all\s+episodes|full\s+season|binge(?:-watch)?|marathon|recap|digest|compilation|watch\s+party)\b/i.test(title)
    || /\b(?:episodes?|eps?\.?|e)\s*\d+\s*(?:-|–|—|~|〜|～|&|\+|,|\/|to)\s*(?:episodes?|eps?\.?|e)?\s*\d+/i.test(title)
    || /\b(?:episodes?|eps?\.?|e)\s*\d+.{0,40}\b(?:episodes?|eps?\.?|e)\s*\d+/i.test(title)
    || /\bs\d+\s*:\s*e\s*\d+\s*(?:-|–|—|~|〜|～|&|\+|,|\/)\s*(?:s\d+\s*:\s*)?e?\s*\d+/i.test(title)
    || /(?:^|\s)ép\.?\s*\d+.{0,18}(?:^|\s)ép\.?\s*\d+/i.test(title)
    || /第\s*\d+(?:\.\d+)?\s*話.{0,12}第\s*\d+(?:\.\d+)?\s*話/.test(title);
}

const EPISODE_IDENTITY_MARKERS = [
  /\b(?:full\s*)?(?:episode|ep\.?|e)\s*[-#:]*\s*\d+(?:\.\d+)?/i,
  /\bs\d+\s*:\s*e\s*\d+(?:\.\d+)?/i,
  /\bride\s*[-#:]*\s*\d+(?:\.\d+)?/i,
  /(?:^|\s)ép\.?\s*[-#:]*\s*\d+(?:\.\d+)?/i,
  /第\s*\d+(?:\.\d+)?\s*話/,
] as const;

function firstEpisodeMarkerIndex(value: string): number {
  let index = -1;
  for (const pattern of EPISODE_IDENTITY_MARKERS) {
    const match = pattern.exec(value);
    if (match?.index !== undefined && (index < 0 || match.index < index)) index = match.index;
  }
  return index;
}

/**
 * Return only the title-bearing portions of a publisher label. Episode
 * subtitles are intentionally excluded so words such as "Kingdom" or
 * "Strange" inside a synopsis cannot be mistaken for a different series.
 * A pipe-delimited series label after a leading "Full Episode N" remains
 * eligible (for example, "Full Episode 14 | Yakitate!! JAPAN").
 */
export function extractSeriesIdentitySegments(videoTitle: string): string[] {
  const segments: string[] = [];
  for (const raw of videoTitle.split('|')) {
    const value = raw.trim();
    if (!value) continue;
    const markerIndex = firstEpisodeMarkerIndex(value);
    const candidate = (markerIndex >= 0 ? value.slice(0, markerIndex) : value)
      .replace(/[\s\-–—:•·]+$/u, '')
      .trim();
    if (!candidate || /^(?:(?:english|eng)\s+(?:sub|dub)|multi[-\s]*subs?|subbed|dubbed|dual\s*audio|full\s*episode|hd\s*remaster|6\s*audio)$/i.test(candidate))
      continue;
    segments.push(candidate);
  }
  return [...new Set(segments)];
}

export function isFullEpisodeCandidate(video: ListedYouTubeVideo, probe?: YouTubeVideoProbe | null): boolean {
  const duration = probe?.durationSeconds ?? video.durationSeconds;
  if (!duration || duration < 15 * 60) return false;
  if (/\b(?:trailer|teaser|preview|clip|opening|ending|creditless|music video|shorts?|pv)\b/i.test(video.title)) return false;
  if (isEpisodePackOrRange(video.title)) return false;
  return /\b(?:full\s*(?:episode|ep)|episode\s*\d+|ep\.?\s*\d+|s\d+\s*:\s*e\s*\d+|ride\s*\d+|prologue|special\s*(?:episode\s*)?\d*)\b/i.test(video.title)
    || /(?:^|\s)ép\.?\s*\d+/i.test(video.title)
    || /第\s*\d+(?:\.\d+)?\s*話/.test(video.title);
}

export function normalizeAnimeTitle(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(?:full|episode|ep|subbed|dubbed|english|multi subs?|official)\b/g, ' ')
    .replace(/\[[^\]]*]|\([^)]*(?:sub|dub|official|episode)[^)]*\)/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function titleTokens(value: string): Set<string> {
  return new Set(normalizeAnimeTitle(value).split(' ').filter((token) => token.length > 1));
}

function tokenScore(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function episodeMatches(episode: CatalogueEpisodeRecord, parsed: NonNullable<ReturnType<typeof parseEpisodeIdentity>>, offset: number): boolean {
  if (parsed.kind === 'prologue') return /prologue/i.test(`${episode.numberText} ${episode.label ?? ''}`);
  if (parsed.kind === 'special') {
    if (!/(?:special|ova|oad|\bsp\b)/i.test(`${episode.numberText} ${episode.label ?? ''}`)) return false;
    return parsed.number === null || episode.numberSort === parsed.number + offset || Number(episode.numberText.match(/\d+(?:\.\d+)?/)?.[0]) === parsed.number + offset;
  }
  return parsed.number !== null && (episode.numberSort === parsed.number + offset || Number(episode.numberText) === parsed.number + offset);
}

export function loadOfficialYouTubeCatalogue(db: DatabaseSync): CatalogueTitleRecord[] {
  const titles = db.prepare("SELECT id,source_id AS sourceId,slug,name FROM titles WHERE source='anikoto' ORDER BY id").all() as Array<{ id: number; sourceId: string; slug: string; name: string }>;
  const aliases = db.prepare('SELECT title_id AS titleId,alias FROM title_aliases ORDER BY title_id,id').all() as Array<{ titleId: number; alias: string }>;
  const episodes = db.prepare('SELECT id,title_id AS titleId,source_id AS sourceId,number_text AS numberText,number_sort AS numberSort,label FROM episodes ORDER BY title_id,id').all() as Array<{ id: number; titleId: number; sourceId: string; numberText: string; numberSort: number | null; label: string | null }>;
  const versions = db.prepare('SELECT id,episode_id AS episodeId,source_id AS sourceId,language FROM episode_versions ORDER BY episode_id,id').all() as Array<{ id: number; episodeId: number; sourceId: string; language: string }>;
  const aliasesByTitle = new Map<number, string[]>();
  for (const alias of aliases) (aliasesByTitle.get(alias.titleId) ?? aliasesByTitle.set(alias.titleId, []).get(alias.titleId)!).push(alias.alias);
  const versionsByEpisode = new Map<number, CatalogueVersionRecord[]>();
  for (const version of versions) (versionsByEpisode.get(version.episodeId) ?? versionsByEpisode.set(version.episodeId, []).get(version.episodeId)!).push(version);
  const episodesByTitle = new Map<number, CatalogueEpisodeRecord[]>();
  for (const episode of episodes) (episodesByTitle.get(episode.titleId) ?? episodesByTitle.set(episode.titleId, []).get(episode.titleId)!).push({ ...episode, versions: versionsByEpisode.get(episode.id) ?? [] });
  return titles.map((title) => ({ ...title, aliases: [title.name, ...(aliasesByTitle.get(title.id) ?? [])], episodes: episodesByTitle.get(title.id) ?? [] }));
}

export class OfficialYouTubeCatalogueMatcher {
  private readonly bySourceId = new Map<string, CatalogueTitleRecord>();
  private readonly tokenIndex = new Map<string, Set<CatalogueTitleRecord>>();
  constructor(private readonly titles: CatalogueTitleRecord[]) {
    for (const title of titles) {
      this.bySourceId.set(title.sourceId, title);
      for (const alias of title.aliases) for (const token of titleTokens(alias))
        (this.tokenIndex.get(token) ?? this.tokenIndex.set(token, new Set()).get(token)!).add(title);
    }
  }

  match(source: OfficialPublisherSource, video: ListedYouTubeVideo, probe: YouTubeVideoProbe | null): OfficialYouTubeReviewCandidate {
    const parsedEpisode = parseEpisodeIdentity(video.title);
    const fullEpisodeCandidate = isFullEpisodeCandidate(video, probe);
    const reasons: string[] = [];
    const authoritative = source.authoritativeMappings?.find((item) => item.videoId === video.videoId);
    let title: CatalogueTitleRecord | undefined;
    let method: NonNullable<OfficialYouTubeReviewCandidate['match']>['method'] = 'scored-alias';
    let confidence = 0;
    let ambiguous = false;
    let offset = 0;
    if (authoritative) {
      title = this.bySourceId.get(authoritative.titleSourceId);
      method = 'authoritative';
      confidence = title ? 1 : 0;
      if (!title) reasons.push('authoritative-title-missing');
    } else {
      const identitySegments = extractSeriesIdentitySegments(video.title);
      const normalizedIdentitySegments = identitySegments.map(normalizeAnimeTitle);
      const identityText = identitySegments.join(' ');
      const hints = (source.seriesHints ?? []).filter((hint) => hint.aliases.some((alias) => {
        const normalizedAlias = normalizeAnimeTitle(alias);
        return normalizedAlias.length >= 5 && normalizedIdentitySegments.some((segment) => segment.includes(normalizedAlias));
      }));
      const hinted = hints.map((hint) => hint.titleSourceId ? this.bySourceId.get(hint.titleSourceId) : undefined).filter((item): item is CatalogueTitleRecord => !!item);
      const tokens = titleTokens(identityText);
      const pool = new Set<CatalogueTitleRecord>(hinted);
      for (const token of tokens) for (const candidate of this.tokenIndex.get(token) ?? []) pool.add(candidate);
      const ranked = [...pool].map((candidate) => {
        let best = 0;
        let exact = false;
        for (const alias of candidate.aliases) {
          const normalizedAlias = normalizeAnimeTitle(alias);
          const contained = normalizedAlias.length >= 5 && normalizedIdentitySegments.some((segment) => segment.includes(normalizedAlias));
          exact ||= normalizedIdentitySegments.some((segment) => segment === normalizedAlias);
          best = Math.max(best, exact ? .9 : contained ? .82 : tokenScore(tokens, titleTokens(alias)) * .78);
        }
        if (hinted.includes(candidate)) best = Math.min(.97, best + .12);
        return { candidate, score: best, exact };
      }).sort((left, right) => right.score - left.score || left.candidate.id - right.candidate.id);
      if (ranked[0]?.score && ranked[0].score >= .58) {
        title = ranked[0].candidate;
        confidence = ranked[0].score;
        method = ranked[0].exact ? 'exact-alias' : 'scored-alias';
        ambiguous = !!ranked[1] && ranked[0].score - ranked[1].score < .04;
      }
      const hint = hints.find((item) => item.titleSourceId === title?.sourceId) ?? hints[0];
      offset = hint?.episodeOffset ?? 0;
    }
    let episode: CatalogueEpisodeRecord | undefined;
    let version: CatalogueVersionRecord | undefined;
    const language = authoritative?.language ?? inferEpisodeLanguage(video.title, source.defaultLanguage);
    if (title && authoritative) {
      episode = title.episodes.find((item) => item.sourceId === authoritative.episodeSourceId);
      version = episode?.versions.find((item) => item.sourceId === authoritative.versionSourceId && item.language === authoritative.language);
      if (!episode || !version) reasons.push('authoritative-episode-version-missing');
    } else if (title && parsedEpisode) {
      const episodeMatchesList = title.episodes.filter((item) => episodeMatches(item, parsedEpisode, offset));
      if (episodeMatchesList.length === 1) episode = episodeMatchesList[0];
      else if (episodeMatchesList.length > 1) reasons.push('ambiguous-episode');
      version = episode?.versions.find((item) => item.language === language);
      if (!episode) reasons.push('episode-not-found');
      else if (!version) reasons.push('language-version-not-found');
      else confidence = Math.min(.99, confidence + .06);
    }
    if (!fullEpisodeCandidate) reasons.push('not-full-episode-candidate');
    if (!parsedEpisode) reasons.push('episode-identity-not-parsed');
    if (!title) reasons.push('title-not-matched');
    if (ambiguous) reasons.push('ambiguous-title');
    if (!probe) reasons.push('embed-not-probed');
    else {
      if (probe.channelId !== source.channelId) reasons.push('publisher-channel-mismatch');
      if (probe.availability === 'region-blocked') reasons.push('region-blocked');
      else if (probe.availability === 'embed-disabled') reasons.push('embed-disabled');
      else if (probe.availability !== 'playable') reasons.push('video-unavailable');
    }
    const match = title ? {
      titleId: title.id,
      titleSourceId: title.sourceId,
      episodeId: episode?.id ?? null,
      episodeSourceId: episode?.sourceId ?? null,
      versionId: version?.id ?? null,
      versionSourceId: version?.sourceId ?? null,
      language,
      method,
    } : null;
    const decision = fullEpisodeCandidate && !!match?.versionId && !ambiguous && confidence >= .82 && probe?.availability === 'playable' && probe.channelId === source.channelId
      ? 'manual-review' : 'hold';
    if (decision === 'manual-review') reasons.push('manual-rights-and-identity-review-required');
    return {
      candidateId: `youtube:${video.videoId}`,
      sourceId: source.id,
      publisher: source.publisher,
      channelId: source.channelId,
      evidenceUrls: [...new Set([...source.evidenceUrls, ...(authoritative?.identityEvidenceUrls ?? [])])],
      rightsDisposition: 'reference-only',
      autoEnabled: false,
      video,
      probe,
      parsedEpisode,
      fullEpisodeCandidate,
      confidence: Number(confidence.toFixed(4)),
      decision,
      reasonCodes: [...new Set(reasons)],
      match,
    };
  }
}

interface HostState {
  active: number;
  concurrency: number;
  tokens: number;
  lastRefill: number;
  failures: number;
  successes: number;
  circuitUntil: number;
}

export interface AdaptiveSchedulerOptions {
  globalConcurrency: number;
  perHostConcurrency: number;
  requestsPerSecond: number;
  burst: number;
  circuitFailures: number;
  circuitCooldownMs: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class AdaptiveRequestScheduler {
  private active = 0;
  private readonly states = new Map<string, HostState>();
  private readonly waiters = new Set<() => void>();
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  constructor(private readonly options: AdaptiveSchedulerOptions) {
    if (![options.globalConcurrency, options.perHostConcurrency, options.burst, options.circuitFailures].every((value) => Number.isSafeInteger(value) && value > 0) || options.requestsPerSecond <= 0)
      throw new Error('INVALID_SCHEDULER_OPTIONS');
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }
  private state(host: string): HostState {
    const existing = this.states.get(host);
    if (existing) return existing;
    const created = { active: 0, concurrency: this.options.perHostConcurrency, tokens: this.options.burst, lastRefill: this.now(), failures: 0, successes: 0, circuitUntil: 0 };
    this.states.set(host, created);
    return created;
  }
  private releaseWaiters(): void {
    for (const resume of this.waiters) resume();
    this.waiters.clear();
  }
  private async acquire(host: string): Promise<HostState> {
    for (;;) {
      const state = this.state(host);
      const now = this.now();
      state.tokens = Math.min(this.options.burst, state.tokens + (now - state.lastRefill) / 1000 * this.options.requestsPerSecond);
      state.lastRefill = now;
      if (state.circuitUntil > now)
        throw new DiscoveryHttpError('CIRCUIT_OPEN', `Circuit open for ${host}.`, true, undefined, state.circuitUntil - now);
      if (this.active < this.options.globalConcurrency && state.active < state.concurrency && state.tokens >= 1) {
        state.tokens -= 1;
        state.active += 1;
        this.active += 1;
        return state;
      }
      const tokenWait = state.tokens < 1 ? Math.ceil((1 - state.tokens) / this.options.requestsPerSecond * 1000) : 100;
      await Promise.race([
        new Promise<void>((resolve) => this.waiters.add(resolve)),
        this.sleep(Math.max(1, Math.min(tokenWait, 1_000))),
      ]);
    }
  }
  async run<T>(host: string, operation: () => Promise<T>): Promise<T> {
    const state = await this.acquire(host);
    try {
      const result = await operation();
      state.failures = 0;
      state.successes += 1;
      if (state.successes >= 20 && state.concurrency < this.options.perHostConcurrency) {
        state.concurrency += 1;
        state.successes = 0;
      }
      return result;
    } catch (error) {
      state.successes = 0;
      state.failures += 1;
      if (error instanceof DiscoveryHttpError && error.status === 429) state.concurrency = Math.max(1, state.concurrency - 1);
      if (state.failures >= this.options.circuitFailures) state.circuitUntil = this.now() + this.options.circuitCooldownMs;
      throw error;
    } finally {
      state.active -= 1;
      this.active -= 1;
      this.releaseWaiters();
    }
  }
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const announced = Number(response.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > maxBytes) {
    await response.body?.cancel();
    throw new DiscoveryHttpError('RESPONSE_TOO_LARGE', 'YouTube metadata response exceeded the configured byte limit.', false, response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new DiscoveryHttpError('EMPTY_RESPONSE', 'YouTube metadata response had no body.', true, response.status);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new DiscoveryHttpError('RESPONSE_TOO_LARGE', 'YouTube metadata response exceeded the configured byte limit.', false, response.status);
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export interface YouTubeClientOptions {
  fetcher?: typeof fetch;
  scheduler: AdaptiveRequestScheduler;
  maxAttempts: number;
  timeoutMs: number;
  maxResponseBytes: number;
  observationRegion: string;
  retryCapMs: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onRequest?: (event: { url: string; attempt: number; retry: boolean }) => void;
}

export class PublicYouTubeMetadataClient {
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly sessions = new Map<string, ListingSession>();
  constructor(private readonly options: YouTubeClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }
  private async request(url: URL, init: RequestInit, maxBytes = this.options.maxResponseBytes, retriedOperation = false): Promise<string> {
    let last: unknown;
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      this.options.onRequest?.({ url: url.href, attempt, retry: retriedOperation || attempt > 1 });
      try {
        return await this.options.scheduler.run(url.hostname, async () => {
          const response = await this.fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(this.options.timeoutMs) });
          if (response.status >= 300 && response.status < 400) {
            await response.body?.cancel();
            throw new DiscoveryHttpError('UNEXPECTED_REDIRECT', `YouTube redirected metadata to ${response.headers.get('location') ?? 'an unknown location'}.`, false, response.status);
          }
          if (!response.ok) {
            await response.body?.cancel();
            throw new DiscoveryHttpError(
              response.status === 429 ? 'RATE_LIMITED' : response.status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'HTTP_ERROR',
              `YouTube metadata request failed with HTTP ${response.status}.`,
              response.status === 429 || response.status >= 500,
              response.status,
              retryAfter(response),
            );
          }
          return boundedText(response, maxBytes);
        });
      } catch (error) {
        last = error;
        const retryable = error instanceof DiscoveryHttpError ? error.retryable : error instanceof DOMException && error.name === 'TimeoutError';
        if (!retryable || attempt >= this.options.maxAttempts) break;
        const suggested = error instanceof DiscoveryHttpError ? error.retryAfterMs : undefined;
        await this.sleep(Math.min(this.options.retryCapMs, suggested ?? 250 * 2 ** (attempt - 1)));
      }
    }
    if (last instanceof Error) throw last;
    throw new DiscoveryHttpError('REQUEST_FAILED', 'YouTube metadata request failed.', true);
  }
  private initialUrl(source: OfficialPublisherSource): URL {
    validateOfficialPublisherSource(source);
    return source.kind === 'channel'
      ? new URL(`https://www.youtube.com/playlist?list=UU${source.channelId.slice(2)}&hl=en`)
      : new URL(`https://www.youtube.com/playlist?list=${source.playlistId}&hl=en`);
  }
  async list(source: OfficialPublisherSource, continuation: string | null): Promise<ListedYouTubePage> {
    let session = this.sessions.get(source.id);
    if (!continuation || !session) {
      const url = this.initialUrl(source);
      const init = { headers: { Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 SolanimeOfficialMetadata/1.0' } };
      let initial: ListedYouTubePage | null = null;
      let parseError: unknown;
      for (let parseAttempt = 1; parseAttempt <= 2; parseAttempt += 1) {
        try {
          initial = parseYouTubeInitialListing(await this.request(url, init, this.options.maxResponseBytes, parseAttempt > 1));
          break;
        } catch (error) {
          parseError = error;
          if (!(error instanceof DiscoveryHttpError) || error.code !== 'YOUTUBE_SCHEMA_CHANGED' || parseAttempt === 2) throw error;
          await this.sleep(250);
        }
      }
      if (!initial) throw parseError;
      session = initial.session!;
      this.sessions.set(source.id, session);
      if (!continuation) return initial;
    }
    const endpoint = new URL('https://www.youtube.com/youtubei/v1/browse');
    endpoint.searchParams.set('key', session.apiKey);
    const body = {
      context: { client: { clientName: session.clientName, clientVersion: session.clientVersion, hl: 'en', visitorData: session.visitorData } },
      continuation,
    };
    const text = await this.request(endpoint, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 SolanimeOfficialMetadata/1.0' }, body: JSON.stringify(body) });
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new DiscoveryHttpError('YOUTUBE_SCHEMA_CHANGED', 'Malformed YouTube continuation JSON.', false); }
    return parseYouTubeContinuation(value);
  }
  async probe(videoId: string): Promise<YouTubeVideoProbe> {
    if (!VIDEO_ID.test(videoId)) throw new Error('INVALID_VIDEO_ID');
    const url = new URL(`https://www.youtube.com/watch?v=${videoId}&hl=en`);
    const html = await this.request(url, { headers: { Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 SolanimeOfficialMetadata/1.0' } });
    return parseYouTubePlayerProbe(html, videoId, this.options.observationRegion);
  }
}

export interface InventoryOptions {
  shardCount: number;
  maxPages: number;
  requestBudget: number;
  now?: () => string;
  checkpoint: (state: SourceInventoryCheckpoint) => Promise<void> | void;
}

export async function inventoryOfficialPublisherSource(
  source: OfficialPublisherSource,
  client: Pick<PublicYouTubeMetadataClient, 'list'>,
  existing: SourceInventoryCheckpoint | null,
  options: InventoryOptions,
): Promise<SourceInventoryCheckpoint> {
  validateOfficialPublisherSource(source);
  const now = options.now ?? (() => new Date().toISOString());
  const state: SourceInventoryCheckpoint = existing ? structuredClone(existing) : {
    version: 1,
    sourceId: source.id,
    sourceShard: stableShard(`source:${source.id}`, options.shardCount),
    continuation: null,
    completed: false,
    pages: 0,
    estimatedTotalVideos: null,
    videos: {},
    duplicateOccurrences: 0,
    requests: 0,
    retryCount: 0,
    errors: [],
    startedAt: now(),
    updatedAt: now(),
  };
  if (state.completed) return state;
  while (!state.completed && state.pages < options.maxPages && state.requests < options.requestBudget) {
    try {
      const page = await client.list(source, state.continuation);
      state.requests += 1;
      if (page.channelId && page.channelId !== source.channelId) throw new DiscoveryHttpError('SOURCE_CHANNEL_MISMATCH', 'YouTube listing channel did not match configured publisher.', false);
      for (const video of page.videos) {
        if (video.channelId && video.channelId !== source.channelId) continue;
        if (state.videos[video.videoId]) state.duplicateOccurrences += 1;
        else state.videos[video.videoId] = video;
      }
      state.pages += 1;
      state.continuation = page.continuation;
      state.completed = !page.continuation;
      state.estimatedTotalVideos = page.estimatedTotalVideos ?? state.estimatedTotalVideos;
      state.updatedAt = now();
      await options.checkpoint(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof DiscoveryHttpError ? error.code : 'UNKNOWN_ERROR';
      state.errors.push({ at: now(), code, message });
      state.updatedAt = now();
      await options.checkpoint(state);
      throw error;
    }
  }
  return state;
}

export interface ProbeOptions {
  concurrency: number;
  requestBudget: number;
  source: OfficialPublisherSource;
  matcher: OfficialYouTubeCatalogueMatcher;
  matcherRevision?: string;
  checkpoint: (state: ProbeShardCheckpoint) => Promise<void> | void;
  now?: () => string;
}

export async function probeOfficialYouTubeShard(
  shard: number,
  videos: ListedYouTubeVideo[],
  client: Pick<PublicYouTubeMetadataClient, 'probe'>,
  existing: ProbeShardCheckpoint | null,
  options: ProbeOptions,
): Promise<ProbeShardCheckpoint> {
  const now = options.now ?? (() => new Date().toISOString());
  const state: ProbeShardCheckpoint = existing ? structuredClone(existing) : { version: 1, shard, completed: false, probes: {}, candidates: {}, requests: 0, retryCount: 0, errors: [], startedAt: now(), updatedAt: now() };
  if (state.matcherRevision !== options.matcherRevision) {
    for (const video of videos) {
      const probe = state.probes[video.videoId];
      if (probe) state.candidates[video.videoId] = options.matcher.match(options.source, video, probe);
    }
    state.matcherRevision = options.matcherRevision;
    state.completed = false;
  }
  const pending = videos.filter((video) => !state.probes[video.videoId] && !state.errors.some((error) => error.videoId === video.videoId)).slice(0, Math.max(0, options.requestBudget - state.requests));
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(options.concurrency, pending.length || 1)) }, async () => {
    for (;;) {
      const video = pending[cursor++];
      if (!video) return;
      try {
        const probe = await client.probe(video.videoId);
        state.probes[video.videoId] = probe;
        state.candidates[video.videoId] = options.matcher.match(options.source, video, probe);
      } catch (error) {
        state.errors.push({ videoId: video.videoId, at: now(), code: error instanceof DiscoveryHttpError ? error.code : 'UNKNOWN_ERROR', message: error instanceof Error ? error.message : String(error) });
      }
      state.requests += 1;
      state.updatedAt = now();
      await options.checkpoint(state);
    }
  });
  await Promise.all(workers);
  state.completed = pending.length === 0 || state.requests >= videos.length;
  state.updatedAt = now();
  await options.checkpoint(state);
  return state;
}
