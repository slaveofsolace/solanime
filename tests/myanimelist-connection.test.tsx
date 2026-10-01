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
  return { configured: true, connected: true, username, count: 1 };
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

describe('MyAnimeList connection profile ownership', () => {
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
      await waitFor(() => expect(screen.getByText('Current viewer')).toBeTruthy());
      await act(async () => {
        if (outcome === 'success') previous.resolve(connected('Previous viewer'));
        else previous.reject(new Error('Previous profile connection error'));
        await previous.promise.catch(() => undefined);
      });

      expect(screen.getByText('Current viewer')).toBeTruthy();
      expect(screen.queryByText('Previous viewer')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  }

  it('stops an old import without issuing more pages or refreshing the wrong profile', async () => {
    const previous = deferred<{ complete: boolean; nextOffset: number }>();
    mocks.request.mockImplementation(path => path.endsWith('/sync') ? previous.promise
      : Promise.resolve(connected(path.includes('profile-a') ? 'Previous viewer' : 'Current viewer')));
    const view = render(connection());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sync list' })).toBeTruthy());
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Sync list' }));
    const request = mocks.request.mock.calls.find(([path]) => path.endsWith('/sync'))!;

    changeProfile('profile-b');
    await act(async () => { view.rerender(connection()); });
    expect((request[2] as AbortSignal).aborted).toBe(true);
    expect(screen.getByText('Current viewer')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sync list' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      previous.resolve({ complete: false, nextOffset: 100 });
      await previous.promise;
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mocks.request.mock.calls.map(([path]) => path)).toEqual([
      'profiles/profile-a/mal/status', 'profiles/profile-a/mal/sync', 'profiles/profile-b/mal/status',
    ]);
    expect(screen.queryByText(/Importing your list/)).toBeNull();
    expect(screen.getByText('Current viewer')).toBeTruthy();
  });

  it('discards a late OAuth destination when the profile changes', async () => {
    const previous = deferred<{ url: string }>();
    mocks.request.mockImplementation(path => path.endsWith('/connect') ? previous.promise
      : Promise.resolve({ configured: true, connected: false, count: 0 }));
    const view = render(connection());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect MyAnimeList' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Connect MyAnimeList' }));
    const request = mocks.request.mock.calls.find(([path]) => path.endsWith('/connect'))!;

    changeProfile('profile-b');
    view.rerender(connection());
    const readDestination = vi.fn(() => 'https://myanimelist.net/v1/oauth2/authorize');
    await act(async () => {
      previous.resolve({ get url() { return readDestination(); } });
      await previous.promise;
    });

    expect((request[2] as AbortSignal).aborted).toBe(true);
    expect(readDestination).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Connect MyAnimeList' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('aborts pending actions on sign-out and does not request an undefined profile', async () => {
    const previous = deferred<object>();
    mocks.request.mockImplementation(path => path.endsWith('/disconnect') ? previous.promise
      : Promise.resolve(connected('Previous viewer')));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const view = render(connection());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const request = mocks.request.mock.calls.find(([path]) => path.endsWith('/disconnect'))!;

    mocks.auth = { ...mocks.auth, account: null, profile: null };
    view.rerender(connection());
    await act(async () => { previous.resolve({}); await previous.promise; });

    expect((request[2] as AbortSignal).aborted).toBe(true);
    expect(screen.queryByText('Previous viewer')).toBeNull();
    expect(screen.getByText('Choose a profile to connect MyAnimeList.')).toBeTruthy();
    expect(mocks.request.mock.calls.map(([path]) => path)).toEqual([
      'profiles/profile-a/mal/status', 'profiles/profile-a/mal/disconnect',
    ]);
  });
});
