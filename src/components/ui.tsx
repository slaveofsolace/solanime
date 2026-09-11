import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import type { TitleSummary } from '../types';
import { useAppState } from '../state';
import Icon from './Icon';

function Mark() {
  return (
    <svg className="brand-mark" viewBox="0 0 42 42" aria-hidden="true">
      <path d="M6 20.8 21 6l15 14.8L21 36Z" />
      <path d="m13 21 8-8 8 8-8 8Z" />
    </svg>
  );
}

export function Layout({ children }: PropsWithChildren) {
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);
  const { watchlist, preferences } = useAppState();
  const [prefs, setPrefs] = preferences;
  const theme = prefs.theme ?? 'dark';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);
  useEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    main.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location.pathname]);
  const catalogueActive =
    location.pathname.startsWith('/catalogue') || location.pathname.startsWith('/search');
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="masthead">
        <Link className="wordmark" to="/" aria-label="Sol Anime home">
          <Mark />
          <span>
            <strong>sol</strong>
            <em>anime</em>
          </span>
        </Link>
        <nav className="main-nav" aria-label="Primary navigation">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink
            to="/catalogue"
            className={catalogueActive ? 'active' : undefined}
            aria-current={catalogueActive ? 'page' : undefined}
          >
            Catalogue
          </NavLink>
          <NavLink to="/library">
            My list <small>{watchlist.ids.length}</small>
          </NavLink>
        </nav>
        <div className="masthead-actions">
          <button
            className="theme-toggle"
            type="button"
            aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
            onClick={() => setPrefs({ ...prefs, theme: theme === 'dark' ? 'light' : 'dark' })}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <Link className="search-jump" to="/catalogue?focus=search" aria-label="Search catalogue">
            <Icon name="search" />
            <span>Search</span>
          </Link>
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <p>
          <strong>Sol Anime</strong>
          <span>Independent catalogue.</span>
        </p>
        <nav aria-label="Footer navigation">
          <Link to="/catalogue">Browse</Link>
          <Link to="/library">Your list</Link>
          <Link to="/admin">Administration</Link>
        </nav>
      </footer>
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

export function CoverArt({ title, eager = false }: { title: TitleSummary; eager?: boolean }) {
  const src = title.imageUrl ?? title.posterUrl;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return (
      <div
        className="cover-fallback"
        aria-label={`No artwork available for ${title.name ?? title.title}`}
      >
        <span aria-hidden="true">
          {title.name
            ?.split(/\s+/)
            .slice(0, 2)
            .map((word) => word[0])
            .join('') || 'SA'}
        </span>
        <small>Artwork unavailable</small>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width="360"
      height="510"
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailedSrc(src)}
      referrerPolicy="no-referrer"
    />
  );
}

export function TitleCard({ title, index = 0 }: { title: TitleSummary; index?: number }) {
  const { watchlist } = useAppState();
  const name = title.name ?? title.title ?? 'Untitled record';
  const genres = displayGenres(title);
  const isSaved = watchlist.has(title.id);
  return (
    <article className="title-card" style={{ '--index': Math.min(index, 8) } as CSSProperties}>
      <Link
        className="title-card__art"
        to={`/title/${encodeURIComponent(title.slug)}`}
        aria-label={`Open ${name}`}
      >
        <CoverArt title={{ ...title, name }} />
        <span className="title-card__corner">
          <Icon name="play" />
        </span>
      </Link>
      <div className="title-card__copy">
        <div className="title-card__meta">
          <span>{title.type ?? 'Unknown format'}</span>
          <span>{title.releaseYear ?? title.year ?? '—'}</span>
        </div>
        <h2>
          <Link to={`/title/${encodeURIComponent(title.slug)}`}>{name}</Link>
        </h2>
        <p>{genres.slice(0, 3).join(' · ') || title.status || 'Catalogue record'}</p>
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
      </div>
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
