import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { TitleCard } from './ui';
import Icon from './Icon';
import { motionReduced } from '../lib/motion';
import type { TitleSummary } from '../types';
export default function CatalogueRail({
  title,
  to,
  items,
  format = 'poster',
}: {
  title: string;
  to: string;
  items: TitleSummary[];
  format?: 'poster' | 'landscape';
}) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const id = `rail-${title.replace(/\W+/g, '-').toLowerCase()}`;
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const sync = () =>
      setEdges({
        start: element.scrollLeft <= 2,
        end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2,
      });
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    element.addEventListener('scroll', sync, { passive: true });
    sync();
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', sync);
    };
  }, [items.length]);
  const scroll = (direction: number) => {
    const element = track.current;
    if (element) {
      const step = element.clientWidth * 0.85;
      const left = direction < 0 && element.scrollLeft <= step + 8 ? 0 : element.scrollLeft + direction * step;
      element.scrollTo({
        left,
        behavior: motionReduced() ? 'instant' : 'smooth',
      });
    }
  };
  if (!items.length) return null;
  return (
    <section className={`home-rail home-rail--${format}`} aria-labelledby={id}>
      <header className="rail-heading">
        <div className="rail-heading__title">
          <h2 id={id}>{title}</h2>
          <Link to={to}>
            Explore all <Icon name="arrow" />
          </Link>
        </div>
        <div className="rail-arrows">
          <button
            type="button"
            className="icon-button"
            disabled={edges.start}
            aria-label={`Previous ${title}`}
            aria-controls={`${id}-items`}
            onClick={() => scroll(-1)}
          >
            <Icon name="left" />
          </button>
          <button
            type="button"
            className="icon-button"
            disabled={edges.end}
            aria-label={`Next ${title}`}
            aria-controls={`${id}-items`}
            onClick={() => scroll(1)}
          >
            <Icon name="right" />
          </button>
        </div>
      </header>
      <div
        id={`${id}-items`}
        className="rail-track"
        ref={track}
        tabIndex={0}
        aria-label={`${title} titles`}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          )
            return;
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            scroll(event.key === 'ArrowRight' ? 1 : -1);
          }
          if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            event.currentTarget.scrollTo({
              left: event.key === 'Home' ? 0 : event.currentTarget.scrollWidth,
              behavior: motionReduced() ? 'instant' : 'smooth',
            });
          }
        }}
      >
        {items.map((item, index) => (
          <TitleCard key={item.id} title={item} index={index} format={format} />
        ))}
      </div>
    </section>
  );
}
