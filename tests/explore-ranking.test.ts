import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPLORE_FILTERS, EMPTY_TASTE, EXPLORE_CONFIG, buildTaste, dedupeEvidence, diversify, eligibleTitles, entryPoints,
  franchiseKey, isSequelLike, malEvidence, malScoreCenter, scoreTitle, wildcardSlots,
  type ExploreEvidence, type ExplorePersonalState, type ExploreTitleFeature,
} from '../shared/explore';
import { syntheticFeatures } from './explore-fixtures';

const features = syntheticFeatures();
const byId = new Map(features.map(item => [item.id, item]));
const none: ExplorePersonalState = { malStatus: new Map(), history: new Set(), inProgress: new Set(), watchlist: new Set(), seen: new Set(), recentlyResolved: new Set(), rejected: new Set() };
const rated = (genre: string, score: number, limit = 8): ExploreEvidence[] => features.filter(item => item.genres.includes(genre) && item.id.length <= 3 && Number(item.id) < 900).slice(0, limit)
  .map(item => malEvidence({ titleId: item.id, name: item.name, score, status: 'completed' }, 6.5)!);
const top = (evidence: ExploreEvidence[], pool: ExploreTitleFeature[], count = 10, seed = 's') => {
  const longTerm = buildTaste(evidence, byId);
  const ranked = diversify(pool.map(item => scoreTitle(item, { longTerm, session: EMPTY_TASTE, wanted: new Set(), seed })), count);
  return ranked.map(item => item.feature);
};

describe('franchise handling', () => {
  it('groups sequels and side stories under one conservative key', () => {
    expect(franchiseKey('Night Detective Season 2')).toBe(franchiseKey('Night Detective'));
    expect(franchiseKey('Night Detective: The Movie')).toBe(franchiseKey('Night Detective'));
    expect(franchiseKey('Mob Psycho 100')).toBe('mob psycho 100');
    expect(isSequelLike({ name: 'Night Detective Season 2', type: 'tv' })).toBe(true);
    expect(isSequelLike({ name: 'Night Detective 2nd Season', type: 'tv' })).toBe(true);
    expect(isSequelLike({ name: 'Mob Psycho 100', type: 'tv' })).toBe(false);
    expect(isSequelLike({ name: 'Anything', type: 'special' })).toBe(true);
    expect(isSequelLike({ name: 'Detective Conan Movie 26: Black Iron Submarine', type: 'movie' })).toBe(true);
    expect(franchiseKey('Detective Conan Movie 26: Black Iron Submarine')).toBe('detective conan');
  });
  it('offers only the first entry point of a franchise', () => {
    const points = entryPoints(features);
    expect(points.get(franchiseKey('Night Detective'))?.id).toBe('901');
    const { eligible } = eligibleTitles(features, DEFAULT_EXPLORE_FILTERS, null, none);
    const ids = eligible.map(item => item.id);
    expect(ids).toContain('901');
    for (const sequel of ['902', '903', '904']) expect(ids).not.toContain(sequel);
  });
});

describe('MAL evidence', () => {
  it('treats score 0 as unscored and dropped or on-hold status alone as neutral', () => {
    expect(malEvidence({ titleId: '1', name: 'x', score: 0, status: 'dropped' }, 6.5)).toBeNull();
    expect(malEvidence({ titleId: '1', name: 'x', score: 0, status: 'on_hold' }, 6.5)).toBeNull();
    expect(malEvidence({ titleId: '1', name: 'x', score: 0, status: 'completed' }, 6.5)!.value).toBeGreaterThan(0);
    expect(malEvidence({ titleId: '1', name: 'x', score: 3, status: 'dropped' }, 6.5)!.value).toBeLessThan(0);
    expect(malEvidence({ titleId: '1', name: 'x', score: 10, status: 'completed' }, 6.5)!.weight).toBe(1);
  });
  it('centers generous raters on their own mean once there is enough evidence', () => {
    expect(malScoreCenter([9, 9, 8])).toBe(6.5);
    expect(malScoreCenter([9, 9, 8, 9, 10, 0, 0])).toBe(9);
  });
  it('counts a title once even when it is in MAL, history and My List', () => {
    const items: ExploreEvidence[] = [
      { titleId: '7', name: 'a', source: 'watchlist', value: 0.15, weight: 0.25 },
      { titleId: '7', name: 'a', source: 'history', value: 0.25, weight: 0.35 },
      { titleId: '7', name: 'a', source: 'mal', value: 0.9, weight: 1, malScore: 9 },
    ];
    expect(dedupeEvidence(items)).toEqual([items[2]]);
  });
});

