import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { TitleSummary } from '../types';
import { useAppState } from '../state';
import { CoverArt } from './ui';
import Icon from './Icon';

export default function FeatureSpotlight({ items }: { items: TitleSummary[] }) {
  const { watchlist, setPreview } = useAppState();
  const [index, setIndex] = useState(0);
  const usable = items.filter((title) => title.synopsis && (title.imageUrl || title.posterUrl));
  const choices = (usable.length ? usable : items).slice(0, 5);
  const selected = index % Math.max(choices.length, 1);
  const item = choices[selected];
  if (!item) return null;
  const path = `/title/${encodeURIComponent(item.slug)}`;
  return (
    <section
      className="home-feature"
      aria-labelledby="featured-title"
      aria-roledescription="carousel"
    >
      <div className="spotlight-scene" key={item.id}>
        <div className="spotlight-backdrop" aria-hidden="true">
          <CoverArt title={item} eager />
        </div>
        <div className="home-feature__copy">
          <p className="feature-caption">From the catalogue</p>
          <h2 id="featured-title">{item.name}</h2>
          <p className="feature-meta">
            {[
              item.type,
              item.releaseYear,
              item.episodeCount ? `${item.episodeCount} episodes` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="feature-synopsis">
            {item.synopsis || 'Explore the episode list and available language versions.'}
          </p>
          <div className="button-row">
            <Link className="button button--play" to={path}>
              <Icon name="play" />
              View episodes
            </Link>
            <button
              className="button button--outline"
              type="button"
              aria-pressed={watchlist.has(item.id)}
              onClick={() => watchlist.toggle(item.id, item)}
            >
              <Icon name={watchlist.has(item.id) ? 'check' : 'bookmark'} />
              {watchlist.has(item.id) ? 'Saved' : 'My list'}
            </button>
            <button className="button button--glass" type="button" onClick={() => setPreview(item)}>
              <Icon name="info" />
              More info
            </button>
          </div>
        </div>
        <Link className="home-feature__art" to={path} aria-label={`Open ${item.name}`}>
          <CoverArt title={item} eager />
        </Link>
      </div>
      {choices.length > 1 && (
        <div className="spotlight-controls" role="group" aria-label="Featured selections">
          <span className="spotlight-counter" aria-live="polite" aria-atomic="true">
            {String(selected + 1).padStart(2, '0')}{' '}
            <span>/ {String(choices.length).padStart(2, '0')}</span>
          </span>
          <div className="spotlight-progress" aria-hidden="true">
            {choices.map((title, position) => (
              <span key={title.id} data-active={position === selected} />
            ))}
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Previous featured title"
            onClick={() => setIndex((selected - 1 + choices.length) % choices.length)}
          >
            <Icon name="left" />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Next featured title"
            onClick={() => setIndex((selected + 1) % choices.length)}
          >
            <Icon name="right" />
          </button>
        </div>
      )}
    </section>
  );
}
