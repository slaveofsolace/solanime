import { describe, expect, it } from 'vitest';
import { continueWatching, viewingPercent } from '../src/lib/continueWatching';
import { safeReturnTo } from '../src/account/returnTo';
import type { WatchHistoryEntry } from '../src/types';
const entry = (episodeId: string, overrides: Partial<WatchHistoryEntry> = {}): WatchHistoryEntry => ({
  titleId: 'a', slug: 'anime-a', title: 'Anime A', episodeId, episodeLabel: `Episode ${episodeId}`, language: 'sub',
  position: 100, duration: 1000, watchedAt: '2026-09-27T10:00:00Z', ...overrides,
});
describe('series-level continue watching', () => {
  it('keeps the latest episode of a series, without mutating full history', () => {
    const history = [entry('1'), entry('9', { watchedAt: '2026-09-27T11:00:00Z' }), entry('2', { titleId: 'b' })];
    expect(continueWatching(history).map(e => e.episodeId)).toEqual(['9', '2']);
    expect(history).toHaveLength(3);
  });
  it('does not resurrect an older unfinished episode after completing a newer one', () => {
    expect(continueWatching([entry('1'), entry('9', { position: 990, watchedAt: '2026-09-27T11:00:00Z' })])).toEqual([]);
  });
  it('consolidates language variants and rejects invalid dates', () => {
    expect(continueWatching([entry('1', { language: 'dub', watchedAt: '2026-09-27T11:00:00Z' }), entry('2'), entry('3', { watchedAt: 'bad' })]).map(e => e.language)).toEqual(['dub']);
  });
  it('bounds meaningful progress', () => {
    expect(viewingPercent({ position: Infinity, duration: 50 })).toBe(0);
    expect(viewingPercent({ position: 100, duration: 50 })).toBe(100);
  });
  it('does not revive a hidden series until a new viewing event is recorded', () => {
    const hidden = [entry('1'), entry('9', { continueHidden: true, watchedAt: '2026-09-27T11:00:00Z' })];
    expect(continueWatching(hidden)).toEqual([]);
    expect(continueWatching([...hidden, entry('10', { watchedAt: '2026-09-27T12:00:00Z' })]).map(item => item.episodeId)).toEqual(['10']);
  });
});
describe('authentication return routes', () => {
  it('retains local routes and filters', () => expect(safeReturnTo('/library?filter=watching#history')).toBe('/library?filter=watching#history'));
  it.each(['https://other.example/', '//other.example/', '/\\other.example', '/login?returnTo=/login', '/profiles', '/\nfoo'])('rejects unsafe or looping destination %s', value => {
    expect(safeReturnTo(value)).toBe('/');
  });
});
