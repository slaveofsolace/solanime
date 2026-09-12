import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import type { CatalogueFacets, CatalogueResponse, FacetOption } from '../types';
import { PageIntro, Pager, StatusPanel, TitleCard } from '../components/ui';

const EMPTY_RESULT: CatalogueResponse = { items: [], total: 0, page: 1, pageSize: 24, pages: 0 };

function asOptions(values: FacetOption[] | undefined): FacetOption[] {
  return values ?? [];
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
      <select name={name} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
            {option.count !== undefined ? ` (${option.count})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function CataloguePage() {
  const [params, setParams] = useSearchParams();
  const searchView = useLocation().pathname === '/search';
  const queryKey = params.toString();
  const searchInput = useRef<HTMLInputElement>(null);
  const [draftQuery, setDraftQuery] = useState(params.get('q') ?? '');
  const [catalogue, setCatalogue] = useState<CatalogueResponse>(EMPTY_RESULT);
  const [facets, setFacets] = useState<CatalogueFacets>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const rawPage = Number(params.get('page') ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= 1_000_000 ? rawPage : 1;

  const query = useMemo(
    () => ({
      q: params.get('q') ?? undefined,
      genre: params.get('genre') ?? undefined,
      type: params.get('type') ?? undefined,
      status: params.get('status') ?? undefined,
      language: params.get('language') ?? undefined,
      sort: params.get('sort') ?? 'updated',
      page,
      pageSize: 24,
    }),
    [queryKey, page],
  );

  useEffect(() => {
    if (searchView || params.get('focus') === 'search') searchInput.current?.focus();
  }, [params]);

  useEffect(() => {
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
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('focus');
      if (value) next.set(name, value);
      else next.delete(name);
      if (name !== 'page') next.delete('page');
      return next;
    });
  };

  const activeFilters = ['q', 'genre', 'type', 'status', 'language'].filter((key) =>
    params.has(key),
  ).length;

  return (
    <div className="catalogue-page">
      <PageIntro
        code=""
        title={searchView ? 'Search' : 'Browse anime'}
        copy={
          searchView
            ? 'A title, a memory, a new beginning.'
            : 'Explore the collection at your own pace.'
        }
        aside={
          <>
            <strong>{loading ? '—' : catalogue.total.toLocaleString()}</strong>
            <span>matching titles</span>
          </>
        }
      />

      <form
        className="catalogue-controls"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          updateParam('q', draftQuery.trim());
        }}
      >
        <label className="search-field">
          <span className="sr-only">Search catalogue</span>
          <input
            ref={searchInput}
            type="search"
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="Search titles and aliases"
            autoComplete="off"
          />
          <button type="submit">Search</button>
        </label>
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
          <label className="filter-field">
            <span>Sort</span>
            <select
              value={params.get('sort') ?? 'updated'}
              onChange={(event) => updateParam('sort', event.target.value)}
            >
              <option value="updated">Recently updated</option>
              <option value="title">Title A–Z</option>
              <option value="year_desc">Newest year</option>
              <option value="year_asc">Oldest year</option>
            </select>
          </label>
        </div>
        <div className="control-foot">
          <p>
            {activeFilters
              ? `${activeFilters} active filter${activeFilters === 1 ? '' : 's'}`
              : 'All available catalogue records'}
          </p>
          {activeFilters > 0 && (
            <button className="text-button" type="button" onClick={() => setParams({})}>
              Clear filters
            </button>
          )}
        </div>
      </form>

      {error ? (
        <StatusPanel
          eyebrow="CATALOGUE UNAVAILABLE"
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
          <p>Your saved library and history are still available on this device.</p>
        </StatusPanel>
      ) : loading ? (
        <section className="results-section" aria-busy="true" aria-live="polite">
          <header className="results-heading">
            <p>Loading catalogue…</p>
          </header>
          <div className="title-grid skeleton-grid" aria-hidden="true">
            {Array.from({ length: 12 }, (_, index) => (
              <div className="skeleton-card" key={index} />
            ))}
          </div>
        </section>
      ) : catalogue.items.length === 0 ? (
        <StatusPanel eyebrow="0 RECORDS" title="No titles found">
          <p>Try a broader title, remove a filter, or clear the current search.</p>
          <button className="button button--primary" type="button" onClick={() => setParams({})}>
            Reset catalogue
          </button>
        </StatusPanel>
      ) : (
        <section className="results-section" aria-labelledby="results-title">
          <header className="results-heading">
            <h2 id="results-title">Catalogue</h2>
            <p>
              Page {catalogue.page} of {catalogue.pages}
            </p>
          </header>
          <div className="title-grid">
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
