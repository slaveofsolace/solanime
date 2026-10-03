import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { TitleSummary } from '../types';
import { useAppState } from '../state';
import { chooseWatchEntry, watchEntryPath } from '../lib/watchEntry';
import { CoverArt } from './ui';
import Icon from './Icon';
import { api } from '../lib/api';
import { motionReduced } from '../lib/motion';
import type { TitleDetailResponse } from '../types';

const FEATURE_ROTATION_MS = 6_000;
const FEATURE_SLIDE_MS = 240;

type Slide = {
  from: TitleSummary;
  destination: string;
  label: string;
  direction: 1 | -1;
};

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
  const { watchlist, history, watched, preferences } = useAppState();
  const [prefs] = preferences;
  const [detail, setDetail] = useState<TitleDetailResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [pageVisible, setPageVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [slide, setSlide] = useState<Slide | null>(null);
  const slideTimer = useRef<number | null>(null);
  const usable = items.filter((title) => title.synopsis && (title.imageUrl || title.posterUrl));
  const editorial = usable.filter((title) => Boolean(title.backdropUrl));
  // An ultrawide hero needs an actual backdrop. Falling through to a portrait
  // poster after four good slides makes the carousel visibly collapse, so a
  // shorter high-fidelity set is preferable to a fixed five-item count.
  const choices = (editorial.length ? editorial : usable.length ? usable : items).slice(0, 5);
  const selected = index % Math.max(choices.length, 1),
    item = choices[selected];
  const watchEntry = item && detail?.title.id === item.id
    ? chooseWatchEntry(item.id, detail.episodes, history.entries, prefs.preferredLanguage, watched.isWatched)
    : null;
  const destination = item
    ? watchEntry ? watchEntryPath(item.slug, watchEntry) : `/title/${encodeURIComponent(item.slug)}`
    : '/';
  const label = watchEntry?.label ?? 'View series';
  const goTo = (next: number, direction: 1 | -1) => {
    if (!item || next === selected) return;
    if (slideTimer.current !== null) window.clearTimeout(slideTimer.current);
    setSlide(reducedMotion ? null : { from: item, destination, label, direction });
    setIndex(next);
    if (!reducedMotion) slideTimer.current = window.setTimeout(() => {
      setSlide(null);
      slideTimer.current = null;
    }, FEATURE_SLIDE_MS);
  };
  useEffect(() => () => {
    if (slideTimer.current !== null) window.clearTimeout(slideTimer.current);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setPageVisible(!document.hidden);
      setReducedMotion(motionReduced());
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    document.addEventListener('visibilitychange', sync);
    media.addEventListener('change', sync);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      media.removeEventListener('change', sync);
    };
  }, []);
  useEffect(() => {
    if (choices.length < 2 || !pageVisible || reducedMotion || hovered || focused) return;
    const timeout = window.setTimeout(() => goTo((selected + 1) % choices.length, 1), FEATURE_ROTATION_MS);
    return () => window.clearTimeout(timeout);
  }, [choices.length, selected, pageVisible, reducedMotion, hovered, focused]);
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
  const renderScene = (title: TitleSummary, target: string, actionLabel: string, className: string) => {
    const genres = (title.genres ?? []).map((genre) => typeof genre === 'string' ? genre : genre.name).filter(Boolean).slice(0, 2);
    return (
    <div className={`spotlight-scene ${className}`} key={title.id}>
      <SpotlightArtwork title={title} />
      <div className="home-feature__copy">
        <div className="home-feature__intro">
          <div className="home-feature__mobile-art" aria-hidden="true">
            <CoverArt title={title} eager />
          </div>
          <div className="home-feature__intro-copy">
            <p className="feature-kicker">Featured anime</p>
            <h2 id={className.includes('outgoing') ? undefined : 'featured-title'}><Link to={`/title/${encodeURIComponent(title.slug)}`}>{title.name}</Link></h2>
            <p className="feature-meta">
              {[
                (title.languages ?? []).map(value => value === 'sub' ? 'Sub' : value === 'dub' ? 'Dub' : value).join(' | ') || title.type,
                genres.length ? genres.join(', ') : title.releaseYear,
                !genres.length && title.episodeCount
                  ? `${title.episodeCount} ${title.episodeCount === 1 ? 'episode' : 'episodes'}`
                  : null,
              ]
                .filter(Boolean)
                .map((fact) => <span key={fact}>{fact}</span>)}
            </p>
          </div>
        </div>
        {title.synopsis && <p className="feature-synopsis">{title.synopsis.replace(/\s*\[more\]\s*$/i, '')}</p>}
        <div className="button-row">
          <Link className="button button--primary" to={target}>
            <Icon name="play" />
            {actionLabel}
          </Link>
          <button
            className="icon-button"
            type="button"
            aria-label={watchlist.has(title.id) ? 'Remove featured title from list' : 'Save featured title'}
            aria-pressed={watchlist.has(title.id)}
            onClick={() => watchlist.toggle(title.id, title)}
          >
            <Icon name={watchlist.has(title.id) ? 'check' : 'bookmark'} />
          </button>
        </div>
      </div>
    </div>
    );
  };
  return (
    <section
      className="home-feature"
      aria-labelledby="featured-title"
      aria-roledescription="carousel"
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHovered(true); }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') setHovered(false); }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {slide && <div aria-hidden="true" inert className={`spotlight-exit spotlight-exit--${slide.direction === 1 ? 'forward' : 'backward'}`}>
        {renderScene(slide.from, slide.destination, slide.label, 'spotlight-scene--outgoing')}
      </div>}
      {renderScene(item, destination, label, slide ? `spotlight-scene--incoming spotlight-scene--${slide.direction === 1 ? 'forward' : 'backward'}` : '')}
      {choices.length > 1 && (
        <div className="spotlight-controls" role="group" aria-label="Featured selections">
          <div className="feature-arrows">
            <button
              className="icon-button"
              type="button"
              aria-label="Previous featured title"
              onClick={() => goTo((selected - 1 + choices.length) % choices.length, -1)}
            >
              <Icon name="left" />
            </button>
            <div className="feature-dots">
              {choices.map((choice, choiceIndex) => (
                <button key={choice.id} type="button" aria-label={`Feature ${choice.name}`}
                  aria-pressed={choiceIndex === selected} onClick={() => goTo(choiceIndex, choiceIndex > selected ? 1 : -1)}>
                  <span />
                </button>
              ))}
            </div>
            <span className="feature-count" aria-live={pageVisible && !reducedMotion && !hovered && !focused ? 'off' : 'polite'} aria-atomic="true">
              <span aria-hidden="true">{String(selected + 1).padStart(2, '0')} / {String(choices.length).padStart(2, '0')}</span>
              <span className="sr-only">Featured title {selected + 1} of {choices.length}</span>
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label="Next featured title"
              onClick={() => goTo((selected + 1) % choices.length, 1)}
            >
              <Icon name="right" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
