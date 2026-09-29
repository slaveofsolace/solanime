import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { accountRequest, setAccountCsrf } from './api';
import { profileStorage, type StorageScope } from './storageScope';
import type { Profile, ProfileData, SessionResponse } from './types';
const empty: SessionResponse = {
  account: null,
  profiles: [],
  csrfToken: null,
  registrationOpen: true,
  recoveryMethod: 'recovery-code',
  maxProfiles: 5,
};
function anonymousFrom(session: SessionResponse): SessionResponse {
  return {
    ...session,
    account: null,
    profiles: [],
    csrfToken: null,
    recoveryCode: undefined,
    pendingApproval: undefined,
  };
}
function selectedId(accountId: string) {
  try {
    return sessionStorage.getItem('solanime:profile:' + accountId);
  } catch {
    return null;
  }
}
function rememberProfile(accountId: string, id: string | null) {
  try {
    if (id) sessionStorage.setItem('solanime:profile:' + accountId, id);
    else sessionStorage.removeItem('solanime:profile:' + accountId);
  } catch {}
}
function useAccountController() {
  const [session, setSession] = useState(empty),
    [ready, setReady] = useState(false),
    [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null),
    [scope, setScope] = useState<StorageScope | null>(null),
    [changing, setChanging] = useState(false),
    [syncError, setSyncError] = useState<string | null>(null),
    [syncing, setSyncing] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const scopeRef = useRef<StorageScope | null>(null),
    sessionRef = useRef(session);
  sessionRef.current = session;
  const generation = useRef(0),
    requestRef = useRef<AbortController | null>(null);
  const sessionGeneration = useRef(0);
  const sessionMutation = useRef(false);
  const accept = useCallback((result: SessionResponse) => {
    setAccountCsrf(result.csrfToken);
    sessionRef.current = result;
    setSession(result);
    if (result.recoveryCode) setRecoveryCode(result.recoveryCode);
  }, []);
  const clearProfile = useCallback(() => {
    generation.current++;
    requestRef.current?.abort();
    scopeRef.current?.dispose();
    scopeRef.current = null;
    setScope(null);
    setProfile(null);
    setSyncError(null);
    setSyncing(false);
    setChanging(false);
  }, []);
  const activate = useCallback(
    async (p: Profile | null, accountId = sessionRef.current.account?.id) => {
      if (!accountId) return;
      const seq = ++generation.current;
      await scopeRef.current?.flush();
      if (seq !== generation.current || sessionRef.current.account?.id !== accountId) return;
      requestRef.current?.abort();
      const abort = new AbortController();
      requestRef.current = abort;
      setChanging(true);
      try {
        const data = p
          ? await accountRequest<ProfileData>(`profiles/${p.id}/data`, undefined, abort.signal)
          : null;
        if (seq !== generation.current) return;
        scopeRef.current?.dispose();
        setSyncError(null);
        const next =
          p && data
            ? profileStorage(
                data,
                async (key, value, revision) => {
                  const result = await accountRequest<{ revision: number }>(
                    `profiles/${p.id}/data`,
                    { key, value, revision },
                  );
                  return result.revision;
                },
                (error, busy) => {
                  if (seq === generation.current) {
                    setSyncError(error);
                    setSyncing(busy);
                  }
                },
              )
            : null;
        scopeRef.current = next;
        setScope(next);
        setProfile(p);
        rememberProfile(accountId, p?.id ?? null);
      } finally {
        if (seq === generation.current) setChanging(false);
      }
    },
    [],
  );
  const refresh = useCallback(async () => {
    // Visibility/session reads must not race a cookie-changing login or logout.
    if (sessionMutation.current) return;
    const seq = ++sessionGeneration.current;
    setLoadError(null);
    try {
      const result = await accountRequest<SessionResponse>('session');
      if (seq !== sessionGeneration.current) return;
      const old = sessionRef.current;
      if (old.account?.id !== result.account?.id) clearProfile();
      accept(result);
      if (!result.account) {
        clearProfile();
        return;
      }
      if (old.account?.id === result.account.id && scopeRef.current) {
        const current = result.profiles.find((p) => p.id === selectedId(result.account!.id));
        if (current) setProfile(current);
        else {
          clearProfile();
          rememberProfile(result.account.id, null);
        }
        return;
      }
      const wanted = selectedId(result.account.id);
      const found = result.profiles.find((p) => p.id === wanted);
      if (found) await activate(found, result.account.id);
    } catch (e) {
      if (seq === sessionGeneration.current) setLoadError(e instanceof Error ? e.message : 'Account service unavailable.');
    } finally {
      if (seq === sessionGeneration.current) setReady(true);
    }
  }, [accept, activate, clearProfile]);
  useEffect(() => {
    void refresh();
    return () => {
      sessionGeneration.current++;
      requestRef.current?.abort();
      scopeRef.current?.dispose();
    };
  }, [refresh]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (scopeRef.current?.hasPending()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  useEffect(() => {
    const expired = () => {
      sessionGeneration.current++;
      clearProfile();
      accept(anonymousFrom(sessionRef.current));
      setRecoveryCode(null);
      setLoadError(null);
      setReady(true);
    };
    window.addEventListener('solanime:session-expired', expired);
    return () => window.removeEventListener('solanime:session-expired', expired);
  }, [accept, clearProfile]);
  useEffect(() => {
    const listener = () => {
      if (document.visibilityState === 'visible')
        void refresh();
    };
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  }, [refresh]);
  const login = async (email: string, password: string, remember: boolean, register = false) => {
    if (sessionMutation.current) throw new Error('An account change is already in progress. Please wait.');
    sessionMutation.current = true;
    const seq = ++sessionGeneration.current;
    try {
      await scopeRef.current?.flush();
      if (seq !== sessionGeneration.current) return;
      const result = await accountRequest<SessionResponse>(register ? 'register' : 'login', {
        email, password, remember,
      });
      if (seq !== sessionGeneration.current) return;
      clearProfile();
      accept(result);
      setLoadError(null);
      setReady(true);
      if (result.account) rememberProfile(result.account.id, null);
      return result;
    } finally { sessionMutation.current = false; }
  };
  const logout = async (discardUnsaved = false) => {
    if (sessionMutation.current) throw new Error('An account change is already in progress. Please wait.');
    sessionMutation.current = true;
    const seq = ++sessionGeneration.current;
    try {
      // Explicit discard is available when a failed sync would otherwise trap the session.
      if (discardUnsaved) scopeRef.current?.dispose();
      else await scopeRef.current?.flush();
      if (seq !== sessionGeneration.current) return;
      await accountRequest('logout', {});
      if (seq !== sessionGeneration.current) return;
      const id = sessionRef.current.account?.id;
      if (id) rememberProfile(id, null);
      clearProfile();
      accept(anonymousFrom(sessionRef.current));
      setRecoveryCode(null);
    } finally { sessionMutation.current = false; }
  };
  const updateProfiles = async (result: { profiles: Profile[] }) => {
    accept({ ...sessionRef.current, profiles: result.profiles });
    if (profile && !result.profiles.some((p) => p.id === profile.id)) {
      clearProfile();
      if (sessionRef.current.account) rememberProfile(sessionRef.current.account.id, null);
    } else if (profile) setProfile(result.profiles.find((p) => p.id === profile.id) ?? null);
  };
  return {
    ...session,
    ready,
    loadError,
    refresh,
    profile,
    scope,
    changing,
    syncError,
    syncing,
    activate,
    login,
    logout,
    accept,
    clearProfile,
    updateProfiles,
    recoveryCode,
    setRecoveryCode,
  };
}
type Value = ReturnType<typeof useAccountController>;
const Context = createContext<Value | null>(null);
export function AccountProvider({ children }: PropsWithChildren) {
  const value = useAccountController();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAccount() {
  const value = useContext(Context);
  if (!value) throw Error('AccountProvider is missing');
  return value;
}
