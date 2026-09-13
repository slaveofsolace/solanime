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
  const kind = pathname.startsWith('/watch/') ? 'watch'
    : pathname.startsWith('/title/') ? 'title'
      : pathname === '/library' ? 'library'
        : ['/catalogue', '/search'].includes(pathname) ? 'catalogue'
          : pathname.startsWith('/account') || pathname === '/profiles' ? 'account'
            : 'default';
  const label = kind === 'watch' ? 'Preparing this episode…'
    : kind === 'title' ? 'Opening title…'
      : kind === 'library' ? 'Opening your library…'
        : kind === 'catalogue' ? 'Loading catalogue…'
          : kind === 'account' ? 'Opening your profile…'
            : 'Loading this view…';
  const placeholders = kind === 'watch' ? 5 : kind === 'title' ? 6 : 12;
  return (
    <section className="route-readiness" data-route-kind={kind} role="status" aria-label={label}>
      <div className="route-readiness__status">
        <SolanimeBrand variant="emblem" motion={timedOut ? 'error' : 'loading'}
          theme={prefs.theme ?? 'dark'} reducedMotion={prefs.motion === 'reduced'}
          decorative style={{ width: 30 }} />
        <p>{timedOut ? 'This view is taking longer than expected.' : label}</p>
        {timedOut && <div className="route-readiness__actions">
          <button type="button" className="button button--outline" onClick={() => window.location.reload()}>Reload view</button>
          <Link to="/">Go home</Link>
        </div>}
      </div>
      <div className="route-readiness__scene" aria-hidden="true">
        <div className="route-readiness__feature">
          <i className="route-readiness__wash" />
          <div className="route-readiness__copy">
            <i />
            <i />
            <i />
            <span><b /><b /></span>
          </div>
          {kind === 'watch' && <div className="route-readiness__transport"><i /><i /><i /></div>}
        </div>
        <div className="route-readiness__rail">
          {Array.from({ length: placeholders }, (_, index) => <i key={index} />)}
        </div>
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
