import type { PropsWithChildren } from 'react';
import { useAccount } from './AccountProvider';
import RequireAccount from './RequireAccount';

export default function PrivateSiteRoute({ children }: PropsWithChildren) {
  const account = useAccount();
  if (!account.ready || account.changing)
    return <section className="account-empty" role="status">Opening Solanime…</section>;
  if (account.loadError)
    return <section className="account-empty" role="alert">
      <h1>Could not check access</h1>
      <p>The site has not opened your library or catalogue.</p>
      <button type="button" className="button button--primary" onClick={() => void account.refresh()}>Try again</button>
    </section>;
  return account.privateSite ? <RequireAccount profile={false}>{children}</RequireAccount> : children;
}
