import { useMemo, type PropsWithChildren } from 'react';
import { useAccount } from './AccountProvider';
import { StorageScopeContext, profileStorage } from './storageScope';
import { AppStateProvider } from '../state';
/** A profile change unmounts the old player's lifecycle before rendering the new collection. */
export default function AccountBoundary({ children }: PropsWithChildren) {
  const { ready, scope, profile, account, changing } = useAccount();
  const temporary = useMemo(
    () =>
      profileStorage(
        { values: {}, revisions: {} },
        async () => 1,
        () => {},
      ),
    [account?.id],
  );
  if (!ready)
    return (
      <main className="account-loading" aria-busy="true">
        <h1>Opening Solanime</h1>
        <p>Restoring your session…</p>
      </main>
    );
  return (
    <StorageScopeContext.Provider value={scope ?? (account ? temporary : null)}>
      <AppStateProvider key={account ? `${account.id}:${profile?.id ?? 'unselected'}` : 'guest'}>
        {changing && (
          <div className="profile-loading" role="status">
            Opening profile…
          </div>
        )}
        {children}
      </AppStateProvider>
    </StorageScopeContext.Provider>
  );
}
