from pathlib import Path
R=Path.cwd()
def w(path,text):
 p=R/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text.strip()+'\n')
def r(path,old,new):
 p=R/path;s=p.read_text();assert old in s,(path,old[:80]);p.write_text(s.replace(old,new))
p=R/'src/components/PlayerSurface.tsx';s=p.read_text().replace('  onStateChange,','  onStateChange,\n  onOpen,\n  onEnded,').replace('  onStateChange?: (state: PlayerState, detail?: string) => void;','  onStateChange?: (state: PlayerState, detail?: string) => void;\n  onOpen?: () => void;\n  onEnded?: () => void;')
s=s.replace('  const videoRef = useRef<HTMLVideoElement>(null);','''  const videoRef = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onStateChange, onOpen, onEnded }); callbacks.current = { onStateChange, onOpen, onEnded };
  const opened = useRef(false);
  const markOpen = () => { if (!opened.current) { opened.current = true; callbacks.current.onOpen?.(); } };''')
s=s.replace("  const sourceUrl = resolution.url ?? resolution.embedUrl ?? '';",'''  const inputUrl = resolution.url ?? resolution.embedUrl ?? '';
  let sourceUrl = '';
  try { const parsed = new URL(inputUrl, window.location.origin); if (inputUrl && !parsed.username && !parsed.password && (parsed.protocol === 'https:' || parsed.origin === window.location.origin)) sourceUrl = parsed.href; } catch { /* Invalid URLs are never assigned to media elements. */ }''')
s=s.replace('    onStateChange?.(next, message);','    callbacks.current.onStateChange?.(next, message);').replace('    setIframeEnabled(false);','    opened.current = false;\n    setIframeEnabled(false);')
s=s.replace("    const playing = () => update('playing', 'Playback started.');","    const playing = () => { markOpen(); update('playing', 'Playback started.'); };\n    const ended = () => { if (rememberProgress) writeProgress(episodeId, language, progressScope, 0); callbacks.current.onEnded?.(); };")
s=s.replace("    video.addEventListener('timeupdate', remember);","    video.addEventListener('timeupdate', remember);\n    video.addEventListener('ended', ended);").replace("      video.removeEventListener('timeupdate', remember);","      video.removeEventListener('timeupdate', remember);\n      video.removeEventListener('ended', ended);")
s=s.replace('if (rememberProgress && video.currentTime > 0)','if (rememberProgress && !video.ended && video.currentTime > 0)').replace("resolution.playbackType === 'external') return;","!['hls', 'dash', 'direct'].includes(resolution.playbackType)) return;")
s=s.replace('  if (!sourceUrl) {',"  if (!sourceUrl || !['iframe', 'external', 'hls', 'dash', 'direct'].includes(resolution.playbackType)) {")
s=s.replace('This provider requires its normal unsandboxed embed. It will load only after you choose Play here.','This opens a third-party player. Its cookies, advertising, and playback controls are managed by the provider.').replace('                setIframeEnabled(true);','                markOpen();\n                setIframeEnabled(true);')
s=s.replace('Provider player loaded inside SolAnime. Start playback to verify the media.','Player frame loaded. Playback is controlled by the provider; a loaded frame does not confirm that the video is available.').replace('Select another server. No substitute media will be shown under this provider’s label.','Select another server. This source does not have a supported playback address.');p.write_text(s)
w('src/App.tsx','''import { lazy, Suspense } from 'react';
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
function NotFound() { return <StatusPanel eyebrow="404" title="Page not found" action={<Link className="button button--primary" to="/catalogue">Browse catalogue</Link>}><p>This address is not part of the catalogue.</p></StatusPanel>; }
export default function App() {
  return <PageErrorBoundary><AppStateProvider><Layout><Suspense fallback={<StatusPanel eyebrow="" title="Loading…" busy />}><Routes>
    <Route path="/" element={<HomePage />} /><Route path="/catalogue" element={<CataloguePage />} /><Route path="/search" element={<CataloguePage />} /><Route path="/title/:slug" element={<TitlePage />} /><Route path="/watch/:slug/:episodeId" element={<WatchPage />} /><Route path="/library" element={<LibraryPage />} /><Route path="/admin" element={<AdminPage />} /><Route path="*" element={<NotFound />} />
  </Routes></Suspense></Layout></AppStateProvider></PageErrorBoundary>;
}''')
w('src/components/Icon.tsx','''import type { SVGProps } from 'react';
type Name = 'search' | 'sun' | 'moon' | 'arrow' | 'bookmark' | 'check' | 'play';
const paths: Record<Name, string> = {
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z', arrow: 'M4 12h16m-6-6 6 6-6 6', bookmark: 'M6 3h12v18l-6-4-6 4V3Z', check: 'm5 12 4 4 10-10', play: 'm8 4 12 8-12 8V4Z',
};
export default function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: Name }) {
  return <svg {...props} className={`icon ${props.className ?? ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}''')
