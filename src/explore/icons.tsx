import type { SVGProps } from 'react';

type Glyph = 'heart' | 'pass' | 'skip' | 'undo' | 'eye' | 'sliders' | 'sparkle';
const paths: Record<Glyph, string> = {
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  pass: 'm6 6 12 12M6 18 18 6',
  skip: 'M5 12h11m-4-5 5 5-5 5M19 6v12',
  undo: 'M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  sliders: 'M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M14 4v4M8 10v4M16 16v4',
  sparkle: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6',
};
/** Explore-only glyphs, drawn in the same 24px stroke style as the shared icon set. */
export default function ExploreIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: Glyph }) {
  return (
    <svg {...props} className={`icon ${props.className ?? ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
