import type { SVGProps } from 'react';
type Name =
  | 'search'
  | 'sun'
  | 'moon'
  | 'arrow'
  | 'bookmark'
  | 'check'
  | 'play'
  | 'palette'
  | 'close'
  | 'info'
  | 'left'
  | 'right'
  | 'pause'
  | 'volume'
  | 'muted'
  | 'expand'
  | 'theater'
  | 'unavailable'
  | 'shield'
  | 'home'
  | 'browse'
  | 'person';
const paths: Record<Name, string> = {
  unavailable: 'M3 3l18 18M5 9v10h14M9 5h10v10M3 5h2m14 0h2v4',
  home: 'm3 10 9-7 9 7v11H3V10Zm6 11v-8h6v8',
  browse: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7',
  person: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-3a8 8 0 0 1 16 0v3',
  palette:
    'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 1-2.8h2a4 4 0 0 0 4-4C21 6 17 3 12 3ZM7 10h.01M10 6.5h.01M15 7h.01M17.5 10.5h.01',
  close: 'm6 6 12 12M6 18 18 6',
  info: 'M12 11v6m0-10v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  left: 'm15 5-7 7 7 7',
  right: 'm9 5 7 7-7 7',
  pause: 'M8 5v14M16 5v14',
  volume: 'M4 9h4l5-4v14l-5-4H4V9Zm12-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  muted: 'M4 9h4l5-4v14l-5-4H4V9Zm13 1 5 5m-5 0 5-5',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  theater: 'M3 5h18v14H3V5Zm3 3h12v8H6V8Z',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
  check: 'm5 12 4 4 10-10',
  play: 'm8 4 12 8-12 8V4Z',
};
export default function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: Name }) {
  return (
    <svg
      {...props}
      className={`icon ${props.className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
