import { describe, expect, it } from 'vitest';
import { chooseWatchEntry, watchEntryPath } from '../src/lib/watchEntry';
import type { Episode, WatchHistoryEntry } from '../src/types';

const episodes: Episode[] = [1, 2, 3].map((number) => ({
  id: String(number),
  number,
  versions: [{ id: `sub-${number}`, language: 'sub', providerCount: 1 }],
}));
const history = (episodeId: string, position = 300): WatchHistoryEntry => ({
  titleId: 'series', slug: 'series', title: 'Series', episodeId,
  episodeLabel: `Episode ${episodeId}`, language: 'sub',
  position, duration: 1000, watchedAt: '2026-09-28T12:00:00Z',
});

describe('primary watch entry', () => {
  it('starts at episode one and preserves its language in the route', () => {
    const entry = chooseWatchEntry('series', episodes, [], 'sub');
    expect(entry).toMatchObject({ episode: episodes[0], label: 'Start watching' });
    expect(watchEntryPath('series', entry!)).toBe('/watch/series/1?language=sub');
  });

  it('starts at episode one even when the preferred language begins later', () => {
    const laterDub = episodes.map((episode, index) => ({
      ...episode,
      versions: index === 0 ? episode.versions : [
        ...episode.versions,
        { id: `dub-${episode.id}`, language: 'dub', providerCount: 1 },
      ],
    }));
    const entry = chooseWatchEntry('series', laterDub, [], 'dub');
    expect(entry).toMatchObject({ episode: laterDub[0], language: 'sub' });
  });

  it('continues the latest episode instead of choosing an older unfinished one', () => {
    const prior = { ...history('1'), watchedAt: '2026-09-27T12:00:00Z' };
    expect(chooseWatchEntry('series', episodes, [prior, history('2')], 'sub'))
      .toMatchObject({ episode: episodes[1], label: 'Continue watching' });
  });

  it('advances after completion and replays the final episode', () => {
    expect(chooseWatchEntry('series', episodes, [history('2', 980)], 'sub'))
      .toMatchObject({ episode: episodes[2], label: 'Continue watching' });
    expect(chooseWatchEntry('series', episodes, [history('3', 980)], 'sub'))
      .toMatchObject({ episode: episodes[2], label: 'Watch again' });
  });

  it('falls back to episode one if the saved episode is no longer in the inventory', () => {
    expect(chooseWatchEntry('series', episodes, [history('gone')], 'sub'))
      .toMatchObject({ episode: episodes[0], label: 'Start watching' });
  });

  it('does not call an unmapped episode playable', () => {
    const unmapped: Episode = {
      id: '1', number: 1, versions: [{ id: 'sub-1', language: 'sub', providerCount: 0 }],
    };
    expect(chooseWatchEntry('series', [unmapped], [], 'sub'))
      .toMatchObject({ label: 'Open first episode' });
  });
});
