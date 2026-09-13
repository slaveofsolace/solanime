import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { TitleSummary } from '../types';
import { useAppState } from '../state';
import { CoverArt } from './ui';
import Icon from './Icon';
import { markDialogTrigger } from './Dialog';

/** A loaded banner is the single, proportionally cropped artwork surface.
 * Keep the original poster visible until the banner has actually loaded.
 */
export function SpotlightArtwork({ title, className = '' }: { title: TitleSummary; className?: string }) {
  const [bannerResult, setBannerResult] = useState<{ url: string; state: 'loaded' | 'failed' } | null>(null);
  const banner = title.backdropUrl || null;
  const bannerState = !banner ? 'none' : bannerResult?.url === banner ? bannerResult.state : 'loading';
  const dimensions = title.artwork?.backdrop?.url === banner ? title.artwork.backdrop : undefined;
  return (
    <div className={`spotlight-art ${className}`} aria-hidden="true" data-banner={bannerState}>
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
            setBannerResult({ url: banner, state: rendered ? 'loaded' : 'failed' });
          }}
          onError={() => setBannerResult({ url: banner, state: 'failed' })}
        />
      )}
      <div className="spotlight-art__poster" hidden={bannerState === 'loaded'}>
        <CoverArt title={title} eager />
      </div>
    </div>
  );
}

export default function FeatureSpotlight({ items }: { items: TitleSummary[] }) {
  const { watchlist, setPreview } = useAppState();
  const [index, setIndex] = useState(0);
  const usable = items.filter((title) => title.synopsis && (title.imageUrl || title.posterUrl));
  const choices = (usable.length ? usable : items).slice(0, 5);
  const selected = index % Math.max(choices.length, 1),
    item = choices[selected];
  if (!item) return null;
  return (
    <section
      className="home-feature"
      aria-labelledby="featured-title"
      aria-roledescription="carousel"
    >
      <div className="spotlight-scene" key={item.id}>
        <SpotlightArtwork title={item} />
        <div className="home-feature__copy">
          <h2 id="featured-title">{item.name}</h2>
          <p className="feature-meta">
            {[
              item.type,
              item.releaseYear,
              item.episodeCount
                ? `${item.episodeCount} ${item.episodeCount === 1 ? 'episode' : 'episodes'}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {item.synopsis && <p className="feature-synopsis">{item.synopsis}</p>}
          <div className="button-row">
            <Link className="button button--primary" to={`/title/${encodeURIComponent(item.slug)}`}>
              <Icon name="play" />
              View episodes
            </Link>
            <button
              className="button button--quiet"
              type="button"
              onClick={(event) => {
                markDialogTrigger(event.currentTarget);
                setPreview(item);
              }}
            >
              <Icon name="info" />
              More info
            </button>
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
