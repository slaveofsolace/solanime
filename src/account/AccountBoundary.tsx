import { useMemo, type PropsWithChildren } from 'react';
import { useAccount } from './AccountProvider';
import { StorageScopeContext, profileStorage, readOnlyStorage } from './storageScope';
import { AppStateProvider } from '../state';
/** A profile change unmounts the old player's lifecycle before rendering the new collection. */
export default function AccountBoundary({ children }: PropsWithChildren) {
  const { ready, scope, profile, account, changing } = useAccount();
  const pending = useMemo(readOnlyStorage, []);
  const temporary = useMemo(
    () =>
      profileStorage(
        { values: {}, revisions: {} },
        async () => 1,
        () => {},
      ),
    [account?.id],
  );
  return (
    <StorageScopeContext.Provider value={!ready ? pending : scope ?? (account ? temporary : null)}>
      <AppStateProvider
        key={account ? `${account.id}:${profile?.id ?? 'unselected'}` : 'guest'}
      >
        {!ready && (
          <div className="account-readiness" role="status" aria-live="polite">
            Restoring your private library…
          </div>
        )}
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
