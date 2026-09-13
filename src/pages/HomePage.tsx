import FeatureSpotlight from '../components/FeatureSpotlight';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Rail from '../components/CatalogueRail';
import { CoverArt, InlineNotice } from '../components/ui';
import Icon from '../components/Icon';
import { api, errorMessage } from '../lib/api';
import { useAppState } from '../state';
import type { CatalogueFacets, TitleSummary } from '../types';
import { BrandReadiness, isBrandSessionResolved } from '../branding';

function progress(entry: { position?: number; duration?: number }) {
  if (!Number.isFinite(entry.duration) || !Number.isFinite(entry.position) || !entry.duration || !entry.position) return 0;
  return Math.max(0, Math.min(100, (entry.position / entry.duration) * 100));
}

function remaining(entry: { position?: number; duration?: number }) {
  if (!Number.isFinite(entry.duration) || !Number.isFinite(entry.position) || !entry.duration || !entry.position) return null;
  const minutes = Math.max(1, Math.ceil((entry.duration - entry.position) / 60));
  return `${minutes} min left`;
}

export default function HomePage() {
  const { history, watchlist, preferences } = useAppState();
  const [prefs] = preferences;
  const [bootDismissed, setBootDismissed] = useState(() => isBrandSessionResolved('solanime-home-boot'));
  const [latest, setLatest] = useState<TitleSummary[]>([]);
  const [movies, setMovies] = useState<TitleSummary[]>([]);
  const [tvShows, setTvShows] = useState<TitleSummary[]>([]);
  const [facets, setFacets] = useState<CatalogueFacets>({});
  const [collections, setCollections] = useState<Array<{ label: string; genre: string; items: TitleSummary[] }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(latest.length === 0);
    setError(null);
    void api
      .catalogue({ scope: 'anime', sort: 'updated', pageSize: 13 }, controller.signal)
      .then((recent) => {
        if (!controller.signal.aborted) setLatest(recent.items);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    void api
      .catalogue({ scope: 'anime', type: 'movie', sort: 'year_desc', pageSize: 12 }, controller.signal)
      .then((films) => {
        if (!controller.signal.aborted) setMovies(films.items);
      })
      .catch(() => undefined);
    void api
      .catalogue({ scope: 'tv', sort: 'updated', pageSize: 12 }, controller.signal)
      .then((shows) => {
        if (!controller.signal.aborted) setTvShows(shows.items);
      })
      .catch(() => undefined);
    void api
      .filters(controller.signal)
      .then(async (filters) => {
        if (controller.signal.aborted) return;
        setFacets(filters);
        const selected = ['Action', 'Comedy', 'Romance'].flatMap(label => {
          const genre = filters.genres?.find(item => item.label.toLowerCase() === label.toLowerCase());
          return genre ? [{ label, genre: genre.value }] : [];
        });
        const rows = await Promise.all(selected.map(async row => {
          try {
            const result = await api.catalogue({ scope: 'anime', genre: row.genre, sort: 'updated', pageSize: 12 }, controller.signal);
            return { ...row, items: result.items };
          } catch { return { ...row, items: [] }; }
        }));
        if (!controller.signal.aborted) setCollections(rows);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [retry]);
  // Editorial artwork preference, not a claim about popularity or watch counts.
  const spotlightItems = [...latest].sort((a, b) =>
    Number(Boolean(b.backdropUrl)) - Number(Boolean(a.backdropUrl)) ||
    Number(Boolean(b.posterUrl)) - Number(Boolean(a.posterUrl)),
  );
  const featured =
    spotlightItems.find((item) => item.synopsis && (item.imageUrl || item.posterUrl)) ?? spotlightItems[0];
  const continuing = history.entries.filter(
    (entry) => !entry.duration || !entry.position || entry.position / entry.duration < 0.95,
  );
  return (
    <div className={`home-page${continuing.length > 0 ? ' home-page--returning' : ''}`}>
      <BrandReadiness
        ready={!loading && !error}
        error={error}
        onRetry={() => setRetry(value => value + 1)}
        onDismiss={() => setBootDismissed(true)}
        reducedMotion={prefs.motion === 'reduced'}
        theme={prefs.theme ?? 'dark'}
        sessionKey="solanime-home-boot"
      />
      <h1 className="sr-only">Explore anime</h1>
      {error && bootDismissed && (
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
        <FeatureSpotlight items={spotlightItems} />
      ) : !error ? (
        <InlineNotice>
          No titles have been imported yet. Saved titles remain available in your list.
        </InlineNotice>
      ) : null}
      {continuing.length > 0 && (
        <section className="continue-section continue-section--home" aria-labelledby="continue-title">
          <header className="rail-heading">
            <div className="rail-heading__title">
              <h2 id="continue-title">Continue watching</h2>
              <Link to="/library">
                Full history <Icon name="arrow" />
              </Link>
            </div>
          </header>
          <div className="continue-track">
            {continuing.slice(0, 8).map((entry) => {
              const percent = progress(entry);
              const timeRemaining = remaining(entry);
              const knownTitle = latest.find(item => item.id === entry.titleId) ?? watchlist.items.find(item => item.id === entry.titleId);
              return (
                <article className="continue-card" key={`${entry.episodeId}:${entry.language}`}>
                  <Link
                    to={`/watch/${encodeURIComponent(entry.slug)}/${encodeURIComponent(entry.episodeId)}?language=${encodeURIComponent(entry.language)}`}
                  >
                    <span className="continue-card__art">
                      <CoverArt
                        variant={knownTitle?.backdropUrl ? 'landscape' : 'poster'}
                        title={{
                          ...knownTitle,
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
                      {percent > 0 && <span
                        className="continue-progress"
                        role="progressbar"
                        aria-label={`${entry.title} viewing progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(percent)}
                      >
                        <span style={{ width: `${percent}%` }} />
                      </span>}
                      {timeRemaining && <small className="continue-remaining">{timeRemaining}</small>}
                    </span>
                  </Link>
                  <button
                    type="button"
                    className="continue-remove"
                    aria-label={`Remove ${entry.title} ${entry.episodeLabel} from history`}
                    onClick={() => history.remove(entry.episodeId, entry.language)}
                  >
                    Remove
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}
      <Rail
        title="Recent updates"
        to="/catalogue?scope=anime&sort=updated"
        items={latest.filter((item) => item.id !== featured?.id)}
        format="landscape"
      />
      <Rail title="Saved for later" to="/library" items={watchlist.items.slice(0, 12)} format="landscape" />
      <Rail title="Anime films" to="/catalogue?scope=anime&type=movie&sort=year_desc" items={movies} format="landscape" />
      <Rail title="TV shows" to="/catalogue?scope=tv&sort=updated" items={tvShows} format="landscape" />
      {collections.map(row => <Rail key={row.genre} title={row.label}
        to={`/catalogue?scope=anime&genre=${encodeURIComponent(row.genre)}`} items={row.items} format="landscape" />)}
      {(facets.genres?.length ?? 0) > 0 && (
        <section className="genre-section" aria-labelledby="genres-title">
          <header className="rail-heading">
            <h2 id="genres-title">Browse genres</h2>
            <Link to="/catalogue">
              All genres <Icon name="arrow" />
            </Link>
          </header>
          <div className="genre-grid">
            {[...(facets.genres ?? [])]
              .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
              .slice(0, 8)
              .map((genre) => (
                <Link key={genre.value} to={`/catalogue?scope=anime&genre=${encodeURIComponent(genre.value)}`}>
                  <strong>{genre.label}</strong>
                  {typeof genre.count === 'number' && <small>{genre.count.toLocaleString()} titles</small>}
                  <Icon name="arrow" />
                </Link>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
