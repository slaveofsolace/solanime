import { afterEach, describe, expect, it } from 'vitest';
import { exploreService } from '../server/explore/service';
import { validateData } from '../server/accounts/validation';
import { EXPLORE_CONFIG, franchiseKey, type ExploreSessionView, type ExploreStatus } from '../shared/explore';
import { accountsFixture, syntheticCatalogue, syntheticFeatures } from './explore-fixtures';

type Result = { session: ExploreSessionView | null; applied?: boolean };
const open: Array<{ close(): void }> = [];
afterEach(() => { open.splice(0).forEach(db => db.close()); });

function setup(options: { features?: ReturnType<typeof syntheticFeatures> } = {}) {
  const fixture = accountsFixture();
  open.push(fixture.raw);
  const catalogue = syntheticCatalogue(options.features);
  let time = 1_900_000_000_000, ids = 0;
  const service = exploreService(fixture.db, catalogue, { now: () => time, randomId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` });
  const active = async () => {};
  const call = (action: string, input: Record<string, unknown> = {}, profile = 'p') => service(profile, action, input, active);
  let events = 0;
  const decide = async (session: ExploreSessionView, index: number, action: string, extra: Record<string, unknown> = {}) =>
    (await call('feedback', { sessionId: session.id, eventId: `event-${++events}-abcdef`, index, titleId: session.cards[index].titleId, action, ...extra })) as Result;
  return { ...fixture, catalogue, call, decide, advance: (ms: number) => { time += ms; } };
}
const start = async (t: ReturnType<typeof setup>, input: Record<string, unknown> = {}, profile = 'p') => (await t.call('start', { size: 10, ...input }, profile) as Result).session!;
const firstOpen = (session: ExploreSessionView) => session.decisions.findIndex(item => !item);

describe('Explore sessions', { timeout: 30_000 }, () => {
  it('honours 10/20/30 budgets and rejects other sizes', async () => {
    const t = setup();
    for (const size of [10, 20, 30]) {
      const session = await start(t, { size });
      expect(session.budget).toBe(size);
      expect(session.cards).toHaveLength(EXPLORE_CONFIG.lookahead);
    }
    await expect(t.call('start', { size: 25 })).rejects.toMatchObject({ status: 400 });
  });

  it('discloses a smaller deck instead of repeating titles or relaxing filters', async () => {
    const t = setup();
    const session = await start(t, { size: 30, filters: { excludeGenres: ['action', 'comedy', 'mystery', 'romance', 'drama'], length: 'long', audio: 'dub' } });
    expect(session.budget).toBeLessThan(30);
    expect(session.budget).toBe(session.eligible);
    let current = session;
    while (firstOpen(current) >= 0 && firstOpen(current) < current.budget) current = (await t.decide(current, firstOpen(current), 'skip')).session!;
    const ids = current.cards.map(card => card.titleId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(session.budget);
    expect(current.status).toBe('complete');
    for (const card of current.cards) expect(card.genres.map(genre => genre.toLowerCase())).not.toContain('action');
  });

  it('never repeats, never reorders presented cards, and keeps one title per franchise', async () => {
    const t = setup();
    let session = await start(t, { size: 20 });
    const seen: string[] = [];
    for (let step = 0; step < 20; step++) {
      const index = firstOpen(session);
      const before = session.cards.map(card => card.titleId);
      session = (await t.decide(session, index, step % 3 === 0 ? 'interested' : step % 3 === 1 ? 'pass' : 'skip')).session!;
      expect(session.cards.slice(0, before.length).map(card => card.titleId)).toEqual(before);
      seen.push(session.cards[index].titleId);
    }
    expect(new Set(seen).size).toBe(20);
    expect(new Set(session.cards.map(card => franchiseKey(card.name))).size).toBe(session.cards.length);
    expect(session.cards).toHaveLength(20);
  });

  it('treats duplicate submissions idempotently and does not let a second tab overwrite a decision', async () => {
    const t = setup();
    const session = await start(t);
    const body = { sessionId: session.id, eventId: 'same-event-123', index: 0, titleId: session.cards[0].titleId, action: 'interested' };
    const first = await t.call('feedback', body) as Result;
    const again = await t.call('feedback', body) as Result;
    expect(again.session!.revision).toBe(first.session!.revision);
    const otherTab = await t.call('feedback', { ...body, eventId: 'other-tab-456', action: 'pass' }) as Result;
    expect(otherTab.applied).toBe(false);
    expect(otherTab.session!.decisions[0]!.action).toBe('interested');
    await expect(t.call('feedback', { ...body, eventId: 'wrong-card-1', titleId: '99999' })).rejects.toMatchObject({ status: 409 });
  });

  it('survives concurrent writers through compare-and-swap retries', async () => {
    const t = setup();
    let session = await start(t);
    session = (await t.decide(session, 0, 'skip')).session!;
    const [a, b] = await Promise.all([t.decide(session, 1, 'interested'), t.decide(session, 2, 'pass')]);
    const status = await t.call('status') as ExploreStatus;
    expect(status.session!.decisions[1]!.action).toBe('interested');
    expect(status.session!.decisions[2]!.action).toBe('pass');
    expect(a.applied && b.applied).toBe(true);
  });

  it('undo reverses only the latest decision and its effect, idempotently', async () => {
    const t = setup();
    let session = await start(t);
    session = (await t.decide(session, 0, 'interested')).session!;
    session = (await t.decide(session, 1, 'pass')).session!;
    const undone = await t.call('undo', { sessionId: session.id, eventId: 'undo-event-1' }) as Result;
    expect(undone.session!.decisions[1]).toBeNull();
    expect(undone.session!.decisions[0]!.action).toBe('interested');
    const repeated = await t.call('undo', { sessionId: session.id, eventId: 'undo-event-1' }) as Result;
    expect(repeated.session!.decisions[0]!.action).toBe('interested');
  });

  it('resumes after reload and isolates profiles', async () => {
    const t = setup();
    let session = await start(t);
    session = (await t.decide(session, 0, 'interested')).session!;
    const reloaded = (await t.call('status') as ExploreStatus).session!;
    expect(reloaded.id).toBe(session.id);
    expect(reloaded.decisions[0]!.action).toBe('interested');
    expect((await t.call('status', {}, 'q') as ExploreStatus).session).toBeNull();
    await expect(t.call('feedback', { sessionId: session.id, eventId: 'cross-profile-1', index: 1, titleId: session.cards[1].titleId, action: 'pass' }, 'q'))
      .rejects.toMatchObject({ status: 409 });
  });
});

describe('Explore results', { timeout: 30_000 }, () => {
  it('separates picks from new recommendations and never echoes the swiped cards', async () => {
    const t = setup();
    let session = await start(t, { size: 10 });
    for (let step = 0; step < 6; step++) session = (await t.decide(session, firstOpen(session), step < 3 ? 'interested' : 'pass')).session!;
    const result = (await t.call('results', { sessionId: session.id }) as Result).session!.results!;
    expect(result.picks.map(card => card.titleId)).toEqual(session.cards.filter((_, i) => session.decisions[i]?.action === 'interested').map(card => card.titleId));
    const presented = new Set(session.cards.map(card => card.titleId));
    expect(result.recommended.length).toBe(EXPLORE_CONFIG.resultsSize);
    expect(result.recommended.some(item => presented.has(item.titleId))).toBe(false);
    expect(new Set(result.recommended.map(item => franchiseKey(item.name))).size).toBe(result.recommended.length);
    expect(result.recommended.every(item => item.reasons.length > 0)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/%|match score|probability/i);
  });

  it('gives an honest fallback when a round is all skipped and nothing else is known', async () => {
    const t = setup();
    let session = await start(t, { size: 10 });
    expect(session.signals.personalized).toBe(false);
    expect(session.cards.every(card => card.kind === 'starter')).toBe(true);
    for (let step = 0; step < 10; step++) session = (await t.decide(session, firstOpen(session), 'skip')).session!;
    const result = (await t.call('results', { sessionId: session.id }) as Result).session!.results!;
    expect(result.basis).toBe('fallback');
    expect(result.picks).toHaveLength(0);
    expect(result.recommended.length).toBeGreaterThan(0);
    expect(result.recommended.every(item => item.kind === 'starter')).toBe(true);
  });

  it('steers away after an all-passed round without claiming personal matches', async () => {
    const t = setup();
    let session = await start(t, { size: 10 });
    for (let step = 0; step < 10; step++) session = (await t.decide(session, firstOpen(session), 'pass')).session!;
    const result = (await t.call('results', { sessionId: session.id }) as Result).session!.results!;
    expect(result.basis).toBe('session');
    expect(result.recommended.length).toBeGreaterThan(0);
    expect(result.recommended.some(item => /rated|marked Interested/.test(item.reasons.map(reason => reason.text).join(' ')))).toBe(false);
  });

  it('applies reversible more/less refinements', async () => {
    const t = setup();
    let session = await start(t, { size: 10 });
    for (let step = 0; step < 5; step++) session = (await t.decide(session, firstOpen(session), 'interested')).session!;
    const first = (await t.call('results', { sessionId: session.id }) as Result).session!.results!;
    const target = first.recommended[2].titleId;
    const less = (await t.call('results', { sessionId: session.id, refine: { titleId: target, kind: 'less' } }) as Result).session!.results!;
    expect(less.recommended.find(item => item.titleId === target)?.refinement).toBe('less');
    const undone = (await t.call('results', { sessionId: session.id, refine: { titleId: target, kind: null } }) as Result).session!.results!;
    expect(undone.recommended.find(item => item.titleId === target)?.refinement ?? null).toBeNull();
  });
});

describe('personas and MAL', { timeout: 30_000 }, () => {
  const mystery = syntheticFeatures().filter(item => item.genres.includes('mystery') && Number(item.id) < 900);
  const comedy = syntheticFeatures().filter(item => item.genres.includes('comedy') && !item.genres.includes('mystery') && Number(item.id) < 900);

  it('ranks a substantial rated list toward that person’s taste, not public popularity', async () => {
    const a = setup(), b = setup();
    a.connectMal('p', [...mystery.slice(0, 6).map(item => ({ id: item.malId!, score: 9, status: 'completed' })), ...comedy.slice(0, 6).map(item => ({ id: item.malId!, score: 3, status: 'completed' }))]);
    b.connectMal('p', [...comedy.slice(0, 6).map(item => ({ id: item.malId!, score: 9, status: 'completed' })), ...mystery.slice(0, 6).map(item => ({ id: item.malId!, score: 3, status: 'completed' }))]);
    const sessionA = await start(a, { size: 10 }), sessionB = await start(b, { size: 10 });
    expect(sessionA.signals).toMatchObject({ mal: 'connected', malMatched: 12, malScored: 12, personalized: true });
    const resultsA = (await a.call('results', { sessionId: sessionA.id }) as Result).session!.results!;
    const resultsB = (await b.call('results', { sessionId: sessionB.id }) as Result).session!.results!;
    const share = (items: typeof resultsA.recommended, genre: string) => items.filter(item => item.genres.includes(genre)).length;
    expect(share(resultsA.recommended, 'Mystery')).toBeGreaterThan(share(resultsB.recommended, 'Mystery'));
    expect(share(resultsB.recommended, 'Comedy')).toBeGreaterThan(share(resultsA.recommended, 'Comedy'));
    expect(resultsA.recommended.slice(0, 3).flatMap(item => item.reasons).some(reason => reason.kind === 'mal-score')).toBe(true);
    // Rated titles are never recommended back as new discoveries.
    const ratedIds = new Set([...mystery.slice(0, 6), ...comedy.slice(0, 6)].map(item => item.id));
    expect(resultsA.recommended.some(item => ratedIds.has(item.titleId))).toBe(false);
  });

  it('labels sparse, partial, stale and unavailable connections truthfully', async () => {
    const sparse = setup();
    sparse.connectMal('p', [{ id: mystery[0].malId!, score: 0, status: 'plan_to_watch' }, { id: 424242, score: 8, status: 'completed' }]);
    const status = await sparse.call('status') as ExploreStatus;
    expect(status.signals).toMatchObject({ mal: 'connected', malMatched: 1, malUnmatched: 1, malScored: 0 });
    const partial = setup();
    partial.connectMal('p', [{ id: mystery[0].malId!, score: 8, status: 'completed' }], { partial: true });
    expect((await partial.call('status') as ExploreStatus).signals.mal).toBe('partial');
    const stale = setup();
    stale.connectMal('p', [{ id: mystery[0].malId!, score: 8, status: 'completed' }], { importedAt: 1_900_000_000_000 - 60 * 86_400_000 });
    expect((await stale.call('status') as ExploreStatus).signals.mal).toBe('stale');
    const broken = setup();
    broken.raw.exec('DROP TABLE mal_list_items; DROP TABLE mal_oauth_states; DROP TABLE mal_connections;');
    const brokenStatus = await broken.call('status') as ExploreStatus;
    expect(brokenStatus.signals.mal).toBe('unavailable');
    expect((await start(broken)).cards.length).toBeGreaterThan(0);
    const none = setup();
    expect((await none.call('status') as ExploreStatus).signals.mal).toBe('none');
  });

  it('rebuilds MAL-derived taste after disconnect while keeping Explore feedback', async () => {
    const t = setup();
    t.connectMal('p', mystery.slice(0, 6).map(item => ({ id: item.malId!, score: 10, status: 'completed' })));
    let session = await start(t, { size: 10 });
    session = (await t.decide(session, 0, 'interested')).session!;
    t.raw.exec("DELETE FROM mal_list_items WHERE profile_id='p'; DELETE FROM mal_connections WHERE profile_id='p';");
    session = (await t.decide(session, 1, 'skip')).session!;
    const results = (await t.call('results', { sessionId: session.id }) as Result).session!;
    expect(results.signals.mal).toBe('none');
    expect(results.results!.recommended.flatMap(item => item.reasons).some(reason => reason.kind === 'mal-score')).toBe(false);
    expect(results.results!.basis).toBe('session');
  });
});

describe('Explore data boundaries', { timeout: 30_000 }, () => {
  it('never writes history, watched state, My List or MAL while swiping', async () => {
    const t = setup();
    t.putData('p', 'history', [{ titleId: '3', slug: 'series-3', title: 'Series 003', episodeId: '1', episodeLabel: 'Episode 1', language: 'sub', watchedAt: new Date(0).toISOString() }]);
    t.putData('p', 'watchlist-records', [{ id: '4', slug: 'series-4', name: 'Series 004' }]);
    t.connectMal('p', [{ id: 1005, score: 7, status: 'completed' }]);
    const before = t.keys('p').filter(row => !row.key.startsWith('explore:'));
    const mal = t.raw.prepare('SELECT * FROM mal_list_items').all();
    let session = await start(t, { size: 10 });
    for (let step = 0; step < 10; step++) session = (await t.decide(session, firstOpen(session), ['interested', 'pass', 'skip', 'seen'][step % 4], step % 4 === 3 ? { liked: true } : {})).session!;
    await t.call('results', { sessionId: session.id });
    expect(t.keys('p').filter(row => !row.key.startsWith('explore:'))).toEqual(before);
    expect(t.raw.prepare('SELECT * FROM mal_list_items').all()).toEqual(mal);
    expect(session.cards.some(card => card.titleId === '3')).toBe(false);
  });

  it('reset removes only Explore data and seen titles stay out of later rounds until then', async () => {
    const t = setup();
    t.putData('p', 'watchlist-records', [{ id: '4', slug: 'series-4', name: 'Series 004' }]);
    let session = await start(t, { size: 10 });
    const seenId = session.cards[0].titleId;
    session = (await t.decide(session, 0, 'seen')).session!;
    const next = await start(t, { size: 30 });
    let current = next;
    while (firstOpen(current) >= 0 && firstOpen(current) < current.budget) current = (await t.decide(current, firstOpen(current), 'skip')).session!;
    expect(current.cards.some(card => card.titleId === seenId)).toBe(false);
    await t.call('reset');
    expect(t.keys('p').map(row => row.key)).toEqual(['watchlist-records']);
    expect((await t.call('status') as ExploreStatus).signals.explore).toBe(0);
  });

  it('keeps Explore keys out of the generic client profile-data endpoint', () => {
    expect(() => validateData('explore:session', {})).toThrow();
    expect(() => validateData('explore:taste', {})).toThrow();
  });

  it('saves preferences only when asked, and never the mood', async () => {
    const t = setup();
    await start(t, { filters: { mood: 'mind', genres: ['sports'] } });
    expect((await t.call('status') as ExploreStatus).saved).toBeNull();
    await start(t, { filters: { mood: 'mind', genres: ['sports'], excludeGenres: ['horror'] }, savePreferences: true });
    const saved = (await t.call('status') as ExploreStatus).saved!;
    expect(saved).toEqual({ genres: ['sports'], excludeGenres: ['horror'], length: 'any', audio: 'any' });
    expect(saved).not.toHaveProperty('mood');
    await expect(t.call('start', { filters: { genres: ['not-a-genre'] } })).rejects.toMatchObject({ status: 400 });
    await expect(t.call('start', { filters: { genres: ['horror'], excludeGenres: ['horror'] } })).rejects.toMatchObject({ status: 400 });
  });

  it('reads catalogue cards in small batches only', async () => {
    const t = setup();
    let session = await start(t, { size: 10 });
    for (let step = 0; step < 10; step++) session = (await t.decide(session, firstOpen(session), 'skip')).session!;
    await t.call('results', { sessionId: session.id });
    // One card per append plus one results batch: no catalogue-wide hydration.
    expect(t.catalogue.cardCalls).toBeLessThanOrEqual(12);
  });
});
