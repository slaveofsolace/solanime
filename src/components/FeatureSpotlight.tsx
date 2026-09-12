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
        <div className="spotlight-art" aria-hidden="true">
          <CoverArt title={item} eager />
        </div>
        <div className="home-feature__copy">
          <p className="feature-meta">
            {[
              item.type,
              item.releaseYear,
              item.episodeCount ? `${item.episodeCount} episodes` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <h2 id="featured-title">{item.name}</h2>
          <p className="feature-synopsis">
            {item.synopsis || 'Explore the episodes and available versions.'}
          </p>
          <div className="button-row">
            <Link className="button button--primary" to={`/title/${encodeURIComponent(item.slug)}`}>
              <Icon name="play" />
              View episodes
            </Link>
            <button className="button button--quiet" type="button" onClick={() => setPreview(item)}>
              More info
              <Icon name="arrow" />
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
          <div className="feature-picks">
            {choices.map((title, position) => (
              <button
                key={title.id}
                type="button"
                aria-label={`Feature ${title.name}`}
                aria-pressed={position === selected}
                onClick={() => setIndex(position)}
              >
                <span>{String(position + 1).padStart(2, '0')}</span>
                <strong>{title.name}</strong>
              </button>
            ))}
          </div>
          <div className="feature-arrows">
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
        </div>
      )}
    </section>
  );
}
