import type { PropsWithChildren } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAccount } from './AccountProvider';
import { withReturnTo } from './returnTo';

export default function RequireAccount({ children, profile = true }: PropsWithChildren<{ profile?: boolean }>) {
  const auth = useAccount();
  const location = useLocation();
  const destination = location.pathname + location.search + location.hash;
  if (!auth.ready || auth.changing) return <section className="account-empty" role="status">Opening your account…</section>;
  if (auth.loadError) return <section className="account-empty" role="alert">
    <h1>Could not restore your account</h1><p>Your saved data has not been changed.</p>
    <button type="button" className="button button--primary" onClick={() => void auth.refresh()}>Try again</button>
  </section>;
  if (!auth.account) return <Navigate to={withReturnTo('/login', destination)} replace />;
  if (profile && !auth.profile) return <Navigate to={withReturnTo('/profiles', destination)} replace />;
  return children;
}
