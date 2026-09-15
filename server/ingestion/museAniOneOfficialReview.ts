import type {
  CatalogueTitleRecord,
  CatalogueVersionRecord,
  ListedYouTubeVideo,
  OfficialPublisherSource,
  YouTubeVideoProbe,
} from './youtubeOfficialDiscovery.ts';
import { parseEpisodeIdentity } from './youtubeOfficialDiscovery.ts';

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;

export const MUSE_ANIONE_SOURCE_IDS = Object.freeze([
  'ani-one-asia',
  'anione-chinese',
  'anione-thailand',
  'anione-philippines',
  'anione-vietnam',
  'anione-indonesia',
  'anione-india',
  'muse-asia',
  'muse-india',
  'muse-indonesia',
  'muse-malaysia',
  'muse-philippines',
  'muse-thailand',
  'muse-vietnam',
] as const);

export interface OfficialChannelPlaylist {
  playlistId: string;
  title: string;
  videoCount: number | null;
}

export interface OfficialChannelPlaylistPage {
  channelId: string;
  channelLabel: string | null;
  playlists: OfficialChannelPlaylist[];
  continuation: string | null;
  session: {
    apiKey: string;
    clientVersion: string;
    visitorData?: string;
  };
}

export interface MuseAniOneCatalogueIdentity {
  titleId: number;
  titleSourceId: string;
  titleSlug: string;
  catalogueTitle: string;
  episodeId: number;
  episodeSourceId: string;
  episodeNumber: string;
  versionId: number;
  versionSourceId: string;
  language: string;
}

export interface MuseAniOneReviewEntry {
  disposition: 'proposal' | 'hold';
  sourceId: string;
  publisher: string;
  channelId: string;
  channelUrl: string;
  publisherEvidenceUrls: string[];
  territoryNote: string;
  playlistId: string;
  playlistUrl: string;
  playlistTitle: string;
  videoId: string;
  watchUrl: string;
  embedUrl: string;
  videoTitle: string;
  observedAt: string;
  observationRegion: string;
  availableCountries: string[];
  playbackAvailability: YouTubeVideoProbe['availability'];
  playableInEmbed: boolean | null;
  identity: MuseAniOneCatalogueIdentity | null;
  reasonCodes: string[];
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function renderedText(value: unknown): string | null {
  const object = record(value);
  if (!object) return typeof value === 'string' ? value : null;
  if (typeof object.simpleText === 'string') return object.simpleText;
  if (Array.isArray(object.runs)) {
    const text = object.runs
      .map((run) => record(run)?.text)
      .filter((part): part is string => typeof part === 'string')
      .join('');
    return text || null;
  }
  return null;
}

function nestedString(value: unknown, path: readonly string[]): string | null {
  let current = value;
  for (const key of path) current = record(current)?.[key];
  return typeof current === 'string' ? current : null;
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

function balancedJson(text: string, marker: string): unknown {
  let cursor = 0;
  for (;;) {
    const markerIndex = text.indexOf(marker, cursor);
    if (markerIndex < 0) break;
    const start = text.indexOf('{', markerIndex + marker.length);
    if (start < 0 || start - markerIndex > 256) {
      cursor = markerIndex + marker.length;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}' && --depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          break;
        }
      }
    }
    cursor = markerIndex + marker.length;
  }
  throw new Error(`YOUTUBE_SCHEMA_CHANGED:${marker}`);
}

function configString(html: string, name: string): string | null {
  const match = html.match(new RegExp(`"${name}":"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`));
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return null;
  }
}

function playlistFromRenderer(value: unknown): OfficialChannelPlaylist | null {
  const renderer = record(value);
  const playlistId = renderer?.playlistId;
  const title = renderedText(renderer?.title);
  if (typeof playlistId !== 'string' || !PLAYLIST_ID.test(playlistId) || !title) return null;
  const countText = renderedText(renderer?.videoCountText)
    ?? renderedText(renderer?.videoCountShortText)
    ?? (typeof renderer?.videoCount === 'string' ? renderer.videoCount : null);
  const count = Number(countText?.replace(/[^0-9]/g, ''));
  return {
    playlistId,
    title,
    videoCount: Number.isSafeInteger(count) && count >= 0 ? count : null,
  };
}

function playlistFromLockup(value: unknown): OfficialChannelPlaylist | null {
  const model = record(value);
  if (model?.contentType !== 'LOCKUP_CONTENT_TYPE_PLAYLIST') return null;
  const playlistId = model.contentId;
  const title = nestedString(model, ['metadata', 'lockupMetadataViewModel', 'title', 'content']);
  if (typeof playlistId !== 'string' || !PLAYLIST_ID.test(playlistId) || !title) return null;
  let videoCount: number | null = null;
  walk(model, (key, child) => {
    if (key !== 'thumbnailBadgeViewModel') return;
    const text = record(child)?.text;
    if (typeof text !== 'string') return;
    const match = text.match(/([\d,]+)\s+videos?/i);
    if (match) videoCount = Number(match[1].replaceAll(',', ''));
  });
  return { playlistId, title, videoCount };
}

