/**
 * Explore: personalized swipe-to-discover.
 *
 * Contracts shared by the browser, the Node/SQLite API and the Workers/D1 API,
 * plus the deterministic, explainable content-based ranking engine. Nothing in
 * this module performs I/O. Every number that influences ranking lives in
 * EXPLORE_CONFIG and is versioned through EXPLORE_RANKING_VERSION.
 */
import type { MalStatus } from './myanimelist.ts';

export const EXPLORE_RANKING_VERSION = 'explore-rank-1';

export const EXPLORE_CONFIG = {
  version: EXPLORE_RANKING_VERSION,
  deckSizes: [10, 20, 30] as const,
  defaultDeckSize: 20,
  /** "See recommendations now" unlocks after this many resolved (non-undone) cards. */
  earlyResultsAfter: 5,
  /** Cards presented ahead of the current one: the card under the finger plus the visible preview. */
  lookahead: 2,
  /** Long-term ranked queue kept per session; session intent re-ranks inside it. */
  queueSize: 160,
  resultsSize: 10,
  /** Share of deck slots reserved for deliberate wildcards. A starting point, not a measured optimum. */
  explorationShare: 0.15,
  /** Maximal-marginal-relevance trade-off between fit and similarity to already chosen titles. */
  diversityLambda: 0.45,
  /** Pseudo-count added to every feature's evidence weight: sparse evidence stays near neutral. */
  shrinkage: 3,
  sessionShrinkage: 1.5,
  /** Signal-group weights. Missing groups are dropped and the rest rescaled. */
  weights: { personal: 1, session: 1.25, explicit: 0.6, quality: 0.15 },
  /** Per-feature-kind influence inside an affinity score. */
  kinds: { g: 1, t: 0.35, l: 0.35, a: 0.15, s: 0.1 } as Record<string, number>,
  /** Evidence values (−1…1) for Explore feedback. Pass is deliberately modest. */
  feedback: { interested: 1, pass: -0.35, seenLiked: 0.8, seenDisliked: -0.6, more: 0.6, less: -0.5 },
  /** Ledger decisions newer than this are not shown again as fresh cards. */
  recentResolvedDays: 30,
  ledgerMax: 500,
  ledgerRetentionDays: 365,
  /** An unfinished session can be resumed for this long. */
  sessionRetentionDays: 30,
  /** A MAL import older than this is labelled stale. */
  malStaleDays: 30,
} as const;

export type ExploreDeckSize = (typeof EXPLORE_CONFIG.deckSizes)[number];
export type ExploreAction = 'interested' | 'pass' | 'skip' | 'seen';
export type ExploreMode = 'new' | 'revisit';
export type ExploreLength = 'any' | 'short' | 'standard' | 'long';
export type ExploreAudio = 'any' | 'sub' | 'dub';
export type ExploreAvailability = 'available' | 'all';
export type ExploreMood = 'light' | 'thrill' | 'heart' | 'mind' | 'epic' | 'dark';

/** A mood is a declared, visible mapping onto genres the catalogue actually records. */
export const EXPLORE_MOODS: Record<ExploreMood, { label: string; genres: string[] }> = {
  light: { label: 'Light and funny', genres: ['Comedy', 'Slice of Life'] },
  thrill: { label: 'Action and thrills', genres: ['Action', 'Thriller', 'Suspense', 'Martial Arts'] },
  heart: { label: 'Romance and feelings', genres: ['Romance', 'Drama'] },
  mind: { label: 'Mind-bending', genres: ['Mystery', 'Psychological', 'Sci-Fi'] },
  epic: { label: 'Big adventure', genres: ['Adventure', 'Fantasy', 'Isekai'] },
  dark: { label: 'Dark and eerie', genres: ['Horror', 'Supernatural', 'Thriller'] },
};
export const EXPLORE_MOOD_KEYS = Object.keys(EXPLORE_MOODS) as ExploreMood[];

export const EXPLORE_LENGTH_LABELS: Record<Exclude<ExploreLength, 'any'>, string> = {
  short: 'Short (film or up to 13 episodes)',
  standard: 'Standard (14–30 episodes)',
  long: 'Long (over 30 episodes)',
};

export interface ExploreFilters {
  mood: ExploreMood | null;
  /** Soft preference: boosts titles with these genres. */
  genres: string[];
  /** Hard constraint: titles with any of these genres are never shown. */
  excludeGenres: string[];
  length: ExploreLength;
  audio: ExploreAudio;
  availability: ExploreAvailability;
  mode: ExploreMode;
  /** Allow titles the person dropped on MyAnimeList back into a new-title deck. */
  includeDropped: boolean;
  /** Keep MyAnimeList plan-to-watch and My List titles eligible. */
  includePlanned: boolean;
}

