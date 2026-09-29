import { forwardRef, memo, useId } from 'react';
import { BACK_TRAVEL, BRAND_FOREGROUND, BRAND_MASTER, BRAND_SUN, BRAND_VIEWBOX, EXTRACTED_PLAY, FRONT_TRAVEL, LETTERS, SUN_WINDOW } from './geometry';
import './brand.css';

export type BrandVariant = 'full' | 'compact' | 'emblem';
export interface BrandArtworkProps {
  variant?: BrandVariant;
  theme?: 'dark' | 'light';
  artworkUrl?: string;
}

/** Stable compositing layers: no contour, triangle or typography changes between frames. */
const BrandArtwork = memo(forwardRef<SVGSVGElement, BrandArtworkProps>(function BrandArtwork(
  { variant = 'full', theme = 'dark', artworkUrl = BRAND_MASTER }, ref,
) {
  const id = `solbrand-${useId().replace(/:/g, '')}`;
  const url = (name: string) => `url(#${id}-${name})`;
  const master = <use href={`#${id}-master`} />;
  const foreground = <use href={`#${id}-foreground`} />;
  const emblemTransform = variant === 'compact' ? 'translate(-140 -65) scale(.4)' : undefined;
  const wordTransform = variant === 'compact' ? 'translate(88 -577) scale(.88)' : undefined;
  return (
    <svg ref={ref} className="sol-brand-art" viewBox={BRAND_VIEWBOX[variant]} aria-hidden="true" focusable="false" data-brand-art data-variant={variant} data-theme={theme}>
      <defs>
        <image id={`${id}-master`} href={artworkUrl} x="0" y="698" width="1254" height="170" />
        <image id={`${id}-foreground`} href={BRAND_FOREGROUND} x="329" y="202" width="605" height="558" preserveAspectRatio="none" />
        <mask id={`${id}-sun-window`} maskUnits="userSpaceOnUse" x="370" y="150" width="550" height="550"><path d={SUN_WINDOW} fill="white" stroke="white" strokeWidth="2" /></mask>
        <mask id={`${id}-ribbon-reveal`} maskUnits="userSpaceOnUse" x="365" y="280" width="550" height="425">
          <g filter={url('reveal-feather')}>
            <path d={FRONT_TRAVEL} pathLength="100" fill="none" stroke="white" strokeWidth="132" strokeLinecap="butt" strokeDasharray="100 100" data-front-reveal />
            <path d={BACK_TRAVEL} pathLength="100" fill="none" stroke="white" strokeWidth="142" strokeLinecap="butt" strokeDasharray="100 100" data-back-reveal />
          </g>
          <rect x="365" y="280" width="550" height="425" fill="white" data-core />
          <path d={EXTRACTED_PLAY} fill="black" />
        </mask>
        <filter id={`${id}-reveal-feather`} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="4" /></filter>
        <filter id={`${id}-light-feather`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="11" /></filter>
        <mask id={`${id}-play`} maskUnits="userSpaceOnUse" x="548" y="380" width="170" height="143"><path d={EXTRACTED_PLAY} fill="white" stroke="white" strokeWidth="2" /></mask>
        <mask id={`${id}-foreground-alpha`} maskUnits="userSpaceOnUse" x="365" y="280" width="550" height="425" style={{ maskType: 'alpha' }}>{foreground}</mask>
        <filter id={`${id}-word-alpha`} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
          <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0.8 0.8 0.8 0 -0.17" />
        </filter>
        <mask id={`${id}-word-mask`} maskUnits="userSpaceOnUse" x="180" y="700" width="895" height="165" style={{ maskType: 'alpha' }}><g filter={url('word-alpha')}>{master}</g></mask>
        <linearGradient id={`${id}-warm-edge`} x1="0" x2="1" y1="0" y2="1"><stop stopColor="#fff3ba" /><stop offset=".47" stopColor="#ffd17b" /><stop offset="1" stopColor="#9a9ae9" /></linearGradient>
        <radialGradient id={`${id}-sun-glow`}><stop stopColor="#ffc26a" stopOpacity=".8" /><stop offset=".4" stopColor="#d67b25" stopOpacity=".28" /><stop offset="1" stopColor="#8b3a0a" stopOpacity="0" /></radialGradient>
        <radialGradient id={`${id}-glint`}><stop stopColor="#fffbed" /><stop offset=".18" stopColor="#ffe6a2" stopOpacity=".85" /><stop offset="1" stopColor="#f5a633" stopOpacity="0" /></radialGradient>
        <radialGradient id={`${id}-reflected-dawn`} cx=".43" cy=".05" r=".9"><stop stopColor="#fff2b3" stopOpacity=".9" /><stop offset=".32" stopColor="#ffb34e" stopOpacity=".5" /><stop offset=".64" stopColor="#b989c6" stopOpacity=".12" /><stop offset="1" stopColor="#989eff" stopOpacity="0" /></radialGradient>
        <linearGradient id={`${id}-flare`}><stop stopColor="#c36620" stopOpacity="0" /><stop offset=".46" stopColor="#ffce7b" stopOpacity=".8" /><stop offset=".5" stopColor="#fffae9" /><stop offset=".54" stopColor="#ffce7b" stopOpacity=".8" /><stop offset="1" stopColor="#c36620" stopOpacity="0" /></linearGradient>
        <linearGradient id={`${id}-sheen`}><stop stopColor="#fff7dc" stopOpacity="0" /><stop offset=".5" stopColor="#fff7dc" /><stop offset="1" stopColor="#fff7dc" stopOpacity="0" /></linearGradient>
        {LETTERS.map((letter, i) => <clipPath id={`${id}-letter-${i}`} key={letter.glyph}><rect x={letter.x} y="701" width={letter.width} height="163" /></clipPath>)}
      </defs>
      <g data-brand-composition>
        <g transform={emblemTransform}>
          <ellipse cx="628" cy="344" rx="370" ry="303" fill={url('sun-glow')} data-sunlight />
          <g mask={url('sun-window')}><g data-sun-rise><image href={BRAND_SUN} x="340" y="136" width="575" height="575" /></g></g>
          <g mask={url('ribbon-reveal')}>{foreground}</g>
          <path d={EXTRACTED_PLAY} fill="#ffcc6e" filter={url('light-feather')} data-play-aura />
          <g mask={url('play')} data-play>{foreground}</g>
          <g mask={url('ribbon-reveal')}>
            <g mask={url('foreground-alpha')}>
              <rect x="365" y="280" width="550" height="425" fill={url('reflected-dawn')} data-rim-light />
              <g data-travel-light><path d={FRONT_TRAVEL} pathLength="100" fill="none" stroke={url('warm-edge')} strokeWidth="48" strokeLinecap="round" strokeDasharray="8 192" filter={url('light-feather')} data-glint-path /></g>
              <g data-leading-glint><circle r="37" fill={url('glint')} /></g>
            </g>
          </g>
        </g>
        {variant !== 'emblem' && <g transform={wordTransform}>
          {LETTERS.map((letter, i) => <g key={letter.glyph} clipPath={url(`letter-${i}`)}><g data-letter={i}>
            {theme === 'light' ? <rect x={letter.x} y="701" width={letter.width} height="163" fill={i === 0 ? '#986016' : '#20202a'} mask={url('word-mask')} /> : <g mask={url('word-mask')}>{master}</g>}
          </g></g>)}
          <g mask={url('word-mask')}><rect x="0" y="700" width="120" height="166" fill={url('sheen')} data-word-sheen /></g>
          {variant === 'full' && <g data-flare><ellipse cx="627" cy="907" rx="170" ry="58" fill={url('sun-glow')} /><rect x="164" y="906" width="926" height="1.8" fill={url('flare')} /><ellipse cx="627" cy="907" rx="42" ry="1.8" fill="#fff3cf" /></g>}
        </g>}
      </g>
    </svg>
  );
}));
export default BrandArtwork;
