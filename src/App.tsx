import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { AppStateProvider } from './state';
import { Layout, StatusPanel } from './components/ui';
import PageErrorBoundary from './components/ErrorBoundary';
import HomePage from './pages/HomePage';
const CataloguePage = lazy(() => import('./pages/CataloguePage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const TitlePage = lazy(() => import('./pages/TitlePage'));
const WatchPage = lazy(() => import('./pages/WatchPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
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
export default function App() {
  return (
    <PageErrorBoundary>
      <AppStateProvider>
        <Layout>
          <Suspense fallback={<StatusPanel eyebrow="" title="Loading…" busy />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/catalogue" element={<CataloguePage />} />
              <Route path="/search" element={<CataloguePage />} />
              <Route path="/title/:slug" element={<TitlePage />} />
              <Route path="/watch/:slug/:episodeId" element={<WatchPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </Layout>
      </AppStateProvider>
    </PageErrorBoundary>
  );
}
