import { useAccount } from '../account/AccountProvider';
import ProfileMenu from './ProfileMenu';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  useEffect,
  useLayoutEffect,
  lazy,
  Suspense,
  useRef,
  useState,
  type CSSProperties,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import type { TitleSummary } from '../types';
import { useAppState } from '../state';
import Icon from './Icon';
import { applyTheme } from '../lib/theme';
import HeaderSearch from './HeaderSearch';
import CategoryNavigation from './CategoryNavigation';
import SavedTitleActions from './SavedTitleActions';
import { markDialogTrigger } from './Dialog';
import { useRouteMotion } from '../lib/motion';
import { SolanimeBrand } from '../branding';
import { api } from '../lib/api';
import { chooseWatchEntry, watchEntryPath } from '../lib/watchEntry';
const TitlePreview = lazy(() => import('./TitlePreview'));

export function Layout({ children }: PropsWithChildren) {
  const account = useAccount();
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);
  const { watchlist, preferences, preview, setPreview } = useAppState();
  const [prefs] = preferences;
  const theme = prefs.theme ?? 'dark';
  useRouteMotion(main, location.pathname);
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = prefs.motion === 'reduced' ? 'reduced' : 'system';
  }, [prefs.motion]);
  useLayoutEffect(() => {
    applyTheme(prefs.accent, theme);
  }, [prefs.accent, theme]);
  useEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    setPreview(null);
    main.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location.pathname]);
  const focused =
    ['/login', '/register', '/recover', '/profiles', '/account/recovery-code'].includes(
      location.pathname,
    ) ||
    location.pathname === '/admin' ||
    location.pathname.startsWith('/admin/');
  const watching = location.pathname.startsWith('/watch/');
  const home = location.pathname === '/';
  const settings = location.pathname === '/settings';
  const catalogueQuery = new URLSearchParams(location.search);
  const catalogueScope = catalogueQuery.get('scope');
  const onAnimeCatalogue =
    location.pathname === '/catalogue' && catalogueScope === 'anime';
  const onTvCatalogue = location.pathname === '/catalogue' && catalogueScope === 'tv';
  const accountServiceSurface =
    location.pathname === '/login' ||
    location.pathname === '/register' ||
    location.pathname === '/recover' ||
    location.pathname === '/profiles' ||
    location.pathname === '/account' ||
    location.pathname.startsWith('/account/');
  const privateGuest = account.privateSite === true && !account.account;
  // Until the session check succeeds, a private deployment has not yet told
  // the client whether browse controls may be exposed. Avoid a public-nav flash.
  const hideBrowseControls = !account.ready || Boolean(account.loadError) || privateGuest || focused;
  return (
    <div
      className={`site-shell discovery-shell${focused ? ' site-shell--focused' : ''}${watching ? ' site-shell--watch' : ''}${home ? ' site-shell--home' : ''}${settings ? ' site-shell--settings' : ''}${privateGuest ? ' site-shell--private-guest' : ''}`}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="masthead">
        <Link className="wordmark" to={privateGuest ? '/login' : '/'} aria-label={privateGuest ? 'Solanime sign in' : 'Solanime home'}>
          <SolanimeBrand variant="compact" motion="static" theme={theme} decorative className="wordmark__compact" />
          <SolanimeBrand variant="emblem" motion="static" theme={theme} decorative className="wordmark__emblem" />
        </Link>
        {hideBrowseControls ? (
          privateGuest && location.pathname !== '/login' && <Link className="private-guest-signin" to="/login">Sign in</Link>
        ) : <div className="navigation-dock">
        <nav className="main-nav" aria-label="Primary navigation">
          <NavLink to="/" end aria-label="Home">
            <Icon name="home" />
            <span>Home</span>
          </NavLink>
          <Link
            to="/catalogue?scope=anime"
            aria-label="Anime"
            aria-current={onAnimeCatalogue ? 'page' : undefined}
          >
            <Icon name="browse" />
            <span>Anime</span>
          </Link>
          <Link
            className="main-nav__tv"
            to="/catalogue?scope=tv"
            aria-label="TV Shows"
            aria-current={onTvCatalogue ? 'page' : undefined}
          >
            <Icon name="tv" />
            <span>TV</span>
          </Link>
          <CategoryNavigation />
          <NavLink
            to="/library"
            aria-label={`Library / My list, ${watchlist.ids.length} saved`}
          >
            <Icon name="bookmark" />
            <span>My List</span>
            {watchlist.ids.length > 0 && <small aria-hidden="true">{watchlist.ids.length}</small>}
          </NavLink>
        </nav>
        <div className="masthead-actions">
          <HeaderSearch />
          <Link
            to="/settings"
            className="theme-toggle appearance-jump"
            aria-label="Settings"
          >
              <Icon name="settings" />
            <span>Settings</span>
          </Link>
          {account.account ? (
            <ProfileMenu />
          ) : (
            <Link className="account-jump" to="/login" aria-label="Sign in">
              <Icon name="person" />
              <span>Sign in</span>
            </Link>
          )}
        </div>
        </div>}
      </header>
      {!hideBrowseControls && !focused && (
        <nav className="native-tab-bar" aria-label="iPhone navigation">
          <NavLink to="/" end>
            <Icon name="home" />
            <span>Home</span>
          </NavLink>
          <Link
            to="/catalogue?scope=anime"
            aria-current={location.pathname === '/catalogue' || location.pathname === '/search' ? 'page' : undefined}
          >
            <Icon name="browse" />
            <span>Discover</span>
          </Link>
          <NavLink to="/library">
            <Icon name="bookmark" />
            <span>Library</span>
          </NavLink>
          <Link
            to="/account"
            aria-current={location.pathname.startsWith('/account') || location.pathname === '/profiles' || location.pathname === '/settings' ? 'page' : undefined}
          >
            <Icon name="person" />
            <span>Account</span>
          </Link>
        </nav>
      )}
      <div className="content-shell">
        {account.loadError && accountServiceSurface && (
          <div className="account-service-notice" role="status">
            {account.privateSite ? 'Couldn’t check your sign-in.' : 'Sign-in is unavailable. You can still browse.'}{' '}
            <button className="text-button" onClick={() => void account.refresh()}>
              Retry
            </button>
          </div>
        )}
        {account.syncError && (
          <div className="account-service-notice" role="alert">
            Couldn’t save your profile changes: {account.syncError}
          </div>
        )}
        <main id="main" ref={main} tabIndex={-1}>
          {children}
        </main>
        <footer className="site-footer">
          {/* The release stays in the page's solanime-release meta tag for support, not the footer. */}
          <p>Solanime</p>
          {!hideBrowseControls && <nav aria-label="Footer navigation">
            <Link to="/catalogue?scope=anime">Anime</Link>
            <Link to="/catalogue?scope=tv">TV Shows</Link>
            <Link to="/settings">Settings</Link>
            <Link to="/library">My List</Link>
            {account.account ? <Link to="/profiles">Profiles</Link> : <Link to="/login">Sign in</Link>}
          </nav>}
        </footer>
      </div>
      {preview && (
        <Suspense fallback={null}>
          <TitlePreview title={preview} onClose={() => setPreview(null)} />
        </Suspense>
      )}
    </div>
  );
}

