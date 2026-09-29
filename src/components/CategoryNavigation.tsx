import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import type { FacetOption } from '../types';
import Icon from './Icon';

export default function CategoryNavigation() {
  const [open, setOpen] = useState(false);
  const [genres, setGenres] = useState<FacetOption[]>([]);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const featuredGenres = [...genres].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 6);
  useEffect(() => setOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    if (!loaded) {
      setFailed(false);
      void api.filters(controller.signal).then(data => {
        if (!controller.signal.aborted) { setGenres(data.genres ?? []); setLoaded(true); }
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    }
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => { controller.abort(); document.removeEventListener('pointerdown', closeOutside); };
  }, [open]);
  return <div className="category-navigation" ref={root}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    }}>
    <button ref={trigger} type="button" className="category-navigation__trigger"
      aria-expanded={open} aria-controls={open ? 'browse-categories' : undefined} onClick={() => setOpen(value => !value)}>
      Categories <Icon name="right" />
    </button>
    {open && <div className="category-navigation__panel" id="browse-categories">
      <div className="category-navigation__collections">
        <Link to="/catalogue?scope=anime&sort=title">All anime A–Z</Link>
        <Link to="/catalogue?scope=anime&sort=updated">Recently updated</Link>
        <Link to="/catalogue?scope=anime&language=dub">Dubbed anime</Link>
      </div>
      <div className="category-navigation__genres">
        <p>Explore genres</p>
        <div>{featuredGenres.map(genre => <Link key={genre.value}
          to={`/catalogue?scope=anime&genre=${encodeURIComponent(genre.value)}`}>{genre.label}</Link>)}</div>
        {!genres.length && <span role="status">{failed ? 'Browse all anime to filter by genre.' : loaded ? 'No genres available.' : 'Loading genres…'}</span>}
        {genres.length > 0 && <Link className="category-navigation__all" to="/catalogue?scope=anime&filters=genres">All genres <Icon name="arrow" /></Link>}
      </div>
    </div>}
  </div>;
}