/** Only these are saved for future sessions, and only when the person asks. Mood never is. */
export type ExploreSavedPreferences = Pick<ExploreFilters, 'genres' | 'excludeGenres' | 'length' | 'audio'>;

export const DEFAULT_EXPLORE_FILTERS: ExploreFilters = {
  mood: null, genres: [], excludeGenres: [], length: 'any', audio: 'any',
  availability: 'available', mode: 'new', includeDropped: false, includePlanned: true,
};

/** Catalogue facts used for ranking. Every field is optional evidence except identity. */
export interface ExploreTitleFeature {
  id: string;
  name: string;
  /** Normalized genre slugs (see genreKey). */
  genres: string[];
  type: string | null;
  status: string | null;
  episodeCount: number;
  /** Version languages actually listed for episodes, e.g. "sub" or "dub". */
  languages: string[];
  /** Exact MyAnimeList ID from a reviewed catalogue match; null when unknown. */
  malId: number | null;
  /** Public MyAnimeList series mean. Absent from the current catalogue; used only when sourced. */
  publicMean?: number | null;
  publicMembers?: number | null;
}

/** Display data stored with a presented card so resuming never re-reads the catalogue. */
export interface ExploreCardData {
  titleId: string;
  slug: string;
  name: string;
  artworkUrl: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  synopsis: string | null;
  type: string | null;
  status: string | null;
  releaseYear: number | null;
  episodeCount: number;
  genres: string[];
  languages: string[];
  publicMean: number | null;
}

export type ExploreReasonKind =
  | 'mal-score' | 'mal-completed' | 'mal-plan' | 'session-interest' | 'seen-liked' | 'history' | 'watchlist'
  | 'explore-history' | 'chosen-genre' | 'mood' | 'length' | 'learned-length' | 'audio' | 'quality'
  | 'wildcard' | 'starter' | 'revisit' | 'more-like';
export interface ExploreReason { kind: ExploreReasonKind; text: string }

export type ExploreCardKind = 'match' | 'wildcard' | 'starter' | 'revisit';
export interface ExploreCard extends ExploreCardData {
  index: number;
  kind: ExploreCardKind;
  reasons: ExploreReason[];
}

export interface ExploreDecision {
  action: ExploreAction;
  /** Only for "seen": explicit optional feedback. null means not answered. */
  liked: boolean | null;
  eventId: string;
  at: number;
}

export type ExploreMalState = 'connected' | 'partial' | 'stale' | 'syncing' | 'none' | 'unavailable';
export interface ExploreSignalSummary {
  mal: ExploreMalState;
  malUsername: string | null;
  malImportedAt: number | null;
  /** Imported entries joined to a catalogue title by exact MAL ID. */
  malMatched: number;
  /** Imported entries with no reviewed catalogue match. Kept out of ranking, never name-matched. */
  malUnmatched: number;
  malScored: number;
  history: number;
  watchlist: number;
  explore: number;
  /** True only when personal or explicit signals actually shaped the ranking. */
  personalized: boolean;
}

export interface ExploreRecommendation extends ExploreCardData {
  kind: 'match' | 'wildcard' | 'starter' | 'quality' | 'revisit';
  reasons: ExploreReason[];
  refinement: 'more' | 'less' | null;
}

export interface ExploreResults {
  computedAt: number;
  rankingVersion: string;
  picks: ExploreCard[];
  recommended: ExploreRecommendation[];
  /** How the recommended list was produced, stated plainly in the UI. */
  basis: 'personal' | 'session' | 'explicit' | 'fallback';
  /** Fewer than resultsSize titles passed the hard filters. */
  shortfall: boolean;
}

/** Public, client-visible session. Internal ranking state is never sent. */
export interface ExploreSessionView {
  id: string;
  status: 'active' | 'complete';
  rankingVersion: string;
  seed: string;
  createdAt: number;
  updatedAt: number;
  requested: number;
  budget: number;
  eligible: number;
  filters: ExploreFilters;
  signals: ExploreSignalSummary;
  cards: ExploreCard[];
  decisions: (ExploreDecision | null)[];
  resolved: number;
  canUndo: boolean;
  results: ExploreResults | null;
  revision: number;
}

export interface ExploreStatus {
  signals: ExploreSignalSummary;
  saved: ExploreSavedPreferences | null;
  session: ExploreSessionView | null;
  genres: Array<{ value: string; label: string }>;
  retention: { ledgerMax: number; ledgerRetentionDays: number; sessionRetentionDays: number };
}

