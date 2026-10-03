import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { AccountProvider } from './account/AccountProvider';
import AccountBoundary from './account/AccountBoundary';
import RequireAccount from './account/RequireAccount';
import PrivateSiteRoute from './account/PrivateSiteRoute';
import ApplicationReadiness from './branding/ApplicationReadiness';
import { Layout, StatusPanel } from './components/ui';
import PageErrorBoundary from './components/ErrorBoundary';
import HomePage from './pages/HomePage';
import { SolanimeBrand } from './branding';
import { useAppState } from './state';
const loadCatalogue = () => import('./pages/CataloguePage');
const loadLibrary = () => import('./pages/LibraryPage');
const loadTitle = () => import('./pages/TitlePage');
const loadWatch = () => import('./pages/WatchPage');
const loadSettings = () => import('./pages/SettingsPage');
const CataloguePage = lazy(loadCatalogue);
const LibraryPage = lazy(loadLibrary);
const TitlePage = lazy(loadTitle);
const WatchPage = lazy(loadWatch);
const AdminPage = lazy(() => import('./pages/AdminPage'));
const AdminSourcesPage = lazy(() => import('./pages/AdminSourcesPage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));
const ProfilesPage = lazy(() => import('./pages/ProfilesPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const SettingsPage = lazy(loadSettings);
const ExplorePage = lazy(() => import('./pages/ExplorePage'));
/** Fetch the everyday screens once the app is idle, so first visits don't flash a loader. */
function usePreloadedScreens() {
  useEffect(() => {
    const load = () => { for (const screen of [loadTitle, loadWatch, loadCatalogue, loadLibrary, loadSettings]) void screen().catch(() => {}); };
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 1200));
    const handle = idle(load);
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(handle as number);
  }, []);
}
const MalCallbackPage = lazy(() => import('./components/MyAnimeListConnection').then(module => ({ default: module.MalCallbackPage })));
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
        : pathname === '/explore' ? 'explore'
        : ['/catalogue', '/search'].includes(pathname) ? 'catalogue'
          : pathname.startsWith('/account') || pathname === '/profiles' ? 'account'
            : 'default';
  const label = kind === 'watch' ? 'Preparing this episode…'
    : kind === 'title' ? 'Opening title…'
      : kind === 'library' ? 'Opening your library…'
        : kind === 'explore' ? 'Opening Explore…'
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
  usePreloadedScreens();
  return (
    <AccountProvider>
      <AccountBoundary>
        <ApplicationReadiness>
        <Layout>
          <PageErrorBoundary>
            <Suspense fallback={<RouteReadiness />}>
              <Routes>
                <Route path="/" element={<PrivateSiteRoute><HomePage /></PrivateSiteRoute>} />
                <Route path="/catalogue" element={<PrivateSiteRoute><CataloguePage /></PrivateSiteRoute>} />
                <Route path="/search" element={<PrivateSiteRoute><CataloguePage /></PrivateSiteRoute>} />
                <Route path="/title/:slug" element={<PrivateSiteRoute><TitlePage /></PrivateSiteRoute>} />
                <Route path="/watch/:slug/:episodeId" element={<PrivateSiteRoute><WatchPage /></PrivateSiteRoute>} />
                <Route path="/library" element={<RequireAccount><LibraryPage /></RequireAccount>} />
                <Route path="/explore" element={<RequireAccount><ExplorePage /></RequireAccount>} />
                <Route path="/settings" element={<RequireAccount><SettingsPage /></RequireAccount>} />
                <Route path="/settings/mal/callback" element={<MalCallbackPage />} />
                <Route path="/login" element={<AuthPage key="login" />} />
                <Route path="/register" element={<AuthPage key="register" mode="register" />} />
                <Route path="/recover" element={<AuthPage key="recover" mode="recover" />} />
                <Route path="/profiles" element={<RequireAccount profile={false}><ProfilesPage /></RequireAccount>} />
                <Route path="/account" element={<RequireAccount profile={false}><AccountPage /></RequireAccount>} />
                <Route path="/account/recovery-code" element={<RequireAccount profile={false}><AccountPage recovery /></RequireAccount>} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/admin/sources" element={<PrivateSiteRoute><AdminSourcesPage /></PrivateSiteRoute>} />
                <Route path="*" element={<PrivateSiteRoute><NotFound /></PrivateSiteRoute>} />
              </Routes>
            </Suspense>
          </PageErrorBoundary>
        </Layout>
        </ApplicationReadiness>
      </AccountBoundary>
    </AccountProvider>
  );
}
