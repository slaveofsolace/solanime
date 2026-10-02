// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountPage from '../src/pages/AccountPage';
import LibraryPage from '../src/pages/LibraryPage';
import SavedTitleActions from '../src/components/SavedTitleActions';
import HistoryActions from '../src/components/HistoryActions';
import type { TitleSummary, WatchHistoryEntry } from '../src/types';

const mocks = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  state: {} as Record<string, unknown>,
  request: vi.fn(), accept: vi.fn(), refresh: vi.fn(), clear: vi.fn(), copy: vi.fn(),
}));
vi.mock('../src/account/AccountProvider', () => ({ useAccount: () => mocks.auth }));
vi.mock('../src/account/api', () => ({ accountRequest: mocks.request }));
vi.mock('../src/state', () => ({ useAppState: () => mocks.state }));
vi.mock('../src/components/ui', () => ({ TitleCard: ({ title }: { title: TitleSummary }) => <span>{title.name}</span> }));
vi.mock('../src/components/MyAnimeListLibrary', () => ({ default: () => null }));

const title: TitleSummary = { id: 'title-a', slug: 'paper-lantern', name: 'Paper Lantern' };
const entry: WatchHistoryEntry = {
  titleId: title.id, slug: title.slug, title: title.name!, episodeId: 'episode-a',
  episodeLabel: 'Episode 1', language: 'sub', watchedAt: '2026-10-01T00:00:00Z',
  position: 30, duration: 300,
};
const profile = { id: 'profile-a', name: 'First viewer', avatar: 'violet' };
const dialogMethods = ['showModal', 'close'] as const;
const dialogDescriptors = dialogMethods.map(name => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}
function account(id: string) {
  return { id, email: `${id}@example.test`, emailVerified: false, createdAt: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth = {
    account: account('account-a'), profile, profiles: [profile],
    accept: mocks.accept, refresh: mocks.refresh, clearProfile: vi.fn(), logout: vi.fn(),
  };
  mocks.state = {
    watchlist: { items: [title], lists: [], has: () => true, toggle: vi.fn(), move: vi.fn() },
    watched: { isWatched: () => false, toggle: vi.fn() },
    history: { entries: [entry], clear: mocks.clear, remove: vi.fn(), dismissSeries: vi.fn() },
  };
  mocks.request.mockReset().mockResolvedValue({ items: [] });
  mocks.copy.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText: mocks.copy } });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
    value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true,
    value(this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  dialogMethods.forEach((name, index) => {
    const descriptor = dialogDescriptors[index];
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });
});

function securityAction(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'test-only-current-password' } });
}

