import { AppError } from '../errors.ts';
import { object } from '../accounts/validation.ts';
import type { AccountDatabase } from '../cloud/auth/types.ts';
import { MAL_STATUSES, type MalEntry, type MalStatus } from '../../shared/myanimelist.ts';
import {
  DEFAULT_EXPLORE_FILTERS, EMPTY_TASTE, EXPLORE_CONFIG, EXPLORE_MOOD_KEYS, EXPLORE_RANKING_VERSION,
  buildTaste, compactTaste, dedupeEvidence, diversify, eligibleTitles, explicitGenres, franchiseKey, genreKey,
  malEvidence, malScoreCenter, reasonsFor, resolvedCount, scoreTitle, seededRandom, sessionEvidence, wildcardPool,
  wildcardSlots,
  type ExploreAction, type ExploreCard, type ExploreCardData, type ExploreDecision, type ExploreEvidence,
  type ExploreFilters, type ExploreMalState, type ExplorePersonalState, type ExploreReason, type ExploreRecommendation,
  type ExploreResults, type ExploreSavedPreferences, type ExploreSessionView, type ExploreSignalSummary,
  type ExploreStatus, type ExploreTitleFeature, type ScoreInputs, type TasteModel,
} from '../../shared/explore.ts';
import type { ExploreCatalogue, ExploreFeatureIndex } from './catalogue.ts';

/**
 * Explore persistence uses the existing private profile_data store, so ownership, export,
 * profile deletion and account deletion already cover it. These keys are written only by
 * this service; the generic profile data endpoint rejects them.
 */
export const EXPLORE_SESSION_KEY = 'explore:session';
export const EXPLORE_TASTE_KEY = 'explore:taste';
const DAY = 86_400_000;
const MAX_EVENTS = 160;
const MAX_STORED_BYTES = 160 * 1024;

type LedgerSignal = 'interested' | 'pass' | 'seen' | 'seen-liked' | 'seen-disliked' | 'more' | 'less';
interface LedgerEntry { signal: LedgerSignal; name: string; at: number; sessionId: string }
interface TasteStore {
  version: 1;
  saved: ExploreSavedPreferences | null;
  ledger: Record<string, LedgerEntry>;
  updatedAt: number;
}
interface StoredSession extends Omit<ExploreSessionView, 'resolved' | 'canUndo' | 'revision'> {
  version: 1;
  queue: string[];
  wildcards: string[];
  wildcardSlots: number[];
  undo: number[];
  events: string[];
  taste: TasteModel;
  /** MAL committed generation the long-term taste was built from ("none" when absent). */
  tasteSource: string;
  refinements: Record<string, 'more' | 'less'>;
  resultsKey: string | null;
  /** Queue titles on the person's MAL plan-to-watch list or My List (for an honest reason line). */
  planned: string[];
  listed: string[];
}
type Stored<T> = { value: T | null; revision: number };

const emptyTaste = (): TasteStore => ({ version: 1, saved: null, ledger: {}, updatedAt: 0 });
const conflict = () => new AppError(409, 'BAD_REQUEST', 'Explore changed in another tab. Reload Explore to continue.', { reason: 'EXPLORE_CONFLICT' });
const invalid = (message: string) => new AppError(400, 'BAD_REQUEST', message);

/* ───────────────────────────── Input validation ───────────────────────────── */

function stringList(value: unknown, max: number, known: ReadonlySet<string>): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || item.length > 60)) throw invalid('Choose fewer genres.');
  const keys = [...new Set(value.map(item => genreKey(item)))];
  if (keys.some(key => !known.has(key))) throw invalid('One of the chosen genres is not in the catalogue.');
  return keys;
}
export function validateFilters(value: unknown, genres: ReadonlySet<string>): ExploreFilters {
  if (value === undefined || value === null) return { ...DEFAULT_EXPLORE_FILTERS };
  if (!object(value)) throw invalid('Explore filters must be an object.');
  const pick = <T extends string>(field: unknown, options: readonly T[], fallback: T): T => {
    if (field === undefined || field === null) return fallback;
    if (typeof field !== 'string' || !options.includes(field as T)) throw invalid('An Explore filter has an unsupported value.');
    return field as T;
  };
  const filters: ExploreFilters = {
    mood: value.mood === null || value.mood === undefined ? null : pick(value.mood, EXPLORE_MOOD_KEYS, 'light'),
    genres: stringList(value.genres, 8, genres),
    excludeGenres: stringList(value.excludeGenres, 12, genres),
    length: pick(value.length, ['any', 'short', 'standard', 'long'] as const, 'any'),
    audio: pick(value.audio, ['any', 'sub', 'dub'] as const, 'any'),
    availability: pick(value.availability, ['available', 'all'] as const, 'available'),
    mode: pick(value.mode, ['new', 'revisit'] as const, 'new'),
    includeDropped: value.includeDropped === true,
    includePlanned: value.includePlanned !== false,
  };
  if (filters.genres.some(genre => filters.excludeGenres.includes(genre))) throw invalid('A genre cannot be both preferred and excluded.');
  return filters;
}
function validateSaved(value: unknown, genres: ReadonlySet<string>): ExploreSavedPreferences | null {
  if (value === null) return null;
  const filters = validateFilters(value, genres);
  return { genres: filters.genres, excludeGenres: filters.excludeGenres, length: filters.length, audio: filters.audio };
}
const eventId = (value: unknown) => {
  if (typeof value !== 'string' || !/^[\w-]{8,64}$/.test(value)) throw invalid('Each Explore action needs a request identifier.');
  return value;
};
const sessionId = (value: unknown) => {
  if (typeof value !== 'string' || !/^[\w-]{8,64}$/.test(value)) throw invalid('Invalid Explore session.');
  return value;
};

