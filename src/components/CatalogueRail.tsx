import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { TitleCard } from './ui';
import Icon from './Icon';
import type { TitleSummary } from '../types';
export default function CatalogueRail({
  title,
  to,
  items,
}: {
  title: string;
  to: string;
  items: TitleSummary[];
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
    if (element)
      element.scrollBy({
        left: direction * element.clientWidth * 0.85,
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
  };
  if (!items.length) return null;
  return (
    <section className="home-rail" aria-labelledby={id}>
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
      <div id={`${id}-items`} className="rail-track" ref={track}>
        {items.map((item) => (
          <TitleCard key={item.id} title={item} />
        ))}
      </div>
    </section>
  );
}