describe('account action lifecycle', () => {
  it('offers password visibility and resets it when another security action opens', () => {
    render(<MemoryRouter><AccountPage /></MemoryRouter>);
    securityAction('Change password');
    fireEvent.click(screen.getByRole('button', { name: 'Show passwords' }));
    expect((screen.getByLabelText('Current password') as HTMLInputElement).type).toBe('text');
    expect((screen.getByLabelText('New password') as HTMLInputElement).type).toBe('text');
    expect((screen.getByLabelText('Confirm new password') as HTMLInputElement).type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Recovery code' }));
    expect((screen.getByLabelText('Current password') as HTMLInputElement).type).toBe('password');
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
  });

  it('does not display a late recovery code in another account and locks other security actions while saving', async () => {
    const response = deferred<{ recoveryCode: string }>();
    mocks.request.mockImplementation(path => path === 'recovery-code' ? response.promise : Promise.resolve({ items: [] }));
    const view = render(<MemoryRouter><AccountPage /></MemoryRouter>);
    securityAction('Recovery code');
    fireEvent.click(screen.getByRole('button', { name: 'Generate recovery code' }));
    expect((screen.getByRole('button', { name: 'Change password' }) as HTMLButtonElement).disabled).toBe(true);
    mocks.auth = { ...mocks.auth, account: account('account-b') };
    view.rerender(<MemoryRouter><AccountPage /></MemoryRouter>);
    await act(async () => { response.resolve({ recoveryCode: 'test-only-recovery-value' }); await response.promise; });
    expect(screen.queryByText('test-only-recovery-value')).toBeNull();
    expect(screen.getByText('account-b@example.test')).toBeTruthy();
    expect(screen.queryByLabelText('Current password')).toBeNull();
  });

  it('clears an already displayed recovery code when the session expires', async () => {
    mocks.request.mockImplementation(path => Promise.resolve(path === 'recovery-code'
      ? { recoveryCode: 'test-only-recovery-value' } : { items: [] }));
    const view = render(<MemoryRouter><AccountPage /></MemoryRouter>);
    securityAction('Recovery code');
    fireEvent.click(screen.getByRole('button', { name: 'Generate recovery code' }));
    await waitFor(() => expect(screen.getByText('test-only-recovery-value')).toBeTruthy());
    mocks.auth = { ...mocks.auth, account: null };
    view.rerender(<MemoryRouter><AccountPage /></MemoryRouter>);
    expect(screen.queryByText('test-only-recovery-value')).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
  });

  it('rechecks the current session instead of accepting a stale password response', async () => {
    const response = deferred<object>();
    mocks.request.mockImplementation(path => path === 'password' ? response.promise : Promise.resolve({ items: [] }));
    const view = render(<MemoryRouter><AccountPage /></MemoryRouter>);
    securityAction('Change password');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'test-only-next-password' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'test-only-next-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    mocks.auth = { ...mocks.auth, account: account('account-b') };
    view.rerender(<MemoryRouter><AccountPage /></MemoryRouter>);
    await act(async () => { response.resolve({ account: account('account-a'), profiles: [profile] }); await response.promise; });
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Password updated. Other sessions were signed out.')).toBeNull();
  });

  it('aborts an old device request and never displays its late result for a new account', async () => {
    const old = deferred<{ items: object[] }>();
    mocks.request.mockReturnValueOnce(old.promise).mockResolvedValue({ items: [
      { id: 'device-b', current: true, createdAt: 0, lastSeen: 0, device: 'Current account device' },
    ] });
    const view = render(<MemoryRouter><AccountPage /></MemoryRouter>);
    const oldSignal = mocks.request.mock.calls[0][2] as AbortSignal;
    mocks.auth = { ...mocks.auth, account: account('account-b') };
    view.rerender(<MemoryRouter><AccountPage /></MemoryRouter>);
    expect(oldSignal.aborted).toBe(true);
    await waitFor(() => expect(screen.getByText('Current account device')).toBeTruthy());
    await act(async () => {
      old.resolve({ items: [{ id: 'device-a', current: true, createdAt: 0, lastSeen: 0, device: 'Old account device' }] });
      await old.promise;
    });
    expect(screen.queryByText('Old account device')).toBeNull();
    expect(screen.getByText('Current account device')).toBeTruthy();
  });
});

describe('library dialog lifecycle', () => {
  for (const kind of ['title', 'episode'] as const) {
    it(`ignores a stale ${kind} clipboard response after the sheet is closed and reopened`, async () => {
      const response = deferred<void>();
      mocks.copy.mockReturnValueOnce(response.promise);
      render(<MemoryRouter>{kind === 'title'
        ? <SavedTitleActions title={title} opening={false} onPlay={vi.fn()} />
        : <HistoryActions entry={entry} title={title} context="history" />}</MemoryRouter>);
      fireEvent.click(screen.getByRole('button', { name: /More options/ }));
      fireEvent.click(screen.getByRole('button', { name: `Share ${kind}` }));
      expect((screen.getByRole('button', { name: `Share ${kind}` }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
      fireEvent.click(screen.getByRole('button', { name: /More options/ }));
      await act(async () => { response.resolve(); await response.promise; });
      expect(screen.queryByRole('status')).toBeNull();
      expect((screen.getByRole('button', { name: `Share ${kind}` }) as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: `Share ${kind}` }));
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('link copied.'));
    });
  }

  it('closes episode actions when a rail replaces the episode with another one', () => {
    const view = render(<MemoryRouter><HistoryActions entry={entry} context="continue" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /More options/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    view.rerender(<MemoryRouter><HistoryActions entry={{ ...entry, episodeId: 'episode-b', episodeLabel: 'Episode 2' }} context="continue" /></MemoryRouter>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dismisses a clear-history confirmation after a profile switch', () => {
    const view = render(<MemoryRouter initialEntries={['/library?view=history']}><LibraryPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(screen.getByRole('dialog', { name: 'Clear watch history?' })).toBeTruthy();
    mocks.auth = { ...mocks.auth, profile: { ...profile, id: 'profile-b', name: 'Second viewer' } };
    view.rerender(<MemoryRouter initialEntries={['/library?view=history']}><LibraryPage /></MemoryRouter>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.clear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(screen.getByText(/clears watch history and Continue Watching for Second viewer/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear this profile’s history' }));
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('link', { name: 'My List' }));
    expect(screen.getByText('Paper Lantern')).toBeTruthy();
    expect(mocks.state.watchlist).toMatchObject({ items: [title] });
  });
});