/* ───────────────────────────── Normalization ───────────────────────────── */

export function genreKey(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

export function lengthBucket(feature: Pick<ExploreTitleFeature, 'type' | 'episodeCount'>): Exclude<ExploreLength, 'any'> | null {
  if (feature.type === 'movie') return 'short';
  if (!feature.episodeCount) return null;
  if (feature.episodeCount <= 13) return 'short';
  if (feature.episodeCount <= 30) return 'standard';
  return 'long';
}

const SEQUEL = /(\bseason\s*(?:[2-9]|\d{2})\b|\b(?:2nd|3rd|[4-9]th)\s+season\b|\bfinal\s+season\b|\bpart\s*(?:[2-9]|ii|iii|iv)\b|\bcour\s*[2-9]\b|\b(?:ii|iii|iv|v|vi)$|\s[2-9]$|\b(?:movie|film)\s*(?:[2-9]|\d{2,})\b|\bside[\s-]stor(?:y|ies)\b|\bsequel\b)/i;
const SIDE_STORY = /\b(recap|specials?|picture drama|omake|chibi|mini|ova|oad|ona specials?|the movie|movie\s*\d*|film|shorts?)\b/i;

/** Conservative franchise key from the name. Used only for de-duplication, never as a claimed relationship. */
export function franchiseKey(name: string): string {
  let value = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  value = value.split(/\s*[:：]\s*|\s+-\s+|\s+–\s+/)[0];
  value = value.replace(/\((?:tv|\d{4})\)/g, ' ')
    .replace(/\b(?:season\s*\d+|\d+(?:st|nd|rd|th)\s+season|final\s+season|part\s*\d+|cour\s*\d+)\b/g, ' ')
    .replace(/\b(?:movie|film)\s*\d+\b/g, ' ')
    .replace(/\b(?:the\s+)?movie\b|\bova\b|\boad\b|\bspecials?\b|\brecap\b/g, ' ')
    .replace(/\b(?:ii|iii|iv|v|vi)$/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    .replace(/\s[2-9]$/, '').trim();
  return value || name.toLowerCase().trim();
}

export function isSequelLike(feature: Pick<ExploreTitleFeature, 'name' | 'type'>): boolean {
  return SEQUEL.test(feature.name) || feature.type === 'special' || feature.type === 'music' ||
    ((feature.type === 'ova' || feature.type === 'ona') && SIDE_STORY.test(feature.name));
}

/**
 * Pick one fresh entry point per franchise group: never a sequel, special or side story
 * when the group contains a better first title. Titles alone in their group pass unless
 * they are themselves sequel-marked (we cannot verify their prerequisites).
 */
export function entryPoints(features: readonly ExploreTitleFeature[]): Map<string, ExploreTitleFeature> {
  const groups = new Map<string, ExploreTitleFeature[]>();
  for (const feature of features) {
    const key = franchiseKey(feature.name);
    const group = groups.get(key) ?? [];
    group.push(feature);
    groups.set(key, group);
  }
  const typeRank = (type: string | null) => type === 'tv' ? 0 : type === 'ona' ? 1 : type === 'movie' ? 2 : type === 'ova' ? 3 : 4;
  const result = new Map<string, ExploreTitleFeature>();
  for (const [key, group] of groups) {
    const fresh = group.filter(item => !isSequelLike(item));
    if (!fresh.length) continue;
    fresh.sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.name.length - b.name.length || Number(a.id) - Number(b.id));
    result.set(key, fresh[0]);
  }
  return result;
}

/* ───────────────────────────── Seeded randomness ───────────────────────────── */

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
export function seededRandom(seed: string): () => number {
  let state = hashString(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Stable per-title jitter so equal scores never depend on catalogue order. */
const jitter = (seed: string, id: string) => (hashString(seed + ':' + id) / 4294967296 - 0.5) * 0.02;

/* ───────────────────────────── Evidence and taste ───────────────────────────── */

export type ExploreEvidenceSource = 'mal' | 'explore' | 'session' | 'history' | 'watchlist';
export interface ExploreEvidence {
  titleId: string;
  name: string;
  source: ExploreEvidenceSource;
  /** −1 (disliked) … 1 (loved). 0 is neutral. */
  value: number;
  /** 0 … 1: how strongly this evidence should count. */
  weight: number;
  malScore?: number;
  malStatus?: MalStatus;
  signal?: string;
}

const SOURCE_RANK: Record<ExploreEvidenceSource, number> = { session: 5, mal: 4, explore: 3, history: 2, watchlist: 1 };

/**
 * One piece of evidence per title. An explicit MAL score outranks status-only MAL rows;
 * a title appearing in MAL, history and My List counts once.
 */
export function dedupeEvidence(items: readonly ExploreEvidence[]): ExploreEvidence[] {
  const byTitle = new Map<string, ExploreEvidence>();
  const strength = (item: ExploreEvidence) => SOURCE_RANK[item.source] + (item.malScore ? 2 : 0) + item.weight;
  for (const item of items) {
    const current = byTitle.get(item.titleId);
    if (!current || strength(item) > strength(current)) byTitle.set(item.titleId, item);
  }
  return [...byTitle.values()];
}

/** MAL contract: score 0 means "not scored". Status alone is weak, and dropped/on-hold prove nothing about why. */
export function malEvidence(entry: { titleId: string; name: string; score: number; status: MalStatus }, center: number): ExploreEvidence | null {
  if (entry.score >= 1 && entry.score <= 10) {
    const value = Math.max(-1, Math.min(1, (entry.score - center) / 3));
    return { titleId: entry.titleId, name: entry.name, source: 'mal', value: Math.max(-1, Math.min(1, value + 0.1)), weight: 1, malScore: entry.score, malStatus: entry.status };
  }
  if (entry.status === 'completed') return { titleId: entry.titleId, name: entry.name, source: 'mal', value: 0.3, weight: 0.5, malStatus: entry.status };
  if (entry.status === 'watching') return { titleId: entry.titleId, name: entry.name, source: 'mal', value: 0.25, weight: 0.4, malStatus: entry.status };
  if (entry.status === 'plan_to_watch') return { titleId: entry.titleId, name: entry.name, source: 'mal', value: 0.15, weight: 0.25, malStatus: entry.status };
  return null; // dropped / on hold without a score: neutral for taste.
}

/** A person who rates everything 8+ is centered on their own mean once there is enough evidence. */
export function malScoreCenter(scores: readonly number[]): number {
  const rated = scores.filter(score => score >= 1 && score <= 10);
  if (rated.length < 5) return 6.5;
  return rated.reduce((sum, score) => sum + score, 0) / rated.length;
}

export function featureKeys(feature: ExploreTitleFeature): string[] {
  const keys = feature.genres.map(genre => 'g:' + genre);
  if (feature.type) keys.push('t:' + feature.type);
  const length = lengthBucket(feature);
  if (length) keys.push('l:' + length);
  if (feature.languages.includes('dub')) keys.push('a:dub');
  if (feature.status) keys.push('s:' + feature.status);
  return keys;
}

export interface TasteEvidenceRef {
  titleId: string;
  name: string;
  source: ExploreEvidenceSource;
  value: number;
  malScore?: number;
  malStatus?: MalStatus;
  signal?: string;
}
export interface TasteModel {
  prefs: Record<string, number>;
  support: Record<string, number>;
  /** Up to three strongest positive evidence titles per feature, used to explain reasons truthfully. */
  best: Record<string, TasteEvidenceRef[]>;
  count: number;
  weight: number;
}
export const EMPTY_TASTE: TasteModel = { prefs: {}, support: {}, best: {}, count: 0, weight: 0 };

export function buildTaste(evidence: readonly ExploreEvidence[], features: ReadonlyMap<string, ExploreTitleFeature>, shrinkage: number = EXPLORE_CONFIG.shrinkage): TasteModel {
  const numerator: Record<string, number> = {}, denominator: Record<string, number> = {};
  const best: Record<string, TasteEvidenceRef[]> = {};
  let count = 0, weight = 0;
  for (const item of evidence) {
    const feature = features.get(item.titleId);
    if (!feature || item.weight <= 0) continue;
    count++; weight += item.weight;
    for (const key of featureKeys(feature)) {
      numerator[key] = (numerator[key] ?? 0) + item.value * item.weight;
      denominator[key] = (denominator[key] ?? 0) + item.weight;
      if (item.value > 0 && item.name) {
        const ref: TasteEvidenceRef = { titleId: item.titleId, name: item.name, source: item.source, value: item.value * item.weight,
          ...(item.malScore ? { malScore: item.malScore } : {}), ...(item.malStatus ? { malStatus: item.malStatus } : {}),
          ...(item.signal ? { signal: item.signal } : {}) };
        best[key] = [...(best[key] ?? []), ref].sort((a, b) => b.value - a.value || a.titleId.localeCompare(b.titleId)).slice(0, 3);
      }
    }
  }
  const prefs: Record<string, number> = {};
  for (const key of Object.keys(numerator)) prefs[key] = numerator[key] / (denominator[key] + shrinkage);
  return { prefs, support: denominator, best, count, weight };
}

/** Bounded, serializable model: keeps the strongest features only. */
export function compactTaste(model: TasteModel, limit = 80): TasteModel {
  const keys = Object.keys(model.prefs).sort((a, b) => Math.abs(model.prefs[b]) - Math.abs(model.prefs[a]) || a.localeCompare(b)).slice(0, limit);
  const pick = <T>(source: Record<string, T>) => Object.fromEntries(keys.filter(key => key in source).map(key => [key, source[key]]));
  return { prefs: pick(model.prefs), support: pick(model.support), best: pick(model.best), count: model.count, weight: model.weight };
}

interface Contribution { key: string; value: number }
export function affinity(model: TasteModel, feature: ExploreTitleFeature): { score: number; contributions: Contribution[] } {
  if (!model.count) return { score: 0, contributions: [] };
  const contributions: Contribution[] = [];
  let genreSum = 0;
  for (const genre of feature.genres) {
    const value = model.prefs['g:' + genre] ?? 0;
    genreSum += value;
    if (value) contributions.push({ key: 'g:' + genre, value: value / Math.sqrt(feature.genres.length) });
  }
  let total = feature.genres.length ? genreSum / Math.sqrt(feature.genres.length) * EXPLORE_CONFIG.kinds.g : 0;
  for (const key of featureKeys(feature).filter(key => !key.startsWith('g:'))) {
    const value = (model.prefs[key] ?? 0) * (EXPLORE_CONFIG.kinds[key[0]] ?? 0);
    if (value) { total += value; contributions.push({ key, value }); }
  }
  contributions.sort((a, b) => b.value - a.value);
  return { score: Math.tanh(total * 1.5), contributions };
}

export function explicitGenres(filters: ExploreFilters, saved: ExploreSavedPreferences | null): Set<string> {
  const keys = new Set([...filters.genres, ...(saved?.genres ?? [])].map(genreKey));
  if (filters.mood) for (const genre of EXPLORE_MOODS[filters.mood].genres) keys.add(genreKey(genre));
  return keys;
}

function explicitScore(feature: ExploreTitleFeature, wanted: ReadonlySet<string>): number {
  if (!wanted.size) return 0;
  const overlap = feature.genres.filter(genre => wanted.has(genre)).length;
  return overlap === 0 ? -0.2 : overlap === 1 ? 0.7 : 1;
}

function qualityScore(feature: ExploreTitleFeature): number | null {
  if (typeof feature.publicMean !== 'number' || !Number.isFinite(feature.publicMean) || feature.publicMean <= 0) return null;
  const mean = Math.max(-1, Math.min(1, (feature.publicMean - 7) / 1.5));
  const members = typeof feature.publicMembers === 'number' && feature.publicMembers > 0 ? Math.min(1, Math.log10(feature.publicMembers) / 6) : 0;
  return Math.max(-1, Math.min(1, mean * 0.85 + members * 0.15));
}

export interface ScoreInputs {
  longTerm: TasteModel;
  session: TasteModel;
  wanted: ReadonlySet<string>;
  seed: string;
}
export interface ScoredTitle {
  feature: ExploreTitleFeature;
  score: number;
  personal: ReturnType<typeof affinity>;
  sessionFit: ReturnType<typeof affinity>;
  explicit: number;
  quality: number | null;
  /** Signal groups that actually contributed. */
  groups: Array<'personal' | 'session' | 'explicit' | 'quality'>;
}

/** Weighted mean over the signal groups that exist for this person and title. */
export function scoreTitle(feature: ExploreTitleFeature, inputs: ScoreInputs): ScoredTitle {
  const personal = affinity(inputs.longTerm, feature);
  const sessionFit = affinity(inputs.session, feature);
  const explicit = explicitScore(feature, inputs.wanted);
  const quality = qualityScore(feature);
  const parts: Array<[ScoredTitle['groups'][number], number, number]> = [];
  if (inputs.longTerm.count) parts.push(['personal', EXPLORE_CONFIG.weights.personal, personal.score]);
  if (inputs.session.count) parts.push(['session', EXPLORE_CONFIG.weights.session, sessionFit.score]);
  if (inputs.wanted.size) parts.push(['explicit', EXPLORE_CONFIG.weights.explicit, explicit]);
  if (quality !== null) parts.push(['quality', EXPLORE_CONFIG.weights.quality, quality]);
  const weight = parts.reduce((sum, [, w]) => sum + w, 0);
  const base = weight ? parts.reduce((sum, [, w, value]) => sum + w * value, 0) / weight : 0;
  return { feature, score: base + jitter(inputs.seed, feature.id), personal, sessionFit, explicit, quality, groups: parts.map(([name]) => name) };
}

function similarity(a: ExploreTitleFeature, b: ExploreTitleFeature): number {
  if (franchiseKey(a.name) === franchiseKey(b.name)) return 1;
  const left = new Set(a.genres);
  const shared = b.genres.filter(genre => left.has(genre)).length;
  const union = new Set([...a.genres, ...b.genres]).size;
  return (union ? shared / union : 0) * 0.85 + (a.type && a.type === b.type ? 0.15 : 0);
}

/** Greedy maximal-marginal-relevance selection with at most one title per franchise. */
export function diversify(items: readonly ScoredTitle[], count: number, existing: readonly ExploreTitleFeature[] = [], lambda: number = EXPLORE_CONFIG.diversityLambda): ScoredTitle[] {
  const pool = [...items].sort((a, b) => b.score - a.score || a.feature.id.localeCompare(b.feature.id)).slice(0, Math.max(count * 12, 60));
  const chosen: ScoredTitle[] = [];
  const franchises = new Set(existing.map(item => franchiseKey(item.name)));
  const context = [...existing];
  while (chosen.length < count && pool.length) {
    let bestIndex = -1, bestValue = -Infinity;
    for (let index = 0; index < pool.length; index++) {
      const candidate = pool[index];
      if (franchises.has(franchiseKey(candidate.feature.name))) continue;
      const penalty = context.reduce((max, other) => Math.max(max, similarity(candidate.feature, other)), 0);
      const value = candidate.score - lambda * penalty;
      if (value > bestValue) { bestValue = value; bestIndex = index; }
    }
    if (bestIndex < 0) break;
    const [picked] = pool.splice(bestIndex, 1);
    chosen.push(picked);
    franchises.add(franchiseKey(picked.feature.name));
    context.push(picked.feature);
  }
  return chosen;
}

/* ───────────────────────────── Eligibility ───────────────────────────── */

export interface ExplorePersonalState {
  /** Catalogue title IDs with MAL status, joined by exact MAL ID. */
  malStatus: ReadonlyMap<string, MalStatus>;
  /** Titles with any Solanime watch history. */
  history: ReadonlySet<string>;
  /** Titles with unfinished Solanime history (a real resume point exists). */
  inProgress: ReadonlySet<string>;
  watchlist: ReadonlySet<string>;
  /** Explore "Already seen" titles: excluded from new discovery. */
  seen: ReadonlySet<string>;
  /** Explore decisions within recentResolvedDays: not re-shown as fresh cards. */
  recentlyResolved: ReadonlySet<string>;
  /** Explore "Less like this" titles. */
  rejected: ReadonlySet<string>;
}

export interface EligibilityResult {
  eligible: ExploreTitleFeature[];
  counts: { catalogue: number; afterHardFilters: number; entryPoints: number };
}

/** Hard constraints only. Nothing here is ever relaxed to fill a deck. */
export function eligibleTitles(features: readonly ExploreTitleFeature[], filters: ExploreFilters, saved: ExploreSavedPreferences | null, personal: ExplorePersonalState): EligibilityResult {
  const excluded = new Set([...filters.excludeGenres, ...(saved?.excludeGenres ?? [])].map(genreKey));
  const passes = (feature: ExploreTitleFeature) => {
    if (feature.genres.some(genre => excluded.has(genre))) return false;
    if (filters.length !== 'any' && lengthBucket(feature) !== filters.length) return false;
    if (filters.audio !== 'any' && !feature.languages.includes(filters.audio)) return false;
    if (filters.availability === 'available' && (feature.episodeCount < 1 || feature.languages.length === 0)) return false;
    if (personal.rejected.has(feature.id)) return false;
    return true;
  };
  if (filters.mode === 'revisit') {
    const revisit = features.filter(feature => {
      const status = personal.malStatus.get(feature.id);
      return (personal.inProgress.has(feature.id) || status === 'watching' || status === 'on_hold' || (filters.includeDropped && status === 'dropped')) && passes(feature);
    });
    return { eligible: revisit, counts: { catalogue: features.length, afterHardFilters: revisit.length, entryPoints: revisit.length } };
  }
  const fresh = features.filter(feature => {
    if (!passes(feature)) return false;
    const status = personal.malStatus.get(feature.id);
    if (status === 'completed' || status === 'watching' || status === 'on_hold') return false;
    if (status === 'dropped' && !filters.includeDropped) return false;
    if (status === 'plan_to_watch' && !filters.includePlanned) return false;
    if (!filters.includePlanned && personal.watchlist.has(feature.id)) return false;
    if (personal.history.has(feature.id) || personal.seen.has(feature.id) || personal.recentlyResolved.has(feature.id)) return false;
    return true;
  });
  // Entry points are chosen across the whole catalogue so a franchise whose first season
  // was already watched does not resurface through its sequel.
  const points = entryPoints(features);
  const entryIds = new Set([...points.values()].map(item => item.id));
  const known = new Set<string>();
  for (const feature of features) {
    const status = personal.malStatus.get(feature.id);
    if (personal.history.has(feature.id) || personal.seen.has(feature.id) || status === 'completed' || status === 'watching' || status === 'on_hold' || (status === 'dropped' && !filters.includeDropped))
      known.add(franchiseKey(feature.name));
  }
  const eligible = fresh.filter(feature => entryIds.has(feature.id) && !known.has(franchiseKey(feature.name)));
  return { eligible, counts: { catalogue: features.length, afterHardFilters: fresh.length, entryPoints: eligible.length } };
}

/* ───────────────────────────── Reasons ───────────────────────────── */

const genreLabel = (labels: ReadonlyMap<string, string>, key: string) => labels.get(key) ?? key.replace(/-/g, ' ');

function evidencePhrase(ref: TasteEvidenceRef): { kind: ExploreReasonKind; text: string } {
  if (ref.source === 'mal' && ref.malScore) return { kind: 'mal-score', text: `${ref.name}, which you rated ${ref.malScore}/10 on MyAnimeList` };
  if (ref.source === 'mal' && ref.malStatus === 'completed') return { kind: 'mal-completed', text: `${ref.name}, which you completed on MyAnimeList` };
  if (ref.source === 'mal') return { kind: 'mal-plan', text: `${ref.name} from your MyAnimeList list` };
  if (ref.source === 'session') return { kind: 'session-interest', text: `${ref.name}, which you marked Interested` };
  if (ref.source === 'explore' && ref.signal === 'seen-liked') return { kind: 'seen-liked', text: `${ref.name}, which you said you liked` };
  if (ref.source === 'explore' && ref.signal === 'more') return { kind: 'more-like', text: `${ref.name}, which you asked for more like` };
  if (ref.source === 'explore') return { kind: 'explore-history', text: `${ref.name}, which you were interested in before` };
  if (ref.source === 'history') return { kind: 'history', text: `${ref.name} from your watch history` };
  return { kind: 'watchlist', text: `${ref.name} on your list` };
}

export function reasonsFor(scored: ScoredTitle, inputs: ScoreInputs, filters: ExploreFilters, labels: ReadonlyMap<string, string>, listed: 'mal' | 'list' | null = null, features?: ReadonlyMap<string, ExploreTitleFeature>, used?: Map<string, number>): ExploreReason[] {
  const reasons: ExploreReason[] = [];
  const feature = scored.feature;
  // Pick the evidence title that genuinely shares the most genres with this candidate,
  // so reasons name different titles instead of repeating the single strongest one.
  let chosen: { ref: TasteEvidenceRef; shared: string[]; value: number } | null = null;
  for (const [model, fit] of [[inputs.session, scored.sessionFit], [inputs.longTerm, scored.personal]] as const) {
    for (const contribution of fit.contributions) {
      if (!contribution.key.startsWith('g:') || contribution.value <= 0.005) continue;
      for (const ref of model.best[contribution.key] ?? []) {
        if (ref.titleId === feature.id) continue;
        const theirs = features?.get(ref.titleId)?.genres;
        const shared = theirs ? feature.genres.filter(genre => theirs.includes(genre) && (model.prefs['g:' + genre] ?? 0) > 0.005) : [contribution.key.slice(2)];
        if (!shared.length) continue;
        // Spread explanations across evidence titles when several fit equally well.
        const value = shared.length + ref.value * 0.5 + (model === inputs.session ? 0.25 : 0) - (used?.get(ref.titleId) ?? 0) * 0.6;
        if (!chosen || value > chosen.value) chosen = { ref, shared, value };
      }
    }
  }
  if (chosen) {
    used?.set(chosen.ref.titleId, (used.get(chosen.ref.titleId) ?? 0) + 1);
    const phrase = evidencePhrase(chosen.ref);
    reasons.push({ kind: phrase.kind, text: `Shares ${chosen.shared.slice(0, 2).map(key => genreLabel(labels, key)).join(' and ')} with ${phrase.text}` });
  }
  if (inputs.wanted.size && scored.explicit > 0) {
    const mood = filters.mood ? EXPLORE_MOODS[filters.mood] : null;
    const moodKeys = new Set((mood?.genres ?? []).map(genreKey));
    const moodHit = feature.genres.filter(genre => moodKeys.has(genre));
    if (mood && moodHit.length) reasons.push({ kind: 'mood', text: `Fits your ${mood.label.toLowerCase()} mood (${moodHit.slice(0, 2).map(key => genreLabel(labels, key)).join(', ')})` });
    else {
      const hit = feature.genres.find(genre => inputs.wanted.has(genre));
      if (hit) reasons.push({ kind: 'chosen-genre', text: `Includes ${genreLabel(labels, hit)}, a genre you chose` });
    }
  }
  const length = lengthBucket(feature);
  if (filters.length !== 'any' && length === filters.length) {
    reasons.push({ kind: 'length', text: feature.type === 'movie' ? 'A film, matching the short length you chose' : `${feature.episodeCount} episodes, matching the ${filters.length} length you chose` });
  } else if (length && (inputs.longTerm.prefs['l:' + length] ?? 0) > 0.15 && (inputs.longTerm.support['l:' + length] ?? 0) >= 3) {
    reasons.push({ kind: 'learned-length', text: `${length[0].toUpperCase()}${length.slice(1)} series, like many titles you rated well` });
  }
  if (filters.audio === 'dub') reasons.push({ kind: 'audio', text: 'A dub version is listed, as you asked' });
  if (listed === 'mal') reasons.unshift({ kind: 'mal-plan', text: 'On your MyAnimeList plan-to-watch list' });
  if (listed === 'list') reasons.unshift({ kind: 'watchlist', text: 'Already on My List' });
  if (scored.quality !== null && typeof feature.publicMean === 'number')
    reasons.push({ kind: 'quality', text: `MyAnimeList series score ${feature.publicMean.toFixed(2)}` });
  return reasons.slice(0, 2);
}

/* ───────────────────────────── Deck planning ───────────────────────────── */

/** Deck positions reserved for wildcards: never the first two cards, spread over the deck. */
export function wildcardSlots(budget: number, seed: string, share: number = EXPLORE_CONFIG.explorationShare): number[] {
  const count = Math.round(budget * share);
  if (count < 1 || budget < 5) return [];
  const random = seededRandom(seed + ':slots');
  const slots: number[] = [];
  const span = (budget - 2) / count;
  for (let index = 0; index < count; index++) {
    const start = 2 + Math.floor(index * span), end = Math.max(start, 2 + Math.floor((index + 1) * span) - 1);
    slots.push(Math.min(budget - 1, start + Math.floor(random() * (end - start + 1))));
  }
  return [...new Set(slots)];
}

/** Wildcards: decent titles whose genres sit outside the person's strongest preferences. */
export function wildcardPool(eligible: readonly ExploreTitleFeature[], model: TasteModel, seed: string, size = 24): string[] {
  const top = Object.entries(model.prefs).filter(([key, value]) => key.startsWith('g:') && value > 0.05)
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key]) => key.slice(2));
  const topSet = new Set(top);
  const random = seededRandom(seed + ':wild');
  const pool = eligible.filter(feature => feature.genres.length > 0 && !feature.genres.some(genre => topSet.has(genre)) && affinity(model, feature).score > -0.15);
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return pool.slice(0, size).map(feature => feature.id);
}

/** Evidence derived from a session's own decisions. Skip is neutral; Pass is modest. */
export function sessionEvidence(cards: readonly Pick<ExploreCard, 'titleId' | 'name'>[], decisions: readonly (ExploreDecision | null)[]): ExploreEvidence[] {
  const evidence: ExploreEvidence[] = [];
  cards.forEach((card, index) => {
    const decision = decisions[index];
    if (!decision) return;
    const f = EXPLORE_CONFIG.feedback;
    const value = decision.action === 'interested' ? f.interested : decision.action === 'pass' ? f.pass
      : decision.action === 'seen' && decision.liked === true ? f.seenLiked : decision.action === 'seen' && decision.liked === false ? f.seenDisliked : 0;
    if (value) evidence.push({ titleId: card.titleId, name: card.name, source: 'session', value, weight: 1,
      signal: decision.action === 'seen' ? (decision.liked ? 'seen-liked' : 'seen-disliked') : decision.action });
  });
  return evidence;
}

export function resolvedCount(decisions: readonly (ExploreDecision | null)[]): number {
  return decisions.filter(Boolean).length;
}
