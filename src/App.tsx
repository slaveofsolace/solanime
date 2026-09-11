import { Route, Routes } from 'react-router-dom';
import { AppStateProvider } from './state';
import { Layout, StatusPanel } from './components/ui';
import CataloguePage from './pages/CataloguePage';
import LibraryPage from './pages/LibraryPage';
import TitlePage from './pages/TitlePage';
import WatchPage from './pages/WatchPage';
import AdminPage from './pages/AdminPage';
import HomePage from './pages/HomePage';

function NotFound() {
  return <StatusPanel eyebrow="404 / LOST SIGNAL" title="That route is not in the archive."><p>Use the catalogue navigation to find an imported title.</p></StatusPanel>;
}

export default function App() {
  return (
    <AppStateProvider>
      <Layout>
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
      </Layout>
    </AppStateProvider>
  );
}
