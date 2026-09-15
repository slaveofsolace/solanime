import type {
  CatalogueTitleRecord,
  ListedYouTubeVideo,
  YouTubeVideoProbe,
} from './youtubeOfficialDiscovery.ts';

export const NOZOMI_CHANNEL_ID = 'UCUlvYyW7UVtNJQ1KTv_Bsdg';
export const NOZOMI_CHANNEL_URL = `https://www.youtube.com/channel/${NOZOMI_CHANNEL_ID}`;
export const NOZOMI_PUBLISHER_LABEL = 'Nozomi Entertainment';
export const NOZOMI_PUBLISHER_EVIDENCE_URLS = [
  'https://www.crunchyroll.com/news/announcements/2022/8/4/crunchyroll-closes-deal-to-acquire-anime-superstore-right-stuf',
  'https://www.crunchyroll.com/news/latest/2011/11/1/right-stuf-streams-revolutionary-girl-utena-animes-student-council-saga',
] as const;

export type NozomiLanguage = 'sub' | 'dub';
export type NozomiFormat = 'tv' | 'ova' | 'unmarked';

export interface NozomiSeriesCrosswalk {
  id: string;
  sourceSeriesAliases: readonly string[];
  season: number | null;
  format: NozomiFormat;
  catalogueTitleSourceId: string | null;
  catalogueTitleName: string | null;
  allowedLanguages: readonly NozomiLanguage[];
  holdReason?: string;
}

const crosswalk = (
  id: string,
  sourceSeriesAliases: readonly string[],
  catalogueTitleSourceId: string,
  catalogueTitleName: string,
  allowedLanguages: readonly NozomiLanguage[],
  options: { season?: number | null; format?: NozomiFormat } = {},
): NozomiSeriesCrosswalk => ({
  id,
  sourceSeriesAliases,
  season: options.season ?? null,
  format: options.format ?? 'unmarked',
  catalogueTitleSourceId,
  catalogueTitleName,
  allowedLanguages,
});

const heldCrosswalk = (
  id: string,
  sourceSeriesAliases: readonly string[],
  holdReason: string,
  options: { season?: number | null; format?: NozomiFormat } = {},
): NozomiSeriesCrosswalk => ({
  id,
  sourceSeriesAliases,
  season: options.season ?? null,
  format: options.format ?? 'unmarked',
  catalogueTitleSourceId: null,
  catalogueTitleName: null,
  allowedLanguages: [],
  holdReason,
});

/**
 * Human-reviewed equality assertions for the 2026-09-15 Nozomi inventory.
 * These are deliberately not a title matcher: every source label, season and
 * format must select one explicit catalogue title or an explicit HOLD rule.
 */