export function StatusPanel({
  eyebrow,
  title,
  children,
  action,
  busy = false,
}: PropsWithChildren<{ eyebrow: string; title: string; action?: ReactNode; busy?: boolean }>) {
  return (
    <section className="status-panel" aria-live="polite" aria-busy={busy}>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      <div className="status-panel__copy">{children}</div>
      {action}
    </section>
  );
}

function displayGenres(title: TitleSummary): string[] {
  return (title.genres ?? []).map((genre) => (typeof genre === 'string' ? genre : genre.name));
}

export function CoverArt({
  title,
  eager = false,
  variant = 'poster',
}: {
  title: TitleSummary;
  eager?: boolean;
  variant?: 'poster' | 'landscape';
}) {
  const posterSources = [title.posterUrl, title.imageUrl].filter(
    (source, index, sources): source is string =>
      Boolean(source) && sources.indexOf(source) === index,
  );
  const backdropSrc = variant === 'landscape' ? title.backdropUrl : null;
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [landscapeSources, setLandscapeSources] = useState<string[]>([]);
  const usablePoster = posterSources.find((source) => !failedSources.includes(source)) ?? null;
  const usableBackdrop = backdropSrc && !failedSources.includes(backdropSrc) ? backdropSrc : null;
  const src = variant === 'landscape' ? usableBackdrop : usablePoster;
  const measuredPoster = title.artwork?.poster?.url === usablePoster ? title.artwork.poster : null;
  const posterIsLandscape = Boolean(
    usablePoster &&
      (landscapeSources.includes(usablePoster) ||
        (measuredPoster && measuredPoster.width / measuredPoster.height >= 1.45)),
  );
  const markFailed = (failed: string) =>
    setFailedSources((current) => (current.includes(failed) ? current : [...current, failed]));
  const recordShape = (image: HTMLImageElement, source: string) => {
    if (image.naturalWidth / Math.max(1, image.naturalHeight) < 1.45) return;
    setLandscapeSources((current) =>
      current.includes(source) ? current : [...current, source],
    );
  };
  if (variant === 'landscape' && !usableBackdrop && usablePoster) {
    if (posterIsLandscape) {
      return (
        <span className="cover-composition cover-composition--landscape-fallback" data-artwork-source="landscape-fallback">
          <img
            className="cover-composition__crop"
            src={usablePoster}
            alt=""
            width="640"
            height="360"
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            onLoad={(event) => recordShape(event.currentTarget, usablePoster)}
            onError={() => markFailed(usablePoster)}
            referrerPolicy="no-referrer"
          />
        </span>
      );
    }
    return (
      <span className="cover-composition cover-composition--poster-layout" data-artwork-source="poster-layout">
        <img
          className="cover-composition__wash"
          src={usablePoster}
          alt=""
          width="640"
          height="360"
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={(event) => recordShape(event.currentTarget, usablePoster)}
          onError={() => markFailed(usablePoster)}
          referrerPolicy="no-referrer"
        />
        <img
          className="cover-composition__poster"
          src={usablePoster}
          alt=""
          width="360"
          height="510"
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={(event) => recordShape(event.currentTarget, usablePoster)}
          onError={() => markFailed(usablePoster)}
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }
  if (!src) {
    return (
      <div
        className="cover-fallback"
        aria-label={`No artwork available for ${title.name ?? title.title}`}
      >
        <span className="cover-fallback__brand" aria-hidden="true">Solanime</span>
        <strong className="cover-fallback__title" aria-hidden="true">{title.name ?? title.title}</strong>
        {title.releaseYear && <small aria-hidden="true">{title.releaseYear}</small>}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={variant === 'landscape' ? '640' : '360'}
      height={variant === 'landscape' ? '360' : '510'}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => markFailed(src)}
      referrerPolicy="no-referrer"
    />
  );
}

export function TitleCard({ title, index = 0, format = 'poster', contextual = false }: { title: TitleSummary; index?: number; format?: 'poster' | 'landscape'; contextual?: boolean }) {
  const { watchlist, history, watched, preferences, setPreview } = useAppState();
  const [preference] = preferences;
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  const openRequest = useRef<AbortController | null>(null);
  useEffect(() => () => openRequest.current?.abort(), []);
  const openWatch = async () => {
    if (openRequest.current) return;
    const controller = new AbortController();
    openRequest.current = controller;
    setOpening(true);
    try {
      const detail = await api.title(title.slug, controller.signal);
      if (controller.signal.aborted) return;
      const entry = chooseWatchEntry(title.id, detail.episodes, history.entries, preference.preferredLanguage, watched.isWatched);
      navigate(entry ? watchEntryPath(title.slug, entry) : `/title/${encodeURIComponent(title.slug)}`);
    } catch {
      if (!controller.signal.aborted) navigate(`/title/${encodeURIComponent(title.slug)}`);
    } finally {
      if (!controller.signal.aborted) setOpening(false);
      openRequest.current = null;
    }
  };
  const name = title.name ?? title.title ?? 'Untitled';
  const genres = displayGenres(title);
  const isSaved = watchlist.has(title.id);
  const facts = [title.type, title.releaseYear ?? title.year].filter(
    (fact): fact is string | number => fact !== null && fact !== undefined && fact !== '',
  );
  const descriptor = genres.slice(0, 3).join(' · ') || title.status || null;
  const languages = (title.languages ?? []).map(value => value === 'sub' ? 'Sub' : value === 'dub' ? 'Dub' : value).join(' | ');
  return (
    <article className={`title-card title-card--${format}${contextual ? ' title-card--contextual' : ''}`} style={{ '--index': Math.min(index, 8) } as CSSProperties}>
      <Link
        className="title-card__art"
        to={`/title/${encodeURIComponent(title.slug)}`}
        aria-label={`Open ${name}`}
      >
        <CoverArt title={{ ...title, name }} variant={format} />
      </Link>
      <div className="title-card__copy">
        <h2>
          <Link to={`/title/${encodeURIComponent(title.slug)}`}>{name}</Link>
        </h2>
        <p className="title-card__availability">{languages || facts.join(' · ')}</p>
        <div className="title-card__details">
          {languages && facts.length > 0 && (
            <div className="title-card__meta">
              {facts.map((fact) => <span key={fact}>{fact}</span>)}
            </div>
          )}
          {descriptor && <p>{descriptor}</p>}
          {title.synopsis && <p className="title-card__synopsis">{title.synopsis.replace(/\s*\[more\]\s*$/i, '')}</p>}
        </div>
        <div className="title-card__actions" hidden={contextual}>
            <button className="card-open" type="button" aria-label={`Start or continue ${name}`} aria-busy={opening} disabled={opening} onClick={() => void openWatch()}>
              <Icon name="play" />
            </button>
            <button
              className="save-button"
              type="button"
              aria-pressed={isSaved}
              aria-label={`${isSaved ? 'Remove' : 'Save'} ${name}${isSaved ? ' from your list' : ' to your list'}`}
              onClick={() => watchlist.toggle(title.id, { ...title, name })}
            >
              <Icon name={isSaved ? 'check' : 'bookmark'} />
              {isSaved ? 'Saved' : 'Save'}
            </button>
            <button
              className="card-info"
              type="button"
              aria-label={`Quick look at ${name}`}
              onClick={(event) => {
                markDialogTrigger(event.currentTarget);
                setPreview(title);
              }}
            >
              <Icon name="info" />
            </button>
        </div>
      </div>
      {contextual && <SavedTitleActions title={title} opening={opening} onPlay={() => void openWatch()} />}
    </article>
  );
}

export function PageIntro({
  code,
  title,
  copy,
  aside,
}: {
  code: string;
  title: string;
  copy?: string;
  aside?: ReactNode;
}) {
  return (
    <header className="page-intro">
      <div>
        {code && <p className="eyebrow">{code}</p>}
        <h1>{title}</h1>
        {copy && <p className="page-intro__copy">{copy}</p>}
      </div>
      {aside && <div className="page-intro__aside">{aside}</div>}
    </header>
  );
}

export function Pager({
  current,
  pages,
  onPage,
}: {
  current: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  const start = Math.max(1, Math.min(current - 2, pages - 4));
  const pageNumbers = Array.from({ length: Math.min(5, pages) }, (_, index) => start + index);
  return (
    <nav className="pager" aria-label="Catalogue pages">
      <button type="button" disabled={current <= 1} onClick={() => onPage(current - 1)}>
        ← Previous
      </button>
      <div>
        {pageNumbers.map((page) => (
          <button
            type="button"
            key={page}
            aria-current={page === current ? 'page' : undefined}
            onClick={() => onPage(page)}
          >
            {page}
          </button>
        ))}
      </div>
      <button type="button" disabled={current >= pages} onClick={() => onPage(current + 1)}>
        Next →
      </button>
    </nav>
  );
}

export function InlineNotice({
  tone = 'quiet',
  children,
}: PropsWithChildren<{ tone?: 'quiet' | 'warning' | 'error' }>) {
  return (
    <div
      className={`inline-notice inline-notice--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
