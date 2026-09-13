import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { AccountProvider } from './account/AccountProvider';
import AccountBoundary from './account/AccountBoundary';
import { Layout, StatusPanel } from './components/ui';
import PageErrorBoundary from './components/ErrorBoundary';
import HomePage from './pages/HomePage';
import { SolanimeBrand } from './branding';
import { useAppState } from './state';
const CataloguePage = lazy(() => import('./pages/CataloguePage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const TitlePage = lazy(() => import('./pages/TitlePage'));
const WatchPage = lazy(() => import('./pages/WatchPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const AdminSourcesPage = lazy(() => import('./pages/AdminSourcesPage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));
const ProfilesPage = lazy(() => import('./pages/ProfilesPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
function NotFound() {
  return (
    <StatusPanel
      eyebrow="404"
      title="Page not found"
      action={
        <Link className="button button--primary" to="/catalogue">
          Browse catalogue
        </Link>
      }
    >
      <p>This address is not part of the catalogue.</p>
    </StatusPanel>
  );
}
function RouteReadiness() {
  const { preferences } = useAppState();
  const [prefs] = preferences;
  const { pathname } = useLocation();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(false);
    const timer = window.setTimeout(() => setTimedOut(true), 12000);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  const label = pathname.startsWith('/watch/') ? 'Loading episode…'
    : pathname === '/library' ? 'Loading your library…'
      : ['/catalogue', '/search'].includes(pathname) ? 'Loading catalogue…'
        : 'Loading this view…';
  return (
    <section className="route-readiness" role="status" aria-label="Loading this view">
      <SolanimeBrand variant="emblem" motion={timedOut ? 'error' : 'loading'}
        theme={prefs.theme ?? 'dark'} reducedMotion={prefs.motion === 'reduced'}
        decorative style={{ width: 32 }} />
      <p>{timedOut ? 'This view is taking longer than expected.' : label}</p>
      {timedOut && <div className="route-readiness__actions">
        <button type="button" className="button button--outline" onClick={() => window.location.reload()}>Reload view</button>
        <Link to="/">Go home</Link>
      </div>}
      <div className="route-readiness__lines" aria-hidden="true">
        <i />
        <i />
      </div>
    </section>
  );
}
export default function App() {
  return (
    <AccountProvider>
      <AccountBoundary>
        <Layout>
          <PageErrorBoundary>
            <Suspense fallback={<RouteReadiness />}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/catalogue" element={<CataloguePage />} />
                <Route path="/search" element={<CataloguePage />} />
                <Route path="/title/:slug" element={<TitlePage />} />
                <Route path="/watch/:slug/:episodeId" element={<WatchPage />} />
                <Route path="/library" element={<LibraryPage />} />
                <Route path="/login" element={<AuthPage key="login" />} />
                <Route path="/register" element={<AuthPage key="register" mode="register" />} />
                <Route path="/recover" element={<AuthPage key="recover" mode="recover" />} />
                <Route path="/profiles" element={<ProfilesPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/account/recovery-code" element={<AccountPage recovery />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/admin/sources" element={<AdminSourcesPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </PageErrorBoundary>
        </Layout>
      </AccountBoundary>
    </AccountProvider>
  );
}