describe('ranking reacts to taste rather than popularity', () => {
  const pool = eligibleTitles(features, DEFAULT_EXPLORE_FILTERS, null, none).eligible;
  it('ranks different personas toward their own genres', () => {
    const mystery = top([...rated('mystery', 9), ...rated('comedy', 3)], pool);
    const comedy = top([...rated('comedy', 9), ...rated('mystery', 3)], pool);
    const share = (list: ExploreTitleFeature[], genre: string) => list.filter(item => item.genres.includes(genre)).length / list.length;
    expect(share(mystery, 'mystery')).toBeGreaterThan(share(comedy, 'mystery'));
    expect(share(comedy, 'comedy')).toBeGreaterThan(share(mystery, 'comedy'));
    expect(mystery.slice(0, 3).every(item => !item.genres.includes('comedy') || item.genres.includes('mystery'))).toBe(true);
  });
  it('keeps public score a capped tie-break that cannot override personal taste', () => {
    const famous = pool.map(item => item.genres.includes('comedy') && !item.genres.includes('mystery') ? { ...item, publicMean: 9.3, publicMembers: 3_000_000 } : item);
    const ranked = top([...rated('mystery', 9), ...rated('comedy', 3)], famous, 5);
    expect(ranked.filter(item => item.genres.includes('comedy') && !item.genres.includes('mystery'))).toHaveLength(0);
    expect(EXPLORE_CONFIG.weights.quality).toBeLessThan(EXPLORE_CONFIG.weights.personal / 4);
  });
  it('rescales missing signals instead of penalising unknown fields', () => {
    const score = scoreTitle(pool[0], { longTerm: EMPTY_TASTE, session: EMPTY_TASTE, wanted: new Set(), seed: 'x' });
    expect(score.groups).toEqual([]);
    expect(Math.abs(score.score)).toBeLessThan(0.02);
  });
  it('one passed action title is a modest signal, not a ban on the genre', () => {
    const action = pool.find(item => item.genres.includes('action'))!;
    const session = buildTaste([{ titleId: action.id, name: action.name, source: 'session', value: EXPLORE_CONFIG.feedback.pass, weight: 1 }], byId, EXPLORE_CONFIG.sessionShrinkage);
    const other = pool.find(item => item.id !== action.id && item.genres.includes('action'))!;
    const scored = scoreTitle(other, { longTerm: EMPTY_TASTE, session, wanted: new Set(), seed: 'x' });
    expect(scored.score).toBeLessThan(0);
    expect(scored.score).toBeGreaterThan(-0.5);
  });
  it('diversifies: one title per franchise and no single-genre flood', () => {
    const ranked = top(rated('mystery', 10, 20), features.filter(item => item.episodeCount > 0), 10);
    expect(new Set(ranked.map(item => franchiseKey(item.name))).size).toBe(ranked.length);
    expect(ranked.filter(item => item.genres.includes('mystery')).length).toBeLessThan(ranked.length);
  });
  it('is deterministic for a seed', () => {
    const evidence = rated('romance', 8);
    expect(top(evidence, pool, 10, 'seed-a').map(item => item.id)).toEqual(top(evidence, pool, 10, 'seed-a').map(item => item.id));
  });
});

describe('hard constraints', () => {
  it('never relaxes exclusions, length or audio to fill a deck', () => {
    const { eligible } = eligibleTitles(features, { ...DEFAULT_EXPLORE_FILTERS, excludeGenres: ['action', 'comedy'], length: 'long', audio: 'dub' }, null, none);
    expect(eligible.length).toBeGreaterThan(0);
    for (const item of eligible) {
      expect(item.genres).not.toContain('action');
      expect(item.genres).not.toContain('comedy');
      expect(item.episodeCount).toBeGreaterThan(30);
      expect(item.languages).toContain('dub');
    }
  });
  it('excludes known titles and their franchises, keeps plan-to-watch, and respects dropped', () => {
    const personal = { ...none, malStatus: new Map([['901', 'completed'], ['5', 'dropped'], ['6', 'plan_to_watch'], ['7', 'watching']] as const) };
    const ids = eligibleTitles(features, DEFAULT_EXPLORE_FILTERS, null, personal).eligible.map(item => item.id);
    expect(ids).not.toContain('901');
    expect(ids).not.toContain('5');
    expect(ids).not.toContain('7');
    expect(ids).toContain('6');
    expect(eligibleTitles(features, { ...DEFAULT_EXPLORE_FILTERS, includeDropped: true }, null, personal).eligible.map(item => item.id)).toContain('5');
    expect(eligibleTitles(features, { ...DEFAULT_EXPLORE_FILTERS, includePlanned: false }, null, personal).eligible.map(item => item.id)).not.toContain('6');
  });
  it('puts watching and on-hold titles only in Continue or revisit mode', () => {
    const personal = { ...none, malStatus: new Map([['7', 'watching'], ['8', 'on_hold']] as const), inProgress: new Set(['10']), history: new Set(['10']) };
    const revisit = eligibleTitles(features, { ...DEFAULT_EXPLORE_FILTERS, mode: 'revisit' }, null, personal).eligible.map(item => item.id).sort();
    expect(revisit).toEqual(['10', '7', '8']);
  });
  it('keeps metadata-only titles out of the default playable deck', () => {
    expect(eligibleTitles(features, DEFAULT_EXPLORE_FILTERS, null, none).eligible.map(item => item.id)).not.toContain('905');
    expect(eligibleTitles(features, { ...DEFAULT_EXPLORE_FILTERS, availability: 'all' }, null, none).eligible.map(item => item.id)).toContain('905');
  });
});

describe('wildcards', () => {
  it('reserve roughly 10–20% of slots and never the first two cards', () => {
    for (const budget of [10, 20, 30]) {
      const slots = wildcardSlots(budget, 'seed');
      expect(slots.length).toBeGreaterThanOrEqual(Math.floor(budget * 0.1));
      expect(slots.length).toBeLessThanOrEqual(Math.ceil(budget * 0.2));
      expect(Math.min(...slots)).toBeGreaterThanOrEqual(2);
      expect(Math.max(...slots)).toBeLessThan(budget);
    }
  });
});