/* ───────────────────────────── Service ───────────────────────────── */

export interface ExploreServiceOptions {
  now?: () => number;
  randomId?: () => string;
}

/** Both transports authorize session, CSRF, rate limit and profile ownership before calling this. */
export function exploreService(db: AccountDatabase, catalogue: ExploreCatalogue | undefined, options: ExploreServiceOptions = {}) {
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const requireCatalogue = () => {
    if (!catalogue) throw new AppError(503, 'UNAVAILABLE', 'Explore is not available on this deployment.');
    return catalogue;
  };

  async function read<T>(profile: string, key: string): Promise<Stored<T>> {
    const row = await db.prepare('SELECT value,revision FROM profile_data WHERE profile_id=? AND key=?').bind(profile, key).first<{ value: string; revision: number }>();
    if (!row) return { value: null, revision: 0 };
    try { return { value: JSON.parse(row.value) as T, revision: Number(row.revision) }; }
    catch { return { value: null, revision: Number(row.revision) }; }
  }
  /** Compare-and-swap on the stored revision: a concurrent tab can never be overwritten. */
  async function write(profile: string, key: string, value: unknown, revision: number): Promise<number> {
    const body = JSON.stringify(value);
    if (new TextEncoder().encode(body).length > MAX_STORED_BYTES) throw new AppError(413, 'BAD_REQUEST', 'Explore data reached its size limit. Reset Explore preferences to continue.');
    try {
      const result = revision === 0
        ? await db.prepare('INSERT INTO profile_data(profile_id,key,value,revision,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(profile_id,key) DO NOTHING').bind(profile, key, body, now()).run()
        : await db.prepare('UPDATE profile_data SET value=?,revision=revision+1,updated_at=? WHERE profile_id=? AND key=? AND revision=?').bind(body, now(), profile, key, revision).run();
      if (result.meta.changes !== 1) throw conflict();
      return revision + 1;
    } catch (error) {
      if (error instanceof Error && error.message.includes('PROFILE_DATA_LIMIT'))
        throw new AppError(413, 'BAD_REQUEST', 'This profile has reached its saved-data limit. Remove old saved items before trying again.');
      throw error;
    }
  }
  /** Retries the whole read-modify-write on a lost race; every mutation below is idempotent. */
  async function retrying<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await operation(); }
      catch (error) {
        if (attempt >= 3 || !(error instanceof AppError) || (error.details as { reason?: string } | undefined)?.reason !== 'EXPLORE_CONFLICT') throw error;
      }
    }
  }

  /* ── Personal signals: read-only. Explore never writes to MAL, history or My List. ── */

  async function personalData(profile: string, index: ExploreFeatureIndex) {
    let mal: { state: ExploreMalState; username: string | null; importedAt: number | null; generation: string | null; entries: MalEntry[] } =
      { state: 'none', username: null, importedAt: null, generation: null, entries: [] };
    try {
      const connection = await db.prepare('SELECT username,credential_cipher IS NOT NULL AS connected,committed_generation,imported_at,sync_generation FROM mal_connections WHERE profile_id=?')
        .bind(profile).first<{ username: string | null; connected: number; committed_generation: string | null; imported_at: number | null; sync_generation: string | null }>();
      if (connection?.connected) {
        const entries = connection.committed_generation
          ? (await db.prepare('SELECT value FROM mal_list_items WHERE profile_id=? AND generation=? LIMIT 20000').bind(profile, connection.committed_generation).all<{ value: string }>())
            .results.flatMap(row => { try { return [JSON.parse(row.value) as MalEntry]; } catch { return []; } })
          : [];
        const state: ExploreMalState = !connection.committed_generation ? (connection.sync_generation ? 'syncing' : 'connected')
          : connection.sync_generation ? 'partial'
            : connection.imported_at && now() - connection.imported_at > EXPLORE_CONFIG.malStaleDays * DAY ? 'stale' : 'connected';
        mal = { state, username: connection.username, importedAt: connection.imported_at, generation: connection.committed_generation, entries };
      }
    } catch { mal = { ...mal, state: 'unavailable' }; }
    const rows = (await db.prepare("SELECT key,value FROM profile_data WHERE profile_id=? AND key IN ('history','watchlist-records')").bind(profile).all<{ key: string; value: string }>()).results;
    const parsed = (key: string) => { try { const row = rows.find(item => item.key === key); return row ? JSON.parse(row.value) as Record<string, unknown>[] : []; } catch { return []; } };
    const history = parsed('history').filter(item => typeof item.titleId === 'string' && index.byId.has(item.titleId));
    const watchlist = parsed('watchlist-records').filter(item => typeof item.id === 'string' && index.byId.has(item.id));
    const malStatus = new Map<string, MalStatus>();
    const malJoined: Array<{ titleId: string; entry: MalEntry }> = [];
    for (const entry of mal.entries) {
      if (!Number.isSafeInteger(entry.id) || !MAL_STATUSES.includes(entry.status)) continue;
      const titleId = index.byMalId.get(entry.id);
      if (!titleId) continue; // Never matched by name: unmatched rows stay out of ranking.
      malStatus.set(titleId, entry.status);
      malJoined.push({ titleId, entry });
    }
    return { mal, malStatus, malJoined, history, watchlist };
  }
  type Personal = Awaited<ReturnType<typeof personalData>>;

  const plannedIn = (personal: Personal, ids: readonly string[]) => ids.filter(id => personal.malStatus.get(id) === 'plan_to_watch');

  function longTermEvidence(personal: Personal, taste: TasteStore, excludeSession?: string): ExploreEvidence[] {
    const evidence: ExploreEvidence[] = [];
    const center = malScoreCenter(personal.malJoined.map(item => item.entry.score));
    for (const { titleId, entry } of personal.malJoined) {
      const item = malEvidence({ titleId, name: entry.title, score: entry.score, status: entry.status }, center);
      if (item) evidence.push(item);
    }
    for (const item of personal.history) evidence.push({ titleId: String(item.titleId), name: String(item.title ?? ''), source: 'history', value: 0.25, weight: 0.35 });
    for (const item of personal.watchlist) evidence.push({ titleId: String(item.id), name: String(item.name ?? ''), source: 'watchlist', value: 0.15, weight: 0.25 });
    const f = EXPLORE_CONFIG.feedback;
    const values: Partial<Record<LedgerSignal, [number, number]>> = {
      interested: [f.interested * 0.6, 0.6], pass: [f.pass, 0.5], 'seen-liked': [f.seenLiked, 0.8], 'seen-disliked': [f.seenDisliked, 0.8], more: [f.more, 0.7], less: [f.less, 0.7],
    };
    for (const [titleId, entry] of Object.entries(taste.ledger)) {
      if (excludeSession && entry.sessionId === excludeSession) continue;
      const value = values[entry.signal];
      if (value) evidence.push({ titleId, name: entry.name, source: 'explore', value: value[0], weight: value[1], signal: entry.signal });
    }
    return dedupeEvidence(evidence);
  }

  function personalState(personal: Personal, taste: TasteStore): ExplorePersonalState {
    const recentCutoff = now() - EXPLORE_CONFIG.recentResolvedDays * DAY;
    const ledger = Object.entries(taste.ledger);
    return {
      malStatus: personal.malStatus,
      history: new Set(personal.history.map(item => String(item.titleId))),
      inProgress: new Set(personal.history.filter(item => item.continueHidden !== true).map(item => String(item.titleId))),
      watchlist: new Set(personal.watchlist.map(item => String(item.id))),
      seen: new Set(ledger.filter(([, entry]) => entry.signal.startsWith('seen')).map(([id]) => id)),
      recentlyResolved: new Set(ledger.filter(([, entry]) => entry.at >= recentCutoff && ['interested', 'pass'].includes(entry.signal)).map(([id]) => id)),
      rejected: new Set(ledger.filter(([, entry]) => entry.signal === 'less').map(([id]) => id)),
    };
  }

  function signalSummary(personal: Personal, taste: TasteStore, longTerm: TasteModel, filters: ExploreFilters | null, saved: ExploreSavedPreferences | null): ExploreSignalSummary {
    const wanted = filters ? explicitGenres(filters, saved) : new Set(saved?.genres ?? []);
    return {
      mal: personal.mal.state, malUsername: personal.mal.username, malImportedAt: personal.mal.importedAt,
      malMatched: personal.malJoined.length, malUnmatched: personal.mal.entries.length - personal.malJoined.length,
      malScored: personal.malJoined.filter(item => item.entry.score > 0).length,
      history: personal.history.length, watchlist: personal.watchlist.length,
      explore: Object.keys(taste.ledger).length,
      personalized: longTerm.count > 0 || wanted.size > 0,
    };
  }

  /* ── Ledger: durable Explore feedback, bounded and retained for a fixed period. ── */

  function mergeSession(taste: TasteStore, session: StoredSession | null): TasteStore {
    const ledger: Record<string, LedgerEntry> = {};
    for (const [id, entry] of Object.entries(taste.ledger)) if (!session || entry.sessionId !== session.id) ledger[id] = entry;
    if (session) {
      session.cards.forEach((card, index) => {
        const decision = session.decisions[index];
        if (!decision || decision.action === 'skip') return;
        const signal: LedgerSignal = decision.action === 'seen' ? (decision.liked === true ? 'seen-liked' : decision.liked === false ? 'seen-disliked' : 'seen') : decision.action;
        ledger[card.titleId] = { signal, name: card.name, at: decision.at, sessionId: session.id };
      });
      for (const [titleId, kind] of Object.entries(session.refinements)) {
        const name = session.results?.recommended.find(item => item.titleId === titleId)?.name ?? ledger[titleId]?.name ?? '';
        ledger[titleId] = { signal: kind, name, at: session.updatedAt, sessionId: session.id };
      }
    }
    const cutoff = now() - EXPLORE_CONFIG.ledgerRetentionDays * DAY;
    const kept = Object.entries(ledger).filter(([, entry]) => entry.at >= cutoff).sort((a, b) => b[1].at - a[1].at).slice(0, EXPLORE_CONFIG.ledgerMax);
    return { ...taste, ledger: Object.fromEntries(kept), updatedAt: now() };
  }

  /* ── Deck ── */

  function inputs(session: StoredSession, index: ExploreFeatureIndex): ScoreInputs {
    return {
      longTerm: session.taste,
      session: buildTaste(sessionEvidence(session.cards, session.decisions), index.byId, EXPLORE_CONFIG.sessionShrinkage),
      wanted: explicitGenres(session.filters, null),
      seed: session.seed,
    };
  }
  const plainReason = (kind: ExploreReason['kind'], text: string): ExploreReason[] => [{ kind, text }];

  /** Appends cards up to the lookahead. Presented cards are immutable and never re-ordered. */
  async function present(session: StoredSession, index: ExploreFeatureIndex) {
    const malPlanned = new Set(session.planned), onList = new Set(session.listed ?? []);
    const reasonUse = new Map<string, number>();
    const target = () => Math.min(session.budget, resolvedCount(session.decisions) + EXPLORE_CONFIG.lookahead);
    while (session.cards.length < target()) {
      const position = session.cards.length;
      const presented = new Set(session.cards.map(card => card.titleId));
      const franchises = new Set(session.cards.map(card => franchiseKey(index.byId.get(card.titleId)?.name ?? card.name)));
      const usable = (id: string) => !presented.has(id) && index.byId.has(id) && !franchises.has(franchiseKey(index.byId.get(id)!.name));
      const context = session.cards.map(card => index.byId.get(card.titleId)).filter((item): item is ExploreTitleFeature => !!item);
      const scoring = inputs(session, index);
      let pick: { feature: ExploreTitleFeature; kind: ExploreCard['kind']; reasons: ExploreReason[] } | null = null;
      if (session.wildcardSlots.includes(position)) {
        const id = session.wildcards.find(usable);
        if (id) pick = { feature: index.byId.get(id)!, kind: 'wildcard', reasons: plainReason('wildcard', 'A wildcard outside your usual genres') };
      }
      if (!pick) {
        const scored = session.queue.filter(usable).map(id => scoreTitle(index.byId.get(id)!, scoring));
        const [best] = diversify(scored, 1, context);
        if (best) {
          const personalized = session.signals.personalized || scoring.session.count > 0;
          const kind: ExploreCard['kind'] = session.filters.mode === 'revisit' ? 'revisit' : personalized ? 'match' : 'starter';
          const reasons = kind === 'revisit' ? plainReason('revisit', 'You started this and can pick it up again')
            : kind === 'starter' ? plainReason('starter', 'Part of a varied starter mix. Explore has no taste signals for this profile yet.')
              : reasonsFor(best, scoring, session.filters, index.genreLabels, malPlanned.has(best.feature.id) ? 'mal' : onList.has(best.feature.id) ? 'list' : null, index.byId, reasonUse);
          pick = { feature: best.feature, kind, reasons: reasons.length ? reasons : plainReason('starter', 'A varied pick while Explore learns what you like') };
        }
      }
      if (!pick) { session.budget = session.cards.length; break; }
      const data = (await requireCatalogue().cards([pick.feature.id])).get(pick.feature.id);
      if (!data) { session.queue = session.queue.filter(id => id !== pick!.feature.id); session.wildcards = session.wildcards.filter(id => id !== pick!.feature.id); continue; }
      session.cards.push({ ...data, index: position, kind: pick.kind, reasons: pick.reasons });
      session.decisions.push(null);
    }
  }

  function view(session: StoredSession | null, revision: number): ExploreSessionView | null {
    if (!session) return null;
    const { queue: _q, wildcards: _w, wildcardSlots: _s, undo, events: _e, taste: _t, tasteSource: _ts, refinements: _r, resultsKey: _k, version: _v, planned: _p, listed: _l, ...visible } = session;
    return { ...visible, resolved: resolvedCount(session.decisions), canUndo: undo.length > 0, revision };
  }

  const expired = (session: StoredSession | null) => !session || session.version !== 1 || session.rankingVersion !== EXPLORE_RANKING_VERSION ||
    now() - session.updatedAt > EXPLORE_CONFIG.sessionRetentionDays * DAY;

  async function loadSession(profile: string, id?: string) {
    const stored = await read<StoredSession>(profile, EXPLORE_SESSION_KEY);
    const session = expired(stored.value) ? null : stored.value;
    if (id !== undefined && session?.id !== id) throw new AppError(409, 'BAD_REQUEST', 'This Explore round ended or was replaced in another tab. Start a new round.', { reason: 'EXPLORE_SESSION_REPLACED' });
    return { session, revision: stored.revision };
  }

  /** Rebuild long-term taste when the MAL import it came from changed or was removed. */
  async function refreshTaste(profile: string, session: StoredSession, index: ExploreFeatureIndex) {
    const connection = await db.prepare('SELECT committed_generation FROM mal_connections WHERE profile_id=? AND credential_cipher IS NOT NULL').bind(profile).first<{ committed_generation: string | null }>().catch(() => null);
    const source = connection?.committed_generation ?? 'none';
    if (source === session.tasteSource) return null;
    const personal = await personalData(profile, index);
    const taste = (await read<TasteStore>(profile, EXPLORE_TASTE_KEY)).value ?? emptyTaste();
    session.taste = compactTaste(buildTaste(longTermEvidence(personal, taste, session.id), index.byId));
    session.tasteSource = personal.mal.generation ?? 'none';
    session.planned = plannedIn(personal, session.queue);
  }

  async function start(profile: string, input: Record<string, unknown>) {
    const index = await requireCatalogue().features();
    const genres = new Set(index.genreLabels.keys());
    const size = input.size === undefined ? EXPLORE_CONFIG.defaultDeckSize : Number(input.size);
    if (!EXPLORE_CONFIG.deckSizes.includes(size as 10)) throw invalid('Choose 10, 20 or 30 cards.');
    const filters = validateFilters(input.filters, genres);
    const save = input.savePreferences === true;
    const personalBase = await personalData(profile, index);
    return retrying(async () => {
      const previous = await loadSession(profile);
      const tasteStored = await read<TasteStore>(profile, EXPLORE_TASTE_KEY);
      let taste = mergeSession(tasteStored.value ?? emptyTaste(), previous.session);
      if (save) taste = { ...taste, saved: { genres: filters.genres, excludeGenres: filters.excludeGenres, length: filters.length, audio: filters.audio } };
      const saved = taste.saved;
      const longTerm = compactTaste(buildTaste(longTermEvidence(personalBase, taste), index.byId));
      const wanted = explicitGenres(filters, saved);
      const seed = randomId().replace(/-/g, '').slice(0, 16);
      const { eligible } = eligibleTitles(index.items, filters, saved, personalState(personalBase, taste));
      const scoring: ScoreInputs = { longTerm, session: EMPTY_TASTE, wanted, seed };
      const personalized = longTerm.count > 0 || wanted.size > 0;
      let queue: string[];
      if (personalized || filters.mode === 'revisit') {
        queue = eligible.map(feature => scoreTitle(feature, scoring)).sort((a, b) => b.score - a.score || a.feature.id.localeCompare(b.feature.id))
          .slice(0, EXPLORE_CONFIG.queueSize).map(item => item.feature.id);
      } else {
        // Nothing to personalize from: a seeded, genre-diverse introductory deck.
        const random = seededRandom(seed + ':starter');
        const shuffled = [...eligible];
        for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
        queue = diversify(shuffled.slice(0, 600).map(feature => scoreTitle(feature, scoring)), EXPLORE_CONFIG.queueSize, [], 0.9).map(item => item.feature.id);
      }
      const budget = Math.min(size, eligible.length);
      const wild = personalized && filters.mode === 'new' ? wildcardPool(eligible.filter(feature => !queue.slice(0, budget).includes(feature.id)), longTerm, seed) : [];
      const session: StoredSession = {
        version: 1, id: randomId(), status: 'active', rankingVersion: EXPLORE_RANKING_VERSION, seed,
        createdAt: now(), updatedAt: now(), requested: size, budget, eligible: eligible.length, filters,
        signals: signalSummary(personalBase, taste, longTerm, filters, saved),
        cards: [], decisions: [], results: null,
        queue, wildcards: wild, wildcardSlots: wild.length ? wildcardSlots(budget, seed) : [], undo: [], events: [],
        taste: longTerm, tasteSource: personalBase.mal.generation ?? 'none', refinements: {}, resultsKey: null,
        planned: plannedIn(personalBase, queue),
        listed: queue.filter(id => personalBase.watchlist.some(item => String(item.id) === id)),
      };
      session.filters = { ...filters, genres: [...new Set([...filters.genres, ...(saved?.genres ?? [])])], excludeGenres: [...new Set([...filters.excludeGenres, ...(saved?.excludeGenres ?? [])])] };
      await present(session, index);
      if (session.cards.length === 0) session.status = 'complete';
      await write(profile, EXPLORE_TASTE_KEY, taste, tasteStored.revision);
      const revision = await write(profile, EXPLORE_SESSION_KEY, session, previous.revision);
      return { session: view(session, revision) };
    });
  }

  async function feedback(profile: string, input: Record<string, unknown>) {
    const id = sessionId(input.sessionId), event = eventId(input.eventId);
    const action = input.action as ExploreAction;
    if (!['interested', 'pass', 'skip', 'seen'].includes(action)) throw invalid('Unsupported Explore action.');
    const position = Number(input.index);
    if (!Number.isSafeInteger(position) || position < 0 || position >= 30) throw invalid('Invalid card position.');
    if (input.liked !== undefined && input.liked !== null && typeof input.liked !== 'boolean') throw invalid('Invalid feedback.');
    const liked = action === 'seen' && typeof input.liked === 'boolean' ? input.liked : null;
    const index = await requireCatalogue().features();
    return retrying(async () => {
      const { session, revision } = await loadSession(profile, id);
      if (!session) throw new AppError(404, 'NOT_FOUND', 'Start a new Explore round.');
      if (session.events.includes(event)) return { session: view(session, revision), applied: true };
      const card = session.cards[position];
      if (!card || (typeof input.titleId === 'string' && input.titleId !== card.titleId)) throw new AppError(409, 'BAD_REQUEST', 'That card is not part of this round. Reload Explore.', { reason: 'EXPLORE_CARD_MISMATCH' });
      const existing = session.decisions[position];
      if (existing) {
        // A rating answer for "Already seen" may follow the decision; anything else is a duplicate from another tab.
        if (!(existing.action === 'seen' && action === 'seen' && liked !== existing.liked)) return { session: view(session, revision), applied: false };
        session.decisions[position] = { ...existing, liked };
      } else {
        session.decisions[position] = { action, liked, eventId: event, at: now() } satisfies ExploreDecision;
        session.undo = [...session.undo, position].slice(-30);
      }
      session.events = [...session.events, event].slice(-MAX_EVENTS);
      session.updatedAt = now();
      session.results = null; session.resultsKey = null;
      await refreshTaste(profile, session, index);
      await present(session, index);
      session.status = resolvedCount(session.decisions) >= session.budget ? 'complete' : 'active';
      const next = await write(profile, EXPLORE_SESSION_KEY, session, revision);
      return { session: view(session, next), applied: true };
    });
  }

  async function undo(profile: string, input: Record<string, unknown>) {
    const id = sessionId(input.sessionId), event = eventId(input.eventId);
    return retrying(async () => {
      const { session, revision } = await loadSession(profile, id);
      if (!session) throw new AppError(404, 'NOT_FOUND', 'Start a new Explore round.');
      if (session.events.includes(event)) return { session: view(session, revision), applied: true };
      const position = session.undo.at(-1);
      if (position === undefined) return { session: view(session, revision), applied: false };
      session.undo = session.undo.slice(0, -1);
      session.decisions[position] = null;
      session.events = [...session.events, event].slice(-MAX_EVENTS);
      session.status = 'active'; session.updatedAt = now(); session.results = null; session.resultsKey = null;
      const next = await write(profile, EXPLORE_SESSION_KEY, session, revision);
      return { session: view(session, next), applied: true, undone: position };
    });
  }

  async function results(profile: string, input: Record<string, unknown>) {
    const id = sessionId(input.sessionId);
    const index = await requireCatalogue().features();
    return retrying(async () => {
      const { session, revision } = await loadSession(profile, id);
      if (!session) throw new AppError(404, 'NOT_FOUND', 'Start a new Explore round.');
      if (input.refine !== undefined) {
        if (!object(input.refine) || typeof input.refine.titleId !== 'string' || !/^[1-9]\d{0,15}$/.test(input.refine.titleId) || !['more', 'less', null].includes(input.refine.kind as string))
          throw invalid('Invalid refinement.');
        const titleId = input.refine.titleId;
        if (!session.results?.recommended.some(item => item.titleId === titleId) && !(titleId in session.refinements)) throw invalid('Refine a title from this round’s recommendations.');
        if (input.refine.kind === null) delete session.refinements[titleId];
        else session.refinements[titleId] = input.refine.kind as 'more' | 'less';
      }
      const key = JSON.stringify([session.decisions.map(item => item ? [item.action, item.liked] : 0), session.refinements, session.rankingVersion]);
      if (session.results && session.resultsKey === key) return { session: view(session, revision) };
      const personal = await personalData(profile, index);
      const tasteStored = await read<TasteStore>(profile, EXPLORE_TASTE_KEY);
      const taste = mergeSession(tasteStored.value ?? emptyTaste(), session);
      const longTerm = buildTaste(longTermEvidence(personal, taste, session.id), index.byId);
      const refinementEvidence: ExploreEvidence[] = Object.entries(session.refinements).filter(([, kind]) => kind === 'more').map(([titleId]) => ({
        titleId, name: session.results?.recommended.find(item => item.titleId === titleId)?.name ?? taste.ledger[titleId]?.name ?? '',
        source: 'explore', value: EXPLORE_CONFIG.feedback.more, weight: 1, signal: 'more',
      }));
      const sessionModel = buildTaste([...sessionEvidence(session.cards, session.decisions), ...refinementEvidence], index.byId, EXPLORE_CONFIG.sessionShrinkage);
      const wanted = explicitGenres(session.filters, null);
      const scoring: ScoreInputs = { longTerm, session: sessionModel, wanted, seed: session.seed };
      const state = personalState(personal, taste);
      const { eligible } = eligibleTitles(index.items, session.filters, null, state);
      const presented = new Set(session.cards.map(card => card.titleId));
      const lessLike = new Set(Object.entries(session.refinements).filter(([, kind]) => kind === 'less').map(([titleId]) => titleId));
      const keepRefined = Object.keys(session.refinements).filter(titleId => !lessLike.has(titleId) && index.byId.has(titleId));
      const candidates = eligible.filter(feature => !presented.has(feature.id) && !lessLike.has(feature.id) && !keepRefined.includes(feature.id));
      const scored = candidates.map(feature => scoreTitle(feature, scoring));
      const existing = session.cards.map(card => index.byId.get(card.titleId)).filter((item): item is ExploreTitleFeature => !!item);
      const signalled = longTerm.count > 0 || sessionModel.count > 0;
      const positive = sessionModel.count > 0 && Object.values(sessionModel.prefs).some(value => value > 0);
      const basis: ExploreResults['basis'] = longTerm.count > 0 ? 'personal' : sessionModel.count > 0 ? 'session' : wanted.size ? 'explicit' : 'fallback';
      // Saved "more like this" titles stay at the top; a refinement never silently disappears.
      const kept = keepRefined.map(titleId => scoreTitle(index.byId.get(titleId)!, scoring));
      const slots = EXPLORE_CONFIG.resultsSize - kept.length;
      const wildcardCount = signalled && slots >= 6 ? 1 : 0;
      const ranked = diversify(scored, slots - wildcardCount, [...existing, ...kept.map(item => item.feature)]);
      const used = new Set([...ranked, ...kept].map(item => franchiseKey(item.feature.name)));
      const wildIds = wildcardCount ? wildcardPool(candidates.filter(feature => !used.has(franchiseKey(feature.name)) && !existing.some(item => franchiseKey(item.name) === franchiseKey(feature.name))), longTerm.count ? longTerm : sessionModel, session.seed + ':results', 1) : [];
      const planned = new Set([...personal.malStatus].filter(([, status]) => status === 'plan_to_watch').map(([titleId]) => titleId));
      const onList = new Set(personal.watchlist.map(item => String(item.id)));
      const reasonUse = new Map<string, number>();
      const chosen: Array<{ scored: ReturnType<typeof scoreTitle>; kind: ExploreRecommendation['kind'] }> = [
        ...kept.map(item => ({ scored: item, kind: 'match' as const })),
        ...ranked.map(item => ({ scored: item, kind: (signalled || wanted.size ? 'match' : 'starter') as ExploreRecommendation['kind'] })),
        ...wildIds.map(titleId => ({ scored: scoreTitle(index.byId.get(titleId)!, scoring), kind: 'wildcard' as const })),
        // "Less like this" titles stay listed as hidden so the choice can be undone.
        ...[...lessLike].filter(titleId => index.byId.has(titleId)).map(titleId => ({ scored: scoreTitle(index.byId.get(titleId)!, scoring), kind: 'match' as const })),
      ];
      const data = await requireCatalogue().cards(chosen.map(item => item.scored.feature.id));
      const recommended: ExploreRecommendation[] = [];
      for (const { scored: item, kind } of chosen) {
        const card = data.get(item.feature.id);
        if (!card) continue;
        let reasons: ExploreReason[] = lessLike.has(item.feature.id) ? plainReason('starter', 'Hidden because you asked for less like this')
          : kind === 'wildcard' ? plainReason('wildcard', 'A wildcard outside your usual genres')
          : kind === 'starter' ? plainReason('starter', 'A varied pick. Explore has no taste signals for this profile yet, so add some preferences or swipe a round.')
            : reasonsFor(item, scoring, session.filters, index.genreLabels, planned.has(item.feature.id) ? 'mal' : onList.has(item.feature.id) ? 'list' : null, index.byId, reasonUse);
        if (!reasons.length) reasons = signalled && !positive
          ? plainReason('starter', 'Steers away from the genres you passed on this round')
          : plainReason('starter', 'A varied pick that fits your filters');
        recommended.push({ ...card, kind, reasons, refinement: session.refinements[item.feature.id] ?? null });
      }
      session.results = {
        computedAt: now(), rankingVersion: EXPLORE_RANKING_VERSION,
        picks: session.cards.filter((card, position) => session.decisions[position]?.action === 'interested'),
        recommended, basis, shortfall: recommended.filter(item => item.refinement !== 'less').length < EXPLORE_CONFIG.resultsSize,
      };
      session.resultsKey = key;
      session.signals = signalSummary(personal, taste, longTerm, session.filters, null);
      session.updatedAt = now();
      await write(profile, EXPLORE_TASTE_KEY, taste, tasteStored.revision);
      const next = await write(profile, EXPLORE_SESSION_KEY, session, revision);
      return { session: view(session, next) };
    });
  }

  async function status(profile: string): Promise<ExploreStatus> {
    const index = await requireCatalogue().features();
    const personal = await personalData(profile, index);
    const taste = (await read<TasteStore>(profile, EXPLORE_TASTE_KEY)).value ?? emptyTaste();
    const { session, revision } = await loadSession(profile);
    const longTerm = buildTaste(longTermEvidence(personal, taste), index.byId);
    return {
      signals: signalSummary(personal, taste, longTerm, null, taste.saved),
      saved: taste.saved, session: view(session, revision),
      genres: [...index.genreLabels].filter(([key]) => index.items.some(item => item.genres.includes(key)))
        .map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
      retention: { ledgerMax: EXPLORE_CONFIG.ledgerMax, ledgerRetentionDays: EXPLORE_CONFIG.ledgerRetentionDays, sessionRetentionDays: EXPLORE_CONFIG.sessionRetentionDays },
    };
  }

  return async (profile: string, action: string, input: Record<string, unknown>, assertActive: () => Promise<void>) => {
    if (action === 'status') return status(profile);
    await assertActive();
    if (action === 'start') return start(profile, input);
    if (action === 'feedback') return feedback(profile, input);
    if (action === 'undo') return undo(profile, input);
    if (action === 'results') return results(profile, input);
    if (action === 'preferences') {
      const index = await requireCatalogue().features();
      const saved = validateSaved(input.saved ?? null, new Set(index.genreLabels.keys()));
      return retrying(async () => {
        const stored = await read<TasteStore>(profile, EXPLORE_TASTE_KEY);
        const taste = { ...(stored.value ?? emptyTaste()), saved, updatedAt: now() };
        await write(profile, EXPLORE_TASTE_KEY, taste, stored.revision);
        return { saved };
      });
    }
    if (action === 'reset') {
      // Explore feedback and derived taste only. Watch history, My List and MAL stay intact.
      await db.prepare('DELETE FROM profile_data WHERE profile_id=? AND key IN (?,?)').bind(profile, EXPLORE_SESSION_KEY, EXPLORE_TASTE_KEY).run();
      return { reset: true };
    }
    throw new AppError(404, 'NOT_FOUND', 'Explore action not found.');
  };
}
export const EXPLORE_ACTIONS = ['status', 'start', 'feedback', 'undo', 'results', 'preferences', 'reset'] as const;
export type ExploreServiceAction = (typeof EXPLORE_ACTIONS)[number];
export type { ExploreCardData };