export const NOZOMI_SERIES_CROSSWALKS: readonly NozomiSeriesCrosswalk[] = [
  crosswalk('utena-tv', ['Revolutionary Girl Utena'], '1345', 'Revolutionary Girl Utena', ['sub', 'dub']),
  crosswalk('princess-nine-tv', ['Princess Nine'], '2595', 'Princess Nine', ['sub', 'dub']),
  crosswalk('super-gals-tv', ['Super Gals'], '2260', 'Super GALS!', ['sub', 'dub']),
  crosswalk('captain-tylor-tv', ['Irresponsible Captain Tylor', 'Irresponsbile Captain Tylor'], '937', 'The Irresponsible Captain Tylor', ['sub', 'dub'], { format: 'tv' }),
  crosswalk('space-pirate-mito-s1', ['Space Pirate Mito'], '3874', 'Space Pirate Mito', ['sub'], { season: 1 }),
  crosswalk('space-pirate-mito-s2', ['Space Pirate Mito'], '5205', 'Space Pirate Mito 2', ['sub'], { season: 2 }),
  crosswalk('nadesico-tv', ['Martian Successor Nadesico'], '631', 'Martian Successor Nadesico', ['sub', 'dub']),
  crosswalk('el-hazard-wanderers-tv', ['El-Hazard The Wanderers'], '3211', 'El-Hazard: The Wanderers', ['dub']),
  crosswalk('gakuen-alice-tv', ['Gakuen Alice'], '362', 'Gakuen Alice', ['sub']),
  crosswalk('lost-universe-tv', ['Lost Universe'], '3011', 'Lost Universe', ['dub']),
  crosswalk('magic-users-club-tv', ["Magic User's Club"], '3400', "Magic User's Club", ['sub', 'dub'], { season: 2, format: 'tv' }),
  crosswalk('please-twins-tv', ['Please Twins!'], '2837', 'Please Twins', ['sub', 'dub']),
  crosswalk('sengoku-collection-tv', ['Sengoku Collection'], '3839', 'Sengoku Collection', ['sub']),
  crosswalk('his-and-her-circumstances-tv', ['His and Her Circumstances'], '280', 'His and Her Circumstances', ['dub']),
  crosswalk('please-teacher-tv', ['Please Teacher'], '2429', 'Please Teacher!', ['sub', 'dub']),
  crosswalk('junjo-romantica-s1', ['Junjo Romantica'], '561', 'Junjo Romantica', ['sub'], { season: 1 }),
  crosswalk('junjo-romantica-s2', ['Junjo Romantica'], '965', 'Junjo Romantica 2', ['sub'], { season: 2 }),
  crosswalk('the-third-tv', ['The Third: The Girl With the Blue Eye'], '1859', 'The Third: Aoi Hitomi no Shoujo', ['dub']),
  crosswalk('rental-magica-tv', ['Rental Magica'], '1708', 'Rental Magica', ['sub']),
  crosswalk('emma-s1', ['Emma A Victorian Romance', 'Emma: A Victorian Romance'], '778', 'Emma: A Victorian Romance', ['sub'], { season: 1 }),
  crosswalk('emma-s2', ['Emma A Victorian Romance', 'Emma: A Victorian Romance'], '943', 'Emma: A Victorian Romance Season Two', ['sub'], { season: 2 }),
  heldCrosswalk('dirty-pair-flash-segmentation', ['Dirty Pair Flash'], 'catalogue-segmentation-mismatch'),
  crosswalk('aria-animation-s1', ['ARIA The ANIMATION'], '557', 'Aria the Animation', ['sub'], { season: 1 }),
  crosswalk('boogiepop-phantom-tv', ['Boogiepop Phantom'], '2540', 'Boogiepop Phantom', ['dub']),
  crosswalk('magic-users-club-ova', ["Magic User's Club"], '1677', "Magic User's Club (OVA)", ['sub', 'dub'], { season: 1, format: 'ova' }),
  crosswalk('ninja-nonsense-tv', ['Ninja Nonsense (2x2 Shinobuden)'], '3065', 'Ninja Nonsense', ['dub']),
  heldCrosswalk('sound-of-the-sky-language', ['Sound of the Sky (Sora no Woto)'], 'audio-subtitle-language-unmarked'),
  crosswalk('sweet-blue-flowers-tv', ['Sweet Blue Flowers'], '2495', 'Sweet Blue Flowers', ['sub']),
  crosswalk('dirty-pair-ova', ['Dirty Pair'], '2716', 'Dirty Pair OVA', ['sub'], { format: 'ova' }),
  crosswalk('captain-tylor-ova', ['Irresponsible Captain Tylor'], '1738', 'Irresponsible Captain Tylor OVA', ['sub'], { format: 'ova' }),
  heldCrosswalk('ad-police-different-production', ['AD Police To Protect and Serve'], 'catalogue-series-not-equal', { format: 'tv' }),
  crosswalk('campanella-tv', ['Blessing of the Campanella'], '4300', 'Blessing of the Campanella', ['sub']),
  crosswalk('dirty-pair-tv', ['Dirty Pair'], '2489', 'Dirty Pair', ['sub'], { format: 'tv' }),
  crosswalk('princess-knight-tv', ['Princess Knight'], '3783', 'Princess Knight', ['dub']),
  heldCrosswalk('astro-boy-production-language', ['Astro Boy'], 'ambiguous-production-and-language-unmarked'),
  crosswalk('el-hazard-magnificent-world-ova', ['El-Hazard The Magnificent World'], '1850', 'El Hazard: The Magnificent World', ['dub']),
  heldCrosswalk('gravitation-language', ['Gravitation'], 'audio-subtitle-language-unmarked', { format: 'tv' }),
  heldCrosswalk('sayonara-zetsubou-language', ['Sayonara, Zetsubou-sensei'], 'audio-subtitle-language-unmarked'),
] as const;

