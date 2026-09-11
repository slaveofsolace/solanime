import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TitleCard } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAppState } from '../state';
import type { CatalogueFacets, TitleSummary } from '../types';

function Rail({ title, to, items }: { title: string; to: string; items: TitleSummary[] }) {
  if (!items.length) return null;
  return (
    <section className="home-rail" aria-labelledby={`rail-${title.replace(/\W+/g, '-').toLowerCase()}`}>
      <header className="rail-heading"><h2 id={`rail-${title.replace(/\W+/g, '-').toLowerCase()}`}>{title}</h2><Link to={to}>View all <span aria-hidden="true">→</span></Link></header>
      <div className="rail-track">{items.map((item, index) => <TitleCard key={item.id} title={item} index={index} />)}</div>
    </section>
  );
}

export default function HomePage() {
  const { history, watchlist } = useAppState();
  const [latest, setLatest] = useState<TitleSummary[]>([]);
  const [alphabetical, setAlphabetical] = useState<TitleSummary[]>([]);
  const [facets, setFacets] = useState<CatalogueFacets>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.catalogue({ sort: 'updated', pageSize: 12 }, controller.signal),
      api.catalogue({ sort: 'title', pageSize: 12 }, controller.signal),
      api.filters(controller.signal),
    ]).then(([newest, az, nextFacets]) => {
      setLatest(newest.items);
      setAlphabetical(az.items);
      setFacets(nextFacets);
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    });
    return () => controller.abort();
  }, []);

  return (
    <div className="home-page">
      {history.entries.length > 0 && (
        <section className="continue-section" aria-labelledby="continue-title">
          <header className="rail-heading"><div><p className="eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2 id="continue-title">Continue watching</h2></div><Link to="/library">History <span aria-hidden="true">→</span></Link></header>
          <div className="continue-track">
            {history.entries.slice(0, 8).map((entry) => (
              <article className="continue-card" key={`${entry.episodeId}:${entry.language}`}>
                <Link to={`/watch/${encodeURIComponent(entry.slug)}/${encodeURIComponent(entry.episodeId)}?language=${encodeURIComponent(entry.language)}`}>
                  <span className="continue-card__art">{entry.imageUrl ? <img src={entry.imageUrl} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden="true">SOL</span>}<b aria-hidden="true">▶</b></span>
                  <span className="continue-card__copy"><strong>{entry.title}</strong><small>{entry.episodeLabel} · {entry.language.toUpperCase()}</small></span>
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="home-browse" aria-labelledby="browse-title">
        <div><p className="eyebrow">SYNCHRONIZED CATALOGUE</p><h1 id="browse-title">Browse anime</h1></div>
        <form action="/catalogue" role="search"><label className="sr-only" htmlFor="home-search">Search titles</label><input id="home-search" name="q" type="search" placeholder="Search titles and aliases" /><button type="submit">Search</button></form>
        <nav className="browse-shortcuts" aria-label="Browse shortcuts">
          <Link to="/catalogue?sort=updated">Recently updated</Link><Link to="/catalogue?sort=title">A–Z</Link><Link to="/catalogue?language=dub">Dubbed</Link>
        </nav>
      </section>

      {error && <p className="home-error" role="status">Catalogue rails are temporarily unavailable: {error}</p>}
      <Rail title="Recently synchronized" to="/catalogue?sort=updated" items={latest} />
      <Rail title="My watchlist" to="/library" items={watchlist.items.slice(0, 12)} />

      {(facets.genres?.length ?? 0) > 0 && (
        <section className="genre-section" aria-labelledby="genres-title"><header className="rail-heading"><h2 id="genres-title">Browse by genre</h2><Link to="/catalogue">All filters <span aria-hidden="true">→</span></Link></header><div className="genre-grid">{facets.genres?.slice(0, 12).map((genre) => <Link key={genre.value} to={`/catalogue?genre=${encodeURIComponent(genre.value)}`}><strong>{genre.label}</strong><small>{genre.count?.toLocaleString()} titles</small></Link>)}</div></section>
      )}
      <Rail title="From A–Z" to="/catalogue?sort=title" items={alphabetical} />
    </div>
  );
}
