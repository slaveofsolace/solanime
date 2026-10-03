import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useInitialReadiness } from '../branding/ApplicationReadiness';
import type { CatalogueFacets, CatalogueResponse, FacetOption } from '../types';
import { Pager, StatusPanel, TitleCard } from '../components/ui';
import Icon from '../components/Icon';
import SelectControl from '../components/SelectControl';
import { isCatalogueScope, type CatalogueScope } from '../../shared/catalogue-scope';

const EMPTY_RESULT: CatalogueResponse = { items: [], total: 0, page: 1, pageSize: 24, pages: 0 };

function asOptions(values: FacetOption[] | undefined): FacetOption[] {
  return values ?? [];
}

function optionLabel(options: FacetOption[] | undefined, value: string) {
  return options?.find((option) => option.value === value)?.label ?? value;
}

function FilterSelect({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  options: FacetOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <SelectControl aria-label={label} name={name} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectControl>
    </label>
  );
}

export default function CataloguePage() {
  const [params, setParams] = useSearchParams();
  const searchView = useLocation().pathname === '/search';
  const queryKey = params.toString();
  // Router search-parameter callbacks do not queue like React state updates.
  // Keep consecutive control changes together even before navigation renders.
  const pendingParams = useRef(new URLSearchParams(params));
  const queryText = params.get('q') ?? undefined;
  const queryGenre = params.get('genre') ?? undefined;
  const queryType = params.get('type') ?? undefined;
  const queryStatus = params.get('status') ?? undefined;
  const queryLanguage = params.get('language') ?? undefined;
  const requestedScope = params.get('scope');
  const queryScope = requestedScope === 'movies' ? 'tv' : isCatalogueScope(requestedScope) ? requestedScope : undefined;
  const querySort = params.get('sort') ?? 'updated';
  const searchInput = useRef<HTMLInputElement>(null);
  const [draftQuery, setDraftQuery] = useState(params.get('q') ?? '');
  const [catalogue, setCatalogue] = useState<CatalogueResponse>(EMPTY_RESULT);
  const [facets, setFacets] = useState<CatalogueFacets>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useInitialReadiness(!loading && !error, error, () => setRetry(value => value + 1));
  const rawPage = Number(params.get('page') ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= 1_000_000 ? rawPage : 1;

  const query = useMemo(
    () => ({
      q: queryText,
      genre: queryGenre,
      type: queryType,
      status: queryStatus,
      language: queryLanguage,
      scope: queryScope ?? (searchView ? 'all' : undefined),
      sort: querySort,
      page,
      pageSize: 24,
    }),
    [queryText, queryGenre, queryType, queryStatus, queryLanguage, queryScope, querySort, page, searchView],
  );

  useEffect(() => {
    if (requestedScope !== 'movies') return;
    const next = new URLSearchParams(params);
    next.set('scope', 'tv');
    next.delete('page');
    setParams(next, { replace: true });
  }, [requestedScope, params, setParams]);

  useEffect(() => {
    if (searchView || params.get('focus') === 'search') searchInput.current?.focus();
  }, [params]);

  useLayoutEffect(() => {
    pendingParams.current = new URLSearchParams(queryKey);
    setDraftQuery(params.get('q') ?? '');
  }, [queryKey]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .filters(controller.signal)
      .then(setFacets)
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setFacets({});
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .catalogue(query, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.pages > 0 && page > result.pages) {
          setParams(
            (current) => {
              const next = new URLSearchParams(current);
              next.set('page', String(result.pages));
              return next;
            },
            { replace: true },
          );
          return;
        }
        setCatalogue(result);
        setLoading(false);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(cause));
        setLoading(false);
      });
    return () => controller.abort();
  }, [query, retry, setParams]);

  const updateParam = (name: string, value: string) => {
      const next = new URLSearchParams(pendingParams.current);
      next.delete('focus');
      if (value) next.set(name, value);
      else next.delete(name);
      if (name !== 'page') next.delete('page');
      pendingParams.current = next;
      setParams(next);
  };

  const clearFilters = () => {
      const next = new URLSearchParams(pendingParams.current);
      for (const key of ['q', 'genre', 'type', 'status', 'language', 'page', 'focus']) {
        next.delete(key);
      }
      pendingParams.current = next;
      setParams(next);
  };

  const changeCollection = (scope: '' | Exclude<CatalogueScope, 'all'>) => {
    const next = new URLSearchParams(pendingParams.current);
    next.delete('focus');
    next.delete('page');
    next.delete('type');
    next.delete('language');
    if (scope) next.set('scope', scope);
    else next.delete('scope');
    pendingParams.current = next;
    setParams(next);
  };

  const advancedFilters = ['genre', 'type', 'status', 'language'].filter((key) =>
    params.has(key),
  ).length;
  const view = params.get('view') === 'compact' ? 'compact' : 'standard';
  const pageTitle = searchView
    ? 'Search'
    : queryScope === 'tv'
      ? 'TV Shows'
      : queryScope === 'anime' && params.get('type')?.toLowerCase() === 'movie'
        ? 'Anime Films'
        : queryScope === 'anime'
          ? 'Anime'
      : params.get('type')?.toLowerCase() === 'tv'
        ? 'TV Shows'
        : params.get('type')?.toLowerCase() === 'movie'
          ? 'Films'
        : params.get('language')?.toLowerCase() === 'dub'
          ? 'Dubbed Anime'
          : 'Browse';
  const appliedFilters = [
    queryText ? { key: 'q', name: 'Search', value: queryText } : null,
    queryGenre
      ? { key: 'genre', name: 'Genre', value: optionLabel(facets.genres, queryGenre) }
      : null,
    queryType ? { key: 'type', name: 'Format', value: optionLabel(facets.types, queryType) } : null,
    queryStatus
      ? { key: 'status', name: 'Status', value: optionLabel(facets.statuses, queryStatus) }
      : null,
    queryLanguage
      ? {
          key: 'language',
          name: 'Language',
          value: optionLabel(facets.languages, queryLanguage),
        }
      : null,
  ].filter((filter): filter is { key: string; name: string; value: string } => filter !== null);

  return (
    <div
      className={`catalogue-page${searchView ? ' catalogue-page--search' : ''}`}
      data-results-view={view}
    >
      <div className="catalogue-topline">
        <header className="catalogue-heading">
          <div className="catalogue-heading__copy">
            <h1>{pageTitle}</h1>
            {!error && <p className="catalogue-summary" aria-live="polite">
              {loading
                ? 'Loading titles…'
                : `${catalogue.total.toLocaleString()} ${catalogue.total === 1 ? 'title' : 'titles'}`}
            </p>}
          </div>
        </header>

        {!searchView && (
          <div className="catalogue-collections" role="group" aria-label="Catalogue collection">
            <button type="button" aria-pressed={!queryScope} onClick={() => changeCollection('')}>All</button>
            <button type="button" aria-pressed={queryScope === 'anime'} onClick={() => changeCollection('anime')}>Anime</button>
            <button type="button" aria-pressed={queryScope === 'tv'} onClick={() => changeCollection('tv')}>TV Shows</button>
          </div>
        )}
      </div>

      <form
        className="catalogue-controls"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          // Read the submitted control, not a possibly one-event-behind React snapshot.
          const submitted = new FormData(event.currentTarget).get('q');
          updateParam('q', String(submitted ?? '').trim());
        }}
      >
        <div className="discovery-toolbar">
          <label className="search-field">
            <span className="sr-only">Search catalogue</span>
            <input
              ref={searchInput}
              name="q"
              type="search"
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={searchView ? 'Search all titles' : queryScope === 'anime' ? 'Search anime' : queryScope === 'tv' ? 'Search TV shows' : 'Search titles'}
              autoComplete="off"
            />
            <button type="submit" aria-label="Search catalogue">
              <Icon name="search" />
              <span>Search</span>
            </button>
          </label>

          <div className="discovery-actions">
            <details className="filter-disclosure" open={params.get('filters') === 'genres' || undefined}>
              <summary aria-label={advancedFilters ? `Filters, ${advancedFilters} active` : 'Filters'}>
                <span>Filters</span>
                {advancedFilters > 0 && <span className="filter-count">{advancedFilters}<span className="filter-count__label"> active</span></span>}
              </summary>
              <div className="filter-grid">
                <FilterSelect
                  label="Genre"
                  name="genre"
                  value={params.get('genre') ?? ''}
                  options={asOptions(facets.genres)}
                  onChange={(value) => updateParam('genre', value)}
                />
                <FilterSelect
                  label="Format"
                  name="type"
                  value={params.get('type') ?? ''}
                  options={asOptions(facets.types)}
                  onChange={(value) => updateParam('type', value)}
                />
                <FilterSelect
                  label="Status"
                  name="status"
                  value={params.get('status') ?? ''}
                  options={asOptions(facets.statuses)}
                  onChange={(value) => updateParam('status', value)}
                />
                <FilterSelect
                  label="Language"
                  name="language"
                  value={params.get('language') ?? ''}
                  options={asOptions(facets.languages)}
                  onChange={(value) => updateParam('language', value)}
                />
              </div>
            </details>

            <label className="discovery-sort">
              <span className="sr-only">Sort</span>
              <SelectControl
                aria-label="Sort titles"
                value={params.get('sort') ?? 'updated'}
                onChange={(event) => updateParam('sort', event.target.value)}
              >
                <option value="updated">Recently updated</option>
                <option value="title">Title A–Z</option>
                <option value="year_desc">Newest year</option>
                <option value="year_asc">Oldest year</option>
              </SelectControl>
            </label>

            <div className="view-switcher" role="group" aria-label="Catalogue view">
              <button
                type="button"
                aria-pressed={view === 'standard'}
                onClick={() => updateParam('view', '')}
              >
                <span className="view-switcher__icon view-switcher__icon--standard" aria-hidden="true" />
                <span className="sr-only">Standard</span>
              </button>
              <button
                type="button"
                aria-pressed={view === 'compact'}
                onClick={() => updateParam('view', 'compact')}
              >
                <span className="view-switcher__icon view-switcher__icon--compact" aria-hidden="true" />
                <span className="sr-only">Compact</span>
              </button>
            </div>
          </div>
        </div>

        {appliedFilters.length > 0 && (
          <div className="applied-filters" aria-label="Applied catalogue filters">
            {appliedFilters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                className="applied-filter"
                aria-label={`Remove ${filter.name} filter: ${filter.value}`}
                onClick={() => updateParam(filter.key, '')}
              >
                <span>{filter.name}</span>
                <strong>{filter.value}</strong>
                <b aria-hidden="true">×</b>
              </button>
            ))}
            <button className="clear-filters" type="button" onClick={clearFilters}>
              Clear all
            </button>
          </div>
        )}
      </form>

      {error ? (
        <StatusPanel
          eyebrow=""
          title="Could not load the catalogue"
          action={
            <button
              className="button button--primary"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Try again
            </button>
          }
        >
          <p>{error}</p>
          <p>Your saved titles and history are still in Library.</p>
        </StatusPanel>
      ) : loading ? (
        <section className="results-section" aria-busy="true" aria-live="polite">
          <div className="title-grid skeleton-grid" aria-hidden="true">
            {Array.from({ length: 12 }, (_, index) => (
              <div className="skeleton-card" key={index} />
            ))}
          </div>
        </section>
      ) : catalogue.items.length === 0 ? (
        <StatusPanel eyebrow="" title="No titles found">
          <p>Try another search or remove a filter.</p>
          <button className="button button--primary" type="button" onClick={clearFilters}>
            Clear search and filters
          </button>
        </StatusPanel>
      ) : (
        <section className="results-section" aria-labelledby="results-title">
          <header className="results-heading">
            <h2 id="results-title" className="sr-only">Results</h2>
          </header>
          <div className={`title-grid title-grid--${view}`}>
            {catalogue.items.map((title, index) => (
              <TitleCard key={title.id} title={title} index={index} />
            ))}
          </div>
          <Pager
            current={catalogue.page}
            pages={catalogue.pages}
            onPage={(nextPage) => {
              updateParam('page', String(nextPage));
              document.getElementById('results-title')?.scrollIntoView({ block: 'start' });
            }}
          />
        </section>
      )}
    </div>
  );
}
