import type { SVGProps } from 'react';
type Name = 'search' | 'sun' | 'moon' | 'arrow' | 'bookmark' | 'check' | 'play';
const paths: Record<Name, string> = {
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
