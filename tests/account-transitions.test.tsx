// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountProvider, useAccount } from '../src/account/AccountProvider';
import type { SessionResponse } from '../src/account/types';

const mocks = vi.hoisted(() => ({ request: vi.fn(), csrf: vi.fn() }));
vi.mock('../src/account/api', () => ({ accountRequest: mocks.request, setAccountCsrf: mocks.csrf }));
const anonymous: SessionResponse = { account: null, profiles: [], csrfToken: null, registrationOpen: true, recoveryMethod: 'recovery-code', maxProfiles: 5 };
const signedIn: SessionResponse = { ...anonymous, account: { id: 'account-a', email: 'fixture@example.test', emailVerified: false, createdAt: 0 }, csrfToken: 'fixture-csrf', privateSite: true, approvalRequired: true };
let account: ReturnType<typeof useAccount>;
function Probe() { account = useAccount(); return <span>{account.account?.id ?? 'guest'}</span>; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { mocks.request.mockReset(); mocks.csrf.mockReset(); sessionStorage.clear(); });
afterEach(cleanup);

describe('account transition ordering', () => {
  it('restores the sole profile after a fresh app launch', async () => {
    const onlyProfile = { id: 'profile-a', name: 'You', avatar: 'violet' as const };
    mocks.request.mockImplementation((path: string) =>
      Promise.resolve(path === 'session'
        ? { ...signedIn, profiles: [onlyProfile] }
        : { values: {}, revisions: {} }),
    );
    render(<AccountProvider><Probe /></AccountProvider>);
    await waitFor(() => expect(account.profile?.id).toBe(onlyProfile.id));
    expect(sessionStorage.getItem('solanime:profile:account-a')).toBe(onlyProfile.id);
    expect(mocks.request).toHaveBeenCalledWith('profiles/profile-a/data', undefined, expect.any(AbortSignal));
    sessionStorage.removeItem('solanime:profile:account-a');
    await act(async () => { await account.refresh(); });
    expect(account.profile?.id).toBe(onlyProfile.id);
    expect(sessionStorage.getItem('solanime:profile:account-a')).toBe(onlyProfile.id);
  });

  it('leaves multiple profiles unselected until the viewer chooses one', async () => {
    mocks.request.mockResolvedValue({ ...signedIn, profiles: [
      { id: 'profile-a', name: 'You', avatar: 'violet' },
      { id: 'profile-b', name: 'Family', avatar: 'amber' },
    ] });
    render(<AccountProvider><Probe /></AccountProvider>);
    await waitFor(() => expect(account.ready).toBe(true));
    expect(account.profile).toBeNull();
    expect(mocks.request.mock.calls.map(([path]) => path)).toEqual(['session']);
  });

  it('does not start a visibility refresh that can overwrite an in-flight sign-in', async () => {
    const login = deferred<SessionResponse>();
    mocks.request.mockImplementation((path: string) => path === 'login' ? login.promise : Promise.resolve(anonymous));
    render(<AccountProvider><Probe /></AccountProvider>);
    await waitFor(() => expect(account.ready).toBe(true));
    let pending!: Promise<SessionResponse | undefined>;
    act(() => { pending = account.login('fixture@example.test', 'test-only', false); });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('login', expect.anything()));
    await act(async () => { await account.refresh(); });
    expect(mocks.request.mock.calls.filter(([path]) => path === 'session')).toHaveLength(1);
    await act(async () => { login.resolve(signedIn); await pending; });
    expect(account.account?.id).toBe('account-a');
  });

  it('ignores an older session response once sign-out starts', async () => {
    const refresh = deferred<SessionResponse>();
    mocks.request.mockResolvedValueOnce(signedIn).mockImplementation((path: string) => path === 'session' ? refresh.promise : Promise.resolve({}));
    render(<AccountProvider><Probe /></AccountProvider>);
    await waitFor(() => expect(account.account?.id).toBe('account-a'));
    let reading!: Promise<void>;
    act(() => { reading = account.refresh(); });
    await act(async () => { await account.logout(); });
    await act(async () => { refresh.resolve(signedIn); await reading; });
    expect(account.account).toBeNull();
    expect(account.privateSite).toBe(true);
    expect(account.approvalRequired).toBe(true);
    expect(account.csrfToken).toBeNull();
  });
  it('retains the private-route policy after a session-expired signal', async () => {
    mocks.request.mockResolvedValue(signedIn);
    render(<AccountProvider><Probe /></AccountProvider>);
    await waitFor(() => expect(account.account?.id).toBe('account-a'));
    act(() => { window.dispatchEvent(new Event('solanime:session-expired')); });
    expect(account.account).toBeNull();
    expect(account.privateSite).toBe(true);
    expect(account.csrfToken).toBeNull();
  });
});
