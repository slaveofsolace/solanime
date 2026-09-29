import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { TitleSummary } from '../types';
import { useAppState } from '../state';
import { chooseWatchEntry, watchEntryPath } from '../lib/watchEntry';
import { CoverArt } from './ui';
import Icon from './Icon';
import { api } from '../lib/api';
import type { TitleDetailResponse } from '../types';

/** A loaded banner is the single, proportionally cropped artwork surface.
 * Keep the original poster visible until the banner has actually loaded.
 */
export function SpotlightArtwork({ title, className = '' }: { title: TitleSummary; className?: string }) {
  const [bannerResult, setBannerResult] = useState<{ url: string; state: 'loaded' | 'failed'; ratio?: number } | null>(null);
  const banner = title.backdropUrl || null;
  const poster = title.posterUrl || title.imageUrl || null;
  const bannerState = !banner ? 'none' : bannerResult?.url === banner ? bannerResult.state : 'loading';
  const dimensions = title.artwork?.backdrop?.url === banner ? title.artwork.backdrop : undefined;
  const ratio = dimensions ? dimensions.width / Math.max(1, dimensions.height)
    : bannerResult?.url === banner ? bannerResult.ratio : undefined;
  const mobileBannerSafe = Boolean(
    dimensions &&
      dimensions.width >= 900 &&
      dimensions.height >= 600 &&
      dimensions.width / dimensions.height <= 2.8,
  );
  return (
    <div
      className={`spotlight-art ${className}`}
      aria-hidden="true"
      data-banner={bannerState}
      data-mobile-art={banner && mobileBannerSafe ? 'banner' : 'poster'}
      data-banner-shape={ratio && ratio > 3 ? 'strip' : 'landscape'}
    >
      {banner && bannerState !== 'failed' && (
        <img
          key={banner}
          className="spotlight-art__banner"
          src={banner}
          alt=""
          width={dimensions?.width}
          height={dimensions?.height}
          decoding="async"
          fetchPriority="high"
          referrerPolicy="no-referrer"
          onLoad={(event) => {
            const rendered = event.currentTarget.naturalWidth > 0 && event.currentTarget.naturalHeight > 0;
            setBannerResult({ url: banner, state: rendered ? 'loaded' : 'failed',
              ratio: event.currentTarget.naturalWidth / Math.max(1, event.currentTarget.naturalHeight) });
          }}
          onError={() => setBannerResult({ url: banner, state: 'failed' })}
        />
      )}
      <div
        className="spotlight-art__poster"
        style={poster ? ({ '--spotlight-poster': `url(${JSON.stringify(poster)})` } as CSSProperties) : undefined}
      >
        <CoverArt title={title} eager />
      </div>
    </div>
  );
}

export default function FeatureSpotlight({ items }: { items: TitleSummary[] }) {
  const { watchlist, history, preferences } = useAppState();
  const [prefs] = preferences;
  const [detail, setDetail] = useState<TitleDetailResponse | null>(null);
  const [index, setIndex] = useState(0);
  const usable = items.filter((title) => title.synopsis && (title.imageUrl || title.posterUrl));
  const editorial = usable.filter((title) => Boolean(title.backdropUrl));
  // An ultrawide hero needs an actual backdrop. Falling through to a portrait
  // poster after four good slides makes the carousel visibly collapse, so a
  // shorter high-fidelity set is preferable to a fixed five-item count.
  const choices = (editorial.length ? editorial : usable.length ? usable : items).slice(0, 5);
  const selected = index % Math.max(choices.length, 1),
    item = choices[selected];
  useEffect(() => {
    if (!item) return;
    const controller = new AbortController();
    setDetail(null);
    void api.title(item.slug, controller.signal).then(data => {
      if (!controller.signal.aborted) setDetail(data);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [item?.id]);
  if (!item) return null;
  const watchEntry = detail?.title.id === item.id
    ? chooseWatchEntry(item.id, detail.episodes, history.entries, prefs.preferredLanguage)
    : null;
  const destination = watchEntry
    ? watchEntryPath(item.slug, watchEntry)
    : `/title/${encodeURIComponent(item.slug)}`;
  return (
    <section
      className="home-feature"
      aria-labelledby="featured-title"
      aria-roledescription="carousel"
    >
      <div className="spotlight-scene" key={item.id}>
        <SpotlightArtwork title={item} />
        <div className="home-feature__copy">
          <p className="feature-kicker">Featured anime</p>
          <h2 id="featured-title"><Link to={`/title/${encodeURIComponent(item.slug)}`}>{item.name}</Link></h2>
          <p className="feature-meta">
            {[
              (item.languages ?? []).map(value => value === 'sub' ? 'Sub' : value === 'dub' ? 'Dub' : value).join(' | ') || item.type,
              item.releaseYear,
              item.episodeCount
                ? `${item.episodeCount} ${item.episodeCount === 1 ? 'episode' : 'episodes'}`
                : null,
            ]
              .filter(Boolean)
              .map((fact) => <span key={fact}>{fact}</span>)}
          </p>
          {item.synopsis && <p className="feature-synopsis">{item.synopsis.replace(/\s*\[more\]\s*$/i, '')}</p>}
          <div className="button-row">
            <Link className="button button--primary" to={destination}>
              <Icon name="play" />
              {watchEntry?.label ?? 'View series'}
            </Link>
            <button
              className="icon-button"
              type="button"
              aria-label={
                watchlist.has(item.id) ? 'Remove featured title from list' : 'Save featured title'
              }
              aria-pressed={watchlist.has(item.id)}
              onClick={() => watchlist.toggle(item.id, item)}
            >
              <Icon name={watchlist.has(item.id) ? 'check' : 'bookmark'} />
            </button>
          </div>
        </div>
      </div>
      {choices.length > 1 && (
        <div className="spotlight-controls" role="group" aria-label="Featured selections">
          <div className="feature-arrows">
            <button
              className="icon-button"
              type="button"
              aria-label="Previous featured title"
              onClick={() => setIndex((selected - 1 + choices.length) % choices.length)}
            >
              <Icon name="left" />
            </button>
            <div className="feature-dots">
              {choices.map((choice, choiceIndex) => (
                <button key={choice.id} type="button" aria-label={`Feature ${choice.name}`}
                  aria-pressed={choiceIndex === selected} onClick={() => setIndex(choiceIndex)}>
                  <span />
                </button>
              ))}
            </div>
            <span className="feature-count" aria-live="polite" aria-atomic="true">
              <span aria-hidden="true">{String(selected + 1).padStart(2, '0')} / {String(choices.length).padStart(2, '0')}</span>
              <span className="sr-only">Featured title {selected + 1} of {choices.length}</span>
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label="Next featured title"
              onClick={() => setIndex((selected + 1) % choices.length)}
            >
              <Icon name="right" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
