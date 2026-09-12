import FeatureSpotlight from '../components/FeatureSpotlight';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Rail from '../components/CatalogueRail';
import { CoverArt, InlineNotice } from '../components/ui';
import Icon from '../components/Icon';
import { api, errorMessage } from '../lib/api';
import { useAppState } from '../state';
import type { CatalogueFacets, TitleSummary } from '../types';
export default function HomePage() {
  const { history, watchlist } = useAppState();
  const [latest, setLatest] = useState<TitleSummary[]>([]);
  const [movies, setMovies] = useState<TitleSummary[]>([]);
  const [facets, setFacets] = useState<CatalogueFacets>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void Promise.allSettled([
      api.catalogue({ sort: 'updated', pageSize: 13 }, controller.signal),
      api.catalogue({ type: 'movie', sort: 'year_desc', pageSize: 12 }, controller.signal),
      api.filters(controller.signal),
    ]).then(([recent, films, filters]) => {
      if (controller.signal.aborted) return;
      if (recent.status === 'fulfilled') setLatest(recent.value.items);
      else setError(errorMessage(recent.reason));
      if (films.status === 'fulfilled') setMovies(films.value.items);
      if (filters.status === 'fulfilled') setFacets(filters.value);
      setLoading(false);
    });
    return () => controller.abort();
  }, [retry]);
  const featured =
    latest.find((item) => item.synopsis && (item.imageUrl || item.posterUrl)) ?? latest[0];
  return (
    <div className="home-page">
      <h1 className="sr-only">Explore anime</h1>
      {error && (
        <InlineNotice tone="error">
          <strong>Catalogue unavailable.</strong> {error}
          <button
            className="text-button"
            type="button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Try again
          </button>
        </InlineNotice>
      )}
      {loading ? (
        <section className="home-loading" aria-busy="true" aria-label="Loading catalogue">
          <div className="skeleton-feature" />
          <span className="sr-only">Loading catalogue…</span>
        </section>
      ) : featured ? (
        <FeatureSpotlight items={latest} />
      ) : !error ? (
        <InlineNotice>
          No titles have been imported yet. Saved titles remain available in your list.
        </InlineNotice>
      ) : null}
      <nav className="browse-shortcuts" aria-label="Browse shortcuts">
        <Link to="/catalogue?sort=updated">Recently updated</Link>
        <Link to="/catalogue?sort=title">Browse A–Z</Link>
        <Link to="/catalogue?language=dub">Dubbed</Link>
        <Link to="/catalogue?type=movie">Films</Link>
        <Link to="/catalogue">
          All titles <Icon name="arrow" />
        </Link>
      </nav>
      {history.entries.length > 0 && (
        <section className="continue-section" aria-labelledby="continue-title">
          <header className="rail-heading">
            <h2 id="continue-title">Jump back in</h2>
            <Link to="/library">
              Your history <Icon name="arrow" />
            </Link>
          </header>
          <div className="continue-track">
            {history.entries.slice(0, 8).map((entry) => (
              <article className="continue-card" key={`${entry.episodeId}:${entry.language}`}>
                <Link
                  to={`/watch/${encodeURIComponent(entry.slug)}/${encodeURIComponent(entry.episodeId)}?language=${encodeURIComponent(entry.language)}`}
                >
                  <span className="continue-card__art">
                    <CoverArt
                      title={{
                        id: entry.titleId,
                        slug: entry.slug,
                        name: entry.title,
                        imageUrl: entry.imageUrl,
                      }}
                    />
                    <Icon name="play" />
                  </span>
                  <span className="continue-card__copy">
                    <strong>{entry.title}</strong>
                    <small>
                      {entry.episodeLabel} · {entry.language.toUpperCase()}
                    </small>
                  </span>
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}
      <Rail
        title="Recent updates"
        to="/catalogue?sort=updated"
        items={latest.filter((item) => item.id !== featured?.id)}
      />
      <Rail title="Saved for later" to="/library" items={watchlist.items.slice(0, 12)} />
      {(facets.genres?.length ?? 0) > 0 && (
        <section className="genre-section" aria-labelledby="genres-title">
          <header className="rail-heading">
            <h2 id="genres-title">Find your genre</h2>
            <Link to="/catalogue">
              All genres <Icon name="arrow" />
            </Link>
          </header>
          <div className="genre-grid">
            {[...(facets.genres ?? [])]
              .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
              .slice(0, 8)
              .map((genre) => (
                <Link key={genre.value} to={`/catalogue?genre=${encodeURIComponent(genre.value)}`}>
                  <strong>{genre.label}</strong>
                  <small>{genre.count?.toLocaleString()} titles</small>
                  <Icon name="arrow" />
                </Link>
              ))}
          </div>
        </section>
      )}
      <Rail title="Films" to="/catalogue?type=movie&sort=year_desc" items={movies} />
    </div>
  );
}