function parseChannelPlaylistData(value: unknown): Omit<OfficialChannelPlaylistPage, 'session'> {
  const playlists = new Map<string, OfficialChannelPlaylist>();
  const itemContinuations: string[] = [];
  const continuations: string[] = [];
  let channelId: string | null = null;
  let channelLabel: string | null = null;
  walk(value, (key, child) => {
    if (key === 'playlistRenderer' || key === 'gridPlaylistRenderer') {
      const playlist = playlistFromRenderer(child);
      if (playlist) playlists.set(playlist.playlistId, playlist);
    }
    if (key === 'lockupViewModel') {
      const playlist = playlistFromLockup(child);
      if (playlist) playlists.set(playlist.playlistId, playlist);
    }
    if (key === 'channelMetadataRenderer') {
      const metadata = record(child);
      if (typeof metadata?.externalId === 'string' && CHANNEL_ID.test(metadata.externalId)) channelId = metadata.externalId;
      if (typeof metadata?.title === 'string') channelLabel = metadata.title;
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
  });
  return {
    channelId: channelId ?? '',
    channelLabel,
    playlists: [...playlists.values()].sort((left, right) => left.playlistId.localeCompare(right.playlistId)),
    continuation: itemContinuations[0] ?? continuations[0] ?? null,
  };
}

export function parseOfficialChannelPlaylistsInitial(
  html: string,
  expectedChannelId: string,
): OfficialChannelPlaylistPage {
  if (!CHANNEL_ID.test(expectedChannelId)) throw new Error('INVALID_EXPECTED_CHANNEL');
  const parsed = parseChannelPlaylistData(balancedJson(html, 'ytInitialData'));
  const apiKey = configString(html, 'INNERTUBE_API_KEY');
  const clientVersion = configString(html, 'INNERTUBE_CLIENT_VERSION');
  if (!apiKey || !clientVersion) throw new Error('YOUTUBE_SCHEMA_CHANGED:session');
  if (parsed.channelId && parsed.channelId !== expectedChannelId) throw new Error('SOURCE_CHANNEL_MISMATCH');
  return {
    ...parsed,
    channelId: expectedChannelId,
    session: {
      apiKey,
      clientVersion,
      visitorData: configString(html, 'VISITOR_DATA') ?? undefined,
    },
  };
}

export function parseOfficialChannelPlaylistsContinuation(value: unknown): {
  playlists: OfficialChannelPlaylist[];
  continuation: string | null;
} {
  const parsed = parseChannelPlaylistData(value);
  return { playlists: parsed.playlists, continuation: parsed.continuation };
}

export function normalizeOfficialSeriesTitle(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[【[][^\]】]*(?:sub|dub|playlist|ani-one|ani one|muse|full episode)[^\]】]*[\]】]/gi, ' ')
    .replace(/\((?:[^)]*\b(?:sub|dub|playlist|full episode)\b[^)]*)\)/gi, ' ')
    .replace(/\b(?:english|multi(?:ple)? languages?)\s+(?:sub(?:title(?:s|d)?)?|dub(?:bed)?)\b/gi, ' ')
    .replace(/\b(?:en|id)\s+sub\b|\bsub\s+indo\b|\bvietsub\b|\b中字\b/gi, ' ')
    .replace(/\b(?:full episodes?|episode collection|official playlist|playlist)\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function officialSeriesTitleCandidates(value: string): string[] {
  const candidates = new Set<string>();
  const push = (candidate: string): void => {
    const normalized = normalizeOfficialSeriesTitle(candidate);
    if (normalized.length >= 3) candidates.add(normalized);
  };
  push(value);
  for (const part of value.split(/[|｜]/)) push(part);
  for (const match of value.matchAll(/[《⟪](.*?)[》⟫]/g)) push(match[1]);
  return [...candidates];
}

function inferredLanguage(value: string, fallback: string): string {
  return /\b(?:english|thai|hindi|tamil|telugu|bengali|indonesian|vietnamese|mandarin|cantonese)\s+dub(?:bed)?\b|\bdubbed\b/i.test(value)
    ? 'dub'
    : fallback;
}

function isDisallowedComposition(value: string): boolean {
  return /\b(?:marathon|compilation|recap|movie|film|digest|all episodes|complete season|full season|episodes?\s*\d+\s*[-&+]\s*\d+)\b/i.test(value);
}

function isMembershipOnly(value: string): boolean {
  return /\b(?:ultra|members? only|membership)\b/i.test(value);
}

function containsExactSeries(videoTitle: string, aliases: readonly string[]): boolean {
  const normalizedVideo = normalizeOfficialSeriesTitle(videoTitle);
  return aliases.some((alias) => {
    const normalizedAlias = normalizeOfficialSeriesTitle(alias);
    return normalizedAlias.length >= 4 && (` ${normalizedVideo} `).includes(` ${normalizedAlias} `);
  });
}

function episodeVersion(
  title: CatalogueTitleRecord,
  episodeNumber: number,
  language: string,
): { episodeId: number; episodeSourceId: string; episodeNumber: string; version: CatalogueVersionRecord } | null {
  const episodes = title.episodes.filter((episode) =>
    episode.numberSort === episodeNumber || Number(episode.numberText) === episodeNumber);
  if (episodes.length !== 1) return null;
  const versions = episodes[0].versions.filter((version) => version.language === language);
  if (versions.length !== 1) return null;
  return {
    episodeId: episodes[0].id,
    episodeSourceId: episodes[0].sourceId,
    episodeNumber: episodes[0].numberText,
    version: versions[0],
  };
}

export function buildMuseAniOneReviewEntry(input: {
  source: OfficialPublisherSource;
  playlist: OfficialChannelPlaylist;
  video: ListedYouTubeVideo;
  probe: YouTubeVideoProbe;
  catalogue: readonly CatalogueTitleRecord[];
}): MuseAniOneReviewEntry {
  const { source, playlist, video, probe, catalogue } = input;
  const reasonCodes: string[] = [];
  const combinedLabel = `${playlist.title} ${video.title}`;
  const language = inferredLanguage(combinedLabel, source.defaultLanguage);
  const playlistSeries = new Set(officialSeriesTitleCandidates(playlist.title));
  const exactTitles = catalogue.filter((title) => title.aliases.some((alias) => playlistSeries.has(normalizeOfficialSeriesTitle(alias))));
  if (exactTitles.length !== 1) reasonCodes.push(exactTitles.length ? 'catalogue-title-not-unique' : 'catalogue-title-not-exact');
  if (isMembershipOnly(combinedLabel)) reasonCodes.push('membership-only');
  if (isDisallowedComposition(combinedLabel)) reasonCodes.push('movie-recut-compilation-or-range');
  if (language !== source.defaultLanguage) reasonCodes.push('published-audio-language-catalogue-version-mismatch');
  const parsedEpisode = parseEpisodeIdentity(video.title);
  if (!parsedEpisode || parsedEpisode.kind !== 'regular' || parsedEpisode.number === null)
    reasonCodes.push('regular-episode-identity-not-exact');
  const title = exactTitles.length === 1 ? exactTitles[0] : null;
  if (title && !containsExactSeries(video.title, title.aliases)) reasonCodes.push('video-title-series-mismatch');
  const located = title && parsedEpisode?.kind === 'regular' && parsedEpisode.number !== null
    ? episodeVersion(title, parsedEpisode.number, language)
    : null;
  if (title && !located) reasonCodes.push('catalogue-episode-version-not-unique');
  if (video.channelId && video.channelId !== source.channelId) reasonCodes.push('playlist-video-publisher-mismatch');
  if (probe.channelId !== source.channelId) reasonCodes.push('probe-publisher-mismatch');
  if (probe.videoId !== video.videoId) reasonCodes.push('video-identity-mismatch');
  if (probe.availability === 'region-blocked') reasonCodes.push('region-blocked');
  else if (probe.availability === 'embed-disabled' || probe.playableInEmbed === false) reasonCodes.push('embed-disabled');
  else if (probe.availability === 'login-required') reasonCodes.push('login-or-membership-required');
  else if (probe.availability !== 'playable') reasonCodes.push('video-unavailable');
  const identity = title && located ? {
    titleId: title.id,
    titleSourceId: title.sourceId,
    titleSlug: title.slug,
    catalogueTitle: title.name,
    episodeId: located.episodeId,
    episodeSourceId: located.episodeSourceId,
    episodeNumber: located.episodeNumber,
    versionId: located.version.id,
    versionSourceId: located.version.sourceId,
    language: located.version.language,
  } : null;
  return {
    disposition: reasonCodes.length ? 'hold' : 'proposal',
    sourceId: source.id,
    publisher: source.publisher,
    channelId: source.channelId,
    channelUrl: source.channelUrl,
    publisherEvidenceUrls: [...source.evidenceUrls],
    territoryNote: source.territoryNote,
    playlistId: playlist.playlistId,
    playlistUrl: `https://www.youtube.com/playlist?list=${playlist.playlistId}`,
    playlistTitle: playlist.title,
    videoId: video.videoId,
    watchUrl: `https://www.youtube.com/watch?v=${video.videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${video.videoId}`,
    videoTitle: video.title,
    observedAt: probe.observedAt,
    observationRegion: probe.observationRegion,
    availableCountries: [...probe.availableCountries],
    playbackAvailability: probe.availability,
    playableInEmbed: probe.playableInEmbed,
    identity,
    reasonCodes: [...new Set(reasonCodes)].sort(),
  };
}