r('src/components/ui.tsx','useEffect, useRef, type CSSProperties','useEffect, useRef, useState, type CSSProperties')
r('src/components/ui.tsx',"import { useAppState } from '../state';","import { useAppState } from '../state';\nimport Icon from './Icon';")
r('src/components/ui.tsx','    main.current?.focus({ preventScroll: true });',"    main.current?.focus({ preventScroll: true });\n    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });")
r('src/components/ui.tsx',"<NavLink to=\"/catalogue\" aria-current={catalogueActive ? 'page' : undefined}>","<NavLink to=\"/catalogue\" className={catalogueActive ? 'active' : undefined} aria-current={catalogueActive ? 'page' : undefined}>")
r('src/components/ui.tsx',"{theme === 'dark' ? '☼' : '◐'}</button>","<Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>")
r('src/components/ui.tsx','<span aria-hidden="true">⌕</span><span>Search</span>','<Icon name="search" /><span>Search</span>')
r('src/components/ui.tsx','<p><strong>Sol Anime</strong> / independent catalogue interface</p>','<p><strong>Sol Anime</strong><span>Independent catalogue.</span></p>')
r('src/components/ui.tsx','<p>Public records are synchronized from their cited sources. Availability can change. <Link to="/admin">Import diagnostics</Link></p>','<nav aria-label="Footer navigation"><Link to="/catalogue">Browse</Link><Link to="/library">Your list</Link><Link to="/admin">Administration</Link></nav>')
r('src/components/ui.tsx','<p className="eyebrow">{eyebrow}</p>','{eyebrow && <p className="eyebrow">{eyebrow}</p>}')
r('src/components/ui.tsx',"  const src = title.imageUrl ?? title.posterUrl;\n  if (!src) {","  const src = title.imageUrl ?? title.posterUrl;\n  const [failedSrc, setFailedSrc] = useState<string | null>(null);\n  if (!src || failedSrc === src) {")
r('src/components/ui.tsx','>SOL<br />ARCHIVE</div>',r'''><span aria-hidden="true">{title.name?.split(/\s+/).slice(0, 2).map((word) => word[0]).join('') || 'SA'}</span><small>Artwork unavailable</small></div>''')
r('src/components/ui.tsx','      decoding="async"','      decoding="async"\n      onError={() => setFailedSrc(src)}')
r('src/components/ui.tsx','<span className="title-card__corner" aria-hidden="true">↗</span>','<span className="title-card__corner"><Icon name="play" /></span>')
r('src/components/ui.tsx',"<span aria-hidden=\"true\">{isSaved ? '−' : '+'}</span>{isSaved ? 'Saved' : 'Watchlist'}","<Icon name={isSaved ? 'check' : 'bookmark'} />{isSaved ? 'Saved' : 'Save'}")
r('src/components/ui.tsx','          aria-pressed={isSaved}',"          aria-pressed={isSaved}\n          aria-label={`${isSaved ? 'Remove' : 'Save'} ${name}${isSaved ? ' from your list' : ' to your list'}`}")
r('src/components/ui.tsx','<p className="eyebrow">{code}</p>','{code && <p className="eyebrow">{code}</p>}')
w('src/pages/HomePage.tsx',r'''import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CoverArt, InlineNotice, TitleCard } from '../components/ui';
import Icon from '../components/Icon';
import { api, errorMessage } from '../lib/api';
import { useAppState } from '../state';
import type { CatalogueFacets, TitleSummary } from '../types';
function Rail({ title, to, items }: { title: string; to: string; items: TitleSummary[] }) {
  if (!items.length) return null;
  const id = `rail-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return <section className="home-rail" aria-labelledby={id}><header className="rail-heading"><h2 id={id}>{title}</h2><Link to={to}>View all <Icon name="arrow" /></Link></header><div className="rail-track">{items.map((item) => <TitleCard key={item.id} title={item} />)}</div></section>;
}
export default function HomePage() {
  const { history, watchlist } = useAppState(); const navigate = useNavigate();
  const [latest, setLatest] = useState<TitleSummary[]>([]); const [movies, setMovies] = useState<TitleSummary[]>([]); const [facets, setFacets] = useState<CatalogueFacets>({});
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    void Promise.allSettled([api.catalogue({ sort: 'updated', pageSize: 13 }, controller.signal), api.catalogue({ type: 'movie', sort: 'year_desc', pageSize: 12 }, controller.signal), api.filters(controller.signal)]).then(([recent, films, filters]) => {
      if (controller.signal.aborted) return;
      if (recent.status === 'fulfilled') setLatest(recent.value.items); else setError(errorMessage(recent.reason));
      if (films.status === 'fulfilled') setMovies(films.value.items); if (filters.status === 'fulfilled') setFacets(filters.value); setLoading(false);
    });
    return () => controller.abort();
  }, [retry]);
  const featured = latest[0];
  return <div className="home-page">
    <header className="home-heading"><div><h1>Explore anime</h1><p>A new story, or the next episode of a favourite.</p></div><form className="home-search" role="search" onSubmit={(event) => { event.preventDefault(); const query = new FormData(event.currentTarget).get('q'); navigate(`/catalogue?q=${encodeURIComponent(String(query ?? '').trim())}`); }}><label className="sr-only" htmlFor="home-search">Search titles</label><Icon name="search" /><input id="home-search" name="q" type="search" maxLength={200} placeholder="Search titles and aliases" /><button type="submit">Search</button></form></header>
    {error && <InlineNotice tone="error"><strong>Catalogue unavailable.</strong> {error}<button className="text-button" type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></InlineNotice>}
    {loading ? <section className="home-loading" aria-busy="true" aria-label="Loading catalogue"><div className="skeleton-feature" /><span className="sr-only">Loading catalogue…</span></section> : featured ? <section className="home-feature" aria-labelledby="featured-title"><div className="home-feature__copy"><p className="feature-caption">Recently updated</p><h2 id="featured-title">{featured.name}</h2><p className="feature-meta">{[featured.type, featured.releaseYear, featured.episodeCount ? `${featured.episodeCount} episodes` : null].filter(Boolean).join(' · ')}</p><p className="feature-synopsis">{featured.synopsis || 'Explore the episode list and available language versions.'}</p><div className="button-row"><Link className="button button--primary" to={`/title/${encodeURIComponent(featured.slug)}`}>View episodes <Icon name="arrow" /></Link><button className="button button--outline" type="button" aria-pressed={watchlist.has(featured.id)} onClick={() => watchlist.toggle(featured.id, featured)}><Icon name={watchlist.has(featured.id) ? 'check' : 'bookmark'} />{watchlist.has(featured.id) ? 'Saved to your list' : 'Save for later'}</button></div></div><Link className="home-feature__art" to={`/title/${encodeURIComponent(featured.slug)}`} aria-label={`Open ${featured.name}`}><CoverArt title={featured} eager /></Link></section> : !error ? <InlineNotice>No titles have been imported yet. Saved titles remain available in your list.</InlineNotice> : null}
    <nav className="browse-shortcuts" aria-label="Browse shortcuts"><Link to="/catalogue?sort=updated">Recently updated</Link><Link to="/catalogue?sort=title">Browse A–Z</Link><Link to="/catalogue?language=dub">Dubbed</Link><Link to="/catalogue?type=movie">Films</Link><Link to="/catalogue">All titles <Icon name="arrow" /></Link></nav>
    {history.entries.length > 0 && <section className="continue-section" aria-labelledby="continue-title"><header className="rail-heading"><h2 id="continue-title">Jump back in</h2><Link to="/library">Your history <Icon name="arrow" /></Link></header><div className="continue-track">{history.entries.slice(0, 8).map((entry) => <article className="continue-card" key={`${entry.episodeId}:${entry.language}`}><Link to={`/watch/${encodeURIComponent(entry.slug)}/${encodeURIComponent(entry.episodeId)}?language=${encodeURIComponent(entry.language)}`}><span className="continue-card__art"><CoverArt title={{ id: entry.titleId, slug: entry.slug, name: entry.title, imageUrl: entry.imageUrl }} /><Icon name="play" /></span><span className="continue-card__copy"><strong>{entry.title}</strong><small>{entry.episodeLabel} · {entry.language.toUpperCase()}</small></span></Link></article>)}</div></section>}
    <Rail title="Recent updates" to="/catalogue?sort=updated" items={latest.slice(1)} /><Rail title="Saved for later" to="/library" items={watchlist.items.slice(0, 12)} />
    {(facets.genres?.length ?? 0) > 0 && <section className="genre-section" aria-labelledby="genres-title"><header className="rail-heading"><h2 id="genres-title">Find your genre</h2><Link to="/catalogue">All genres <Icon name="arrow" /></Link></header><div className="genre-grid">{[...(facets.genres ?? [])].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 8).map((genre) => <Link key={genre.value} to={`/catalogue?genre=${encodeURIComponent(genre.value)}`}><strong>{genre.label}</strong><small>{genre.count?.toLocaleString()} titles</small><Icon name="arrow" /></Link>)}</div></section>}
    <Rail title="Films" to="/catalogue?type=movie&sort=year_desc" items={movies} />
  </div>;
}''')
r('src/pages/TitlePage.tsx','export default function TitlePage() {',"export default function TitlePage() {\n  const { slug = '' } = useParams();\n  return <TitleSession key={slug} />;\n}\n\nfunction TitleSession() {")
r('src/pages/TitlePage.tsx','      .then((result) => {\n        const merged','      .then((result) => {\n        if (controller.signal.aborted) return;\n        const merged')
r('src/pages/TitlePage.tsx','entry.titleId === title.id && episodes.some','entry.titleId === title.id && entry.language === language && episodes.some')
r('src/pages/TitlePage.tsx','<h2 id="episodes-title">Watch order</h2>','<h2 id="episodes-title">Episodes</h2>')
r('src/pages/TitlePage.tsx','<h2 id="related-title">Keep the thread</h2>','<h2 id="related-title">Related titles</h2>')
r('src/pages/TitlePage.tsx','{visibleEpisodes.length} of {episodes.length} episodes','{visibleEpisodes.length} of {languageEpisodes.length} episodes')
r('src/pages/LibraryPage.tsx','Reserved for verified compatible sources.','Moves to the next episode when a supported direct player finishes. Third-party frames cannot report completion.')
r('src/pages/LibraryPage.tsx','<h2 id="history-title">Continue watching</h2>','<h2 id="history-title">Recently opened</h2>')
r('src/pages/AdminPage.tsx',"const SESSION_KEY = 'sol-anime:admin-token';",'''const SESSION_KEY = 'sol-anime:admin-token';
function readToken() { try { return sessionStorage.getItem(SESSION_KEY) ?? ''; } catch { return ''; } }
function storeToken(value: string) { try { if (value) sessionStorage.setItem(SESSION_KEY, value); else sessionStorage.removeItem(SESSION_KEY); } catch { /* This session can still be used without persistence. */ } }''')
r('src/pages/AdminPage.tsx',"useState(() => sessionStorage.getItem(SESSION_KEY) ?? '')",'useState(readToken)')
r('src/pages/AdminPage.tsx','sessionStorage.setItem(SESSION_KEY, next);','storeToken(next);')
r('src/pages/AdminPage.tsx','sessionStorage.removeItem(SESSION_KEY); setToken',"storeToken(''); setToken")
r('src/pages/AdminPage.tsx','<a className="button button--outline" href="/api/exports/coverage.csv" download>Download coverage CSV</a>', '''<button className="button button--outline" type="button" disabled={busy} onClick={async () => {
  setBusy(true); setError(null);
  try { const response = await fetch('/api/exports/coverage.csv', { headers: { 'x-admin-token': token } }); if (!response.ok || !response.headers.get('content-type')?.includes('text/csv')) throw new Error('The coverage export could not be downloaded.'); const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = 'coverage.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
}}>Download coverage CSV</button>''')
