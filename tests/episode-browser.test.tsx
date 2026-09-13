// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import EpisodeBrowser from '../src/components/EpisodeBrowser';
import type { Episode } from '../src/types';

const watched = vi.hoisted(() => ({ isWatched: vi.fn(() => false), toggle: vi.fn() }));
vi.mock('../src/state', () => ({ useAppState: () => ({ watched }) }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const episodes: Episode[] = Array.from({ length: 1177 }, (_, index) => {
  const number = index + 1;
  return {
    id: `episode-${number}`,
    number,
    label: `Episode ${number}`,
    versions: [
      { id: `${number}:sub`, language: 'sub', providerCount: 1 },
      ...(number > 1000 ? [{ id: `${number}:dub`, language: 'dub', providerCount: 1 }] : []),
    ],
  };
});

interface Props {
  episodes: Episode[];
  language: string;
  slug: string;
  currentId?: string;
}

function setup(overrides: Partial<Props> = {}) {
  let props: Props = { episodes, language: 'sub', slug: 'one-piece-odmau', currentId: 'episode-1177', ...overrides };
  const tree = () => <MemoryRouter><EpisodeBrowser {...props} /></MemoryRouter>;
  const view = render(tree());
  return {
    rerender(changes: Partial<Props>) {
      props = { ...props, ...changes };
      view.rerender(tree());
    },
  };
}

const range = (name: string) => screen.getByRole('button', { name });
const search = () => screen.getByRole('searchbox', { name: 'Find an episode' }) as HTMLInputElement;
const currentLink = () => document.querySelector<HTMLAnchorElement>('a[aria-current="page"]');

describe('episode browser current-range navigation', () => {
  it('initially opens episode 1177 in the final bounded range and preserves its watch route', () => {
    setup();
    expect(range('1151–1177').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('listitem')).toHaveLength(27);
    expect(currentLink()?.getAttribute('href')).toBe('/watch/one-piece-odmau/episode-1177?language=sub');
    expect(screen.queryByRole('button', { name: 'Current episode' })).toBeNull();
  });

  it('preserves deliberate range navigation across data rerenders and existing watched keys', () => {
    const view = setup();
    fireEvent.click(range('1–50'));
    view.rerender({ episodes: [...episodes] });
    expect(range('1–50').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    expect(currentLink()).toBeNull();
    expect(screen.getByRole('button', { name: 'Current episode' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark watched: Episode 1' }));
    expect(watched.toggle).toHaveBeenCalledWith('episode-1', 'sub');
  });

  it('lets keyboard users jump back from another range and focuses the current episode', async () => {
    const user = userEvent.setup();
    setup();
    fireEvent.click(range('1–50'));
    screen.getByRole('button', { name: 'Current episode' }).focus();
    await user.keyboard('{Enter}');
    expect(range('1151–1177').getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(currentLink());
    expect(screen.queryByRole('button', { name: 'Current episode' })).toBeNull();
  });

  it('resets filtered ranges when the query changes and clears search only on an explicit jump', () => {
    const view = setup();
    fireEvent.change(search(), { target: { value: 'Episode 1' } });
    fireEvent.click(range('51–100'));
    view.rerender({ episodes: [...episodes] });
    expect(search().value).toBe('Episode 1');
    expect(range('51–100').getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(search(), { target: { value: '1177' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(currentLink()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Current episode' }));
    expect(search().value).toBe('');
    expect(range('1151–1177').getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(currentLink());
  });

  it('reanchors to a changed current ID without retaining the previous episode search or selection', () => {
    const view = setup();
    fireEvent.change(search(), { target: { value: '1177' } });
    view.rerender({ currentId: 'episode-51' });
    expect(search().value).toBe('');
    expect(range('51–100').getAttribute('aria-pressed')).toBe('true');
    expect(currentLink()?.getAttribute('href')).toContain('/episode-51?language=sub');
    fireEvent.click(range('1–50'));
    view.rerender({ episodes: [...episodes] });
    expect(range('1–50').getAttribute('aria-pressed')).toBe('true');
  });

  it('can recover from an empty search and resets range state when the title changes', () => {
    const view = setup();
    fireEvent.change(search(), { target: { value: 'not an episode' } });
    expect(screen.getByText('No matching episodes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Current episode' }));
    expect(search().value).toBe('');
    expect(document.activeElement).toBe(currentLink());
    fireEvent.click(range('1–50'));
    view.rerender({ slug: 'different-title' });
    expect(range('1151–1177').getAttribute('aria-pressed')).toBe('true');
    expect(currentLink()?.getAttribute('href')).toContain('/watch/different-title/');
  });

  it('calculates the current range within the selected language and never points to an unavailable version', () => {
    const view = setup();
    fireEvent.change(search(), { target: { value: 'no matching title' } });
    view.rerender({ language: 'dub' });
    expect(search().value).toBe('');
    expect(range('151–177').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('listitem')).toHaveLength(27);
    expect(currentLink()?.getAttribute('href')).toContain('/episode-1177?language=dub');
    view.rerender({ currentId: 'episode-1' });
    expect(range('1–50').getAttribute('aria-pressed')).toBe('true');
    expect(currentLink()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Current episode' })).toBeNull();
  });

  it('uses the first page when the current ID is missing and follows a delayed inventory only before manual navigation', () => {
    const view = setup({ currentId: undefined });
    expect(range('1–50').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Current episode' })).toBeNull();
    view.rerender({ currentId: 'episode-1177', episodes: [] });
    expect(screen.getByText('No matching episodes')).toBeTruthy();
    view.rerender({ episodes });
    expect(range('1151–1177').getAttribute('aria-pressed')).toBe('true');

    view.rerender({ currentId: 'unknown-id', episodes: episodes.slice(0, 100) });
    fireEvent.click(range('51–100'));
    view.rerender({ episodes });
    expect(range('51–100').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Current episode' })).toBeNull();
  });

  it('keeps a deliberately selected page when the current episode arrives later, and clamps removed ranges', () => {
    const view = setup({ episodes: episodes.slice(0, 100) });
    fireEvent.click(range('51–100'));
    view.rerender({ episodes });
    expect(range('51–100').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Current episode' })).toBeTruthy();
    fireEvent.click(range('1001–1050'));
    view.rerender({ episodes: episodes.slice(0, 120) });
    expect(range('101–120').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    expect(screen.queryByRole('button', { name: 'Current episode' })).toBeNull();
  });

  it('groups a reliable multi-season inventory and searches across every season', () => {
    const seasonalEpisodes: Episode[] = Array.from({ length: 138 }, (_, index) => {
      const season = Math.floor(index / 24) + 1;
      const episode = (index % 24) + 1;
      return {
        id: `seasonal-${index + 1}`,
        number: `S${season} E${episode}`,
        label: `S${season} E${episode} · Chapter ${index + 1}`,
        versions: [{ id: `seasonal-${index + 1}:sub`, language: 'sub', providerCount: 2 }],
      };
    });

    setup({
      episodes: seasonalEpisodes,
      slug: 'six-season-series',
      currentId: 'seasonal-138',
    });

    const season = screen.getByRole('combobox', { name: 'Season' });
    expect(season).toHaveProperty('value', 'season-6');
    expect(screen.getAllByRole('listitem')).toHaveLength(18);
    expect(currentLink()?.getAttribute('href')).toContain('/seasonal-138?language=sub');

    fireEvent.change(season, { target: { value: 'season-2' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(24);
    expect(screen.getByText('S2 E1 · Chapter 25')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Current episode' })).toBeTruthy();

    fireEvent.change(search(), { target: { value: 'S5 E4' } });
    expect(season).toHaveProperty('value', 'all');
    expect(screen.getByText('Searching every season')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('S5 E4 · Chapter 100')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Current episode' }));
    expect(season).toHaveProperty('value', 'season-6');
    expect(document.activeElement).toBe(currentLink());
  });

  it('keeps irregular inventories on the established bounded-range navigation', () => {
    const mixedEpisodes = episodes.slice(0, 80).map((episode, index) => ({
      ...episode,
      number: index < 20 ? `S1 E${index + 1}` : episode.number,
    }));
    setup({ episodes: mixedEpisodes, currentId: 'episode-80' });

    expect(screen.queryByRole('combobox', { name: 'Season' })).toBeNull();
    expect(range('51–80').getAttribute('aria-pressed')).toBe('true');
  });
});
