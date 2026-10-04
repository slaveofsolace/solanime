// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MyAnimeListConnection from '../src/components/MyAnimeListConnection';
import type { MalConnection } from '../shared/myanimelist';

const mocks = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  request: vi.fn(),
}));
vi.mock('../src/account/AccountProvider', () => ({ useAccount: () => mocks.auth }));
vi.mock('../src/account/api', () => ({ accountRequest: mocks.request }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { resolve, reject, promise };
}
function connected(username: string): MalConnection {
  return { configured: true, usernameImport: true, connected: true, username, count: 1 };
}
function changeProfile(id: string) {
  mocks.auth = { ...mocks.auth, profile: { id } };
}
const connection = () => <MemoryRouter><MyAnimeListConnection /></MemoryRouter>;

beforeEach(() => {
  mocks.auth = { account: { id: 'account-a' }, profile: { id: 'profile-a' }, changing: false };
  mocks.request.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('MyAnimeList list import profile ownership', () => {
  for (const outcome of ['success', 'error'] as const) {
    it(`ignores a previous profile’s late status ${outcome}`, async () => {
      const previous = deferred<MalConnection>();
      mocks.request.mockImplementation(path => path === 'profiles/profile-a/mal/status'
        ? previous.promise : Promise.resolve(connected('Current viewer')));
      const view = render(connection());
      const signal = mocks.request.mock.calls[0][2] as AbortSignal;

      changeProfile('profile-b');
      view.rerender(connection());
      expect(signal.aborted).toBe(true);
      await waitFor(() => expect(screen.getByText(/from Current viewer/)).toBeTruthy());
      await act(async () => {
        if (outcome === 'success') previous.resolve(connected('Previous viewer'));
        else previous.reject(new Error('Previous profile connection error'));
        await previous.promise.catch(() => undefined);
      });

      expect(screen.queryByText(/Previous viewer/)).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  }

  it('imports by username for the current profile only and never asks for a MyAnimeList password', async () => {
    const pending = deferred<{ imported: number }>();
    mocks.request.mockImplementation(path => path.endsWith('/import-username') ? pending.promise
      : Promise.resolve({ configured: true, usernameImport: true, connected: false, count: 0 }));
    const view = render(connection());
    const input = await screen.findByLabelText('MyAnimeList username');
    expect(document.querySelector('input[type="password"]')).toBeNull();
    fireEvent.change(input, { target: { value: 'someone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import list' }));
    const request = mocks.request.mock.calls.find(([path]) => path.endsWith('/import-username'))!;
    expect(request[1]).toEqual({ username: 'someone' });

    changeProfile('profile-b');
    await act(async () => { view.rerender(connection()); });
    expect((request[2] as AbortSignal).aborted).toBe(true);
    await act(async () => { pending.resolve({ imported: 3 }); await pending.promise; });
    expect(screen.queryByText(/Imported 3 anime/)).toBeNull();
  });

  it('offers the export file when username import is not configured', async () => {
    mocks.request.mockResolvedValue({ configured: true, usernameImport: false, connected: false, count: 0 });
    render(connection());
    expect(await screen.findByLabelText('Import your export file')).toBeTruthy();
    expect(screen.queryByLabelText('MyAnimeList username')).toBeNull();
  });

  it('aborts a pending removal on sign-out and does not request an undefined profile', async () => {
    const previous = deferred<object>();
    mocks.request.mockImplementation(path => path.endsWith('/remove') ? previous.promise
      : Promise.resolve(connected('Previous viewer')));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const view = render(connection());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove imported list' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove imported list' }));
    const request = mocks.request.mock.calls.find(([path]) => path.endsWith('/remove'))!;

    mocks.auth = { ...mocks.auth, account: null, profile: null };
    view.rerender(connection());
    await act(async () => { previous.resolve({}); await previous.promise; });

    expect((request[2] as AbortSignal).aborted).toBe(true);
    expect(screen.getByText('Choose a profile to import a MyAnimeList list.')).toBeTruthy();
    expect(mocks.request.mock.calls.map(([path]) => path)).toEqual([
      'profiles/profile-a/mal/status', 'profiles/profile-a/mal/remove',
    ]);
  });
});

describe('MyAnimeList export parsing', () => {
  it('reads the official export format and rejects other files', async () => {
    const { parseMalExport } = await import('../src/lib/malExport');
    const xml = `<?xml version="1.0"?><myanimelist><myinfo><user_name>member</user_name><user_export_type>1</user_export_type></myinfo>
      <anime><series_animedb_id>1535</series_animedb_id><series_title><![CDATA[Death Note]]></series_title><series_episodes>37</series_episodes>
      <my_watched_episodes>37</my_watched_episodes><my_score>9</my_score><my_status>Completed</my_status></anime>
      <anime><series_animedb_id>5114</series_animedb_id><series_title><![CDATA[Fullmetal Alchemist: Brotherhood]]></series_title><series_episodes>64</series_episodes>
      <my_watched_episodes>0</my_watched_episodes><my_score>0</my_score><my_status>Plan to Watch</my_status></anime></myanimelist>`;
    expect(parseMalExport(xml)).toEqual({ username: 'member', entries: [
      { id: 1535, title: 'Death Note', status: 'completed', score: 9, watchedEpisodes: 37, totalEpisodes: 37, updatedAt: null },
      { id: 5114, title: 'Fullmetal Alchemist: Brotherhood', status: 'plan_to_watch', score: 0, watchedEpisodes: 0, totalEpisodes: 64, updatedAt: null },
    ] });
    expect(() => parseMalExport('<html></html>')).toThrow(/isn’t a MyAnimeList/);
  });
});