export interface ParsedNozomiEpisode {
  seriesLabel: string;
  normalizedSeries: string;
  season: number | null;
  format: NozomiFormat;
  episodeNumber: number;
  language: NozomiLanguage | null;
}

export interface NozomiOEmbedObservation {
  result: 'standard-embed-returned' | 'unavailable' | 'schema-mismatch';
  checkedAt: string;
  title: string | null;
  authorName: string | null;
  authorUrl: string | null;
  error?: string;
}

export interface NozomiReviewEntry {
  disposition: 'pass' | 'hold';
  videoId: string;
  videoTitle: string;
  watchUrl: string;
  embedUrl: string;
  channelId: string | null;
  channelLabel: string | null;
  crosswalkId: string | null;
  parsed: ParsedNozomiEpisode | null;
  identity: null | {
    titleId: number;
    titleSourceId: string;
    titleSlug: string;
    catalogueTitle: string;
    episodeId: number;
    episodeSourceId: string;
    episodeNumber: string;
    versionId: number;
    versionSourceId: string;
    language: NozomiLanguage;
  };
  probe: YouTubeVideoProbe | null;
  oEmbed: NozomiOEmbedObservation | null;
  reasonCodes: string[];
}

export function normalizeNozomiSeries(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function parseNozomiEpisodeTitle(title: string): ParsedNozomiEpisode | null {
  if (/\b(?:pack|compilation|marathon|recap|digest|complete season|full season)\b/i.test(title)
    || /\bepisodes?\s*\d+(?:\.\d+)?\s*(?:-|–|—|&|\+|to)\s*\d+(?:\.\d+)?\b/i.test(title)) return null;
  const match = title.match(/^(.*?)\s+(?:-\s+)?(?:HD\s+)?(?:Season\s+(\d+)\s+)?(?:(TV(?:\s+Series)?)|(OVA))?\s*Episode\s+(\d+(?:\.\d+)?)(?=\s|:|-|$)/i);
  if (!match) return null;
  const episodeNumber = Number(match[5]);
  if (!Number.isFinite(episodeNumber)) return null;
  const language = /\((?:English\s+)?Sub\)|\[(?:English\s+)?Sub\]/i.test(title)
    ? 'sub'
    : /\((?:English\s+)?Dub\)|\[(?:English\s+)?Dub\]/i.test(title)
      ? 'dub'
      : null;
  return {
    seriesLabel: match[1].trim().replace(/\s+-$/, '').trim(),
    normalizedSeries: normalizeNozomiSeries(match[1].trim().replace(/\s+-$/, '').trim()),
    season: match[2] ? Number(match[2]) : null,
    format: match[3] ? 'tv' : match[4] ? 'ova' : 'unmarked',
    episodeNumber,
    language,
  };
}

function matchingCrosswalks(parsed: ParsedNozomiEpisode): NozomiSeriesCrosswalk[] {
  return NOZOMI_SERIES_CROSSWALKS.filter((item) =>
    item.season === parsed.season
    && item.format === parsed.format
    && item.sourceSeriesAliases.some((alias) => normalizeNozomiSeries(alias) === parsed.normalizedSeries));
}

function exactEpisode(title: CatalogueTitleRecord, number: number) {
  const matches = title.episodes.filter((episode) => episode.numberSort === number || Number(episode.numberText) === number);
  return matches.length === 1 ? matches[0] : null;
}

export function reviewNozomiEpisode(input: {
  video: ListedYouTubeVideo;
  catalogue: readonly CatalogueTitleRecord[];
  probe?: YouTubeVideoProbe | null;
  oEmbed?: NozomiOEmbedObservation | null;
  runtimeRequired?: boolean;
}): NozomiReviewEntry {
  const { video, catalogue } = input;
  const probe = input.probe ?? null;
  const oEmbed = input.oEmbed ?? null;
  const reasons: string[] = [];
  const parsed = parseNozomiEpisodeTitle(video.title);
  if ((video.durationSeconds ?? 0) < 15 * 60) reasons.push('not-full-length-episode');
  if (!parsed) reasons.push('single-episode-identity-not-exact');
  if (video.channelId !== NOZOMI_CHANNEL_ID) reasons.push('inventory-publisher-channel-mismatch');
  const crosswalks = parsed ? matchingCrosswalks(parsed) : [];
  if (parsed && crosswalks.length !== 1) reasons.push(crosswalks.length ? 'series-crosswalk-ambiguous' : 'series-crosswalk-missing');
  const selected = crosswalks.length === 1 ? crosswalks[0] : null;
  if (selected?.holdReason) reasons.push(selected.holdReason);
  if (parsed && !parsed.language) reasons.push('audio-subtitle-language-unmarked');
  if (selected && parsed?.language && !selected.allowedLanguages.includes(parsed.language)) reasons.push('crosswalk-language-mismatch');

  const titleMatches = selected?.catalogueTitleSourceId
    ? catalogue.filter((title) => title.sourceId === selected.catalogueTitleSourceId)
    : [];
  if (selected?.catalogueTitleSourceId && titleMatches.length !== 1) reasons.push('catalogue-title-crosswalk-stale');
  const title = titleMatches.length === 1 ? titleMatches[0] : null;
  if (title && selected?.catalogueTitleName !== title.name) reasons.push('catalogue-title-name-changed');
  const episode = title && parsed ? exactEpisode(title, parsed.episodeNumber) : null;
  if (title && !episode) reasons.push('catalogue-episode-not-unique');
  const versions = episode && parsed?.language
    ? episode.versions.filter((version) => version.language === parsed.language)
    : [];
  if (episode && parsed?.language && versions.length !== 1) reasons.push('catalogue-language-version-not-unique');
  const version = versions.length === 1 ? versions[0] : null;
  const identity = title && episode && version && parsed?.language ? {
    titleId: title.id,
    titleSourceId: title.sourceId,
    titleSlug: title.slug,
    catalogueTitle: title.name,
    episodeId: episode.id,
    episodeSourceId: episode.sourceId,
    episodeNumber: episode.numberText,
    versionId: version.id,
    versionSourceId: version.sourceId,
    language: parsed.language,
  } : null;

  if (input.runtimeRequired !== false) {
    if (!probe) reasons.push('current-player-probe-missing');
    else {
      if (probe.videoId !== video.videoId) reasons.push('player-video-identity-mismatch');
      if (probe.channelId !== NOZOMI_CHANNEL_ID) reasons.push('player-publisher-channel-mismatch');
      if (probe.availability === 'region-blocked') reasons.push('region-blocked');
      else if (probe.availability === 'embed-disabled' || probe.playableInEmbed === false) reasons.push('embed-disabled');
      else if (probe.availability === 'login-required') reasons.push('login-required');
      else if (probe.availability !== 'playable') reasons.push('video-unavailable');
    }
    if (!oEmbed) reasons.push('current-oembed-check-missing');
    else {
      if (oEmbed.result !== 'standard-embed-returned') reasons.push('oembed-unavailable');
      if (oEmbed.authorName !== NOZOMI_PUBLISHER_LABEL) reasons.push('oembed-publisher-mismatch');
    }
  }
  const reasonCodes = [...new Set(reasons)].sort();
  return {
    disposition: reasonCodes.length ? 'hold' : 'pass',
    videoId: video.videoId,
    videoTitle: video.title,
    watchUrl: `https://www.youtube.com/watch?v=${video.videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${video.videoId}`,
    channelId: video.channelId,
    channelLabel: video.channelLabel,
    crosswalkId: selected?.id ?? null,
    parsed,
    identity,
    probe,
    oEmbed,
    reasonCodes,
  };
}
