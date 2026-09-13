import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import BrandArtwork, { type BrandVariant } from './BrandArtwork';
import { BRAND_FOREGROUND, BRAND_MASTER, BRAND_SUN } from './geometry';
import { createBrandPainter } from './dom';
import { BrandClock, EXIT_MS, getBrandSession, INTRO_MS, sampleBrandExit, sampleBrandFrame, type BrandFrame, type BrandMotion } from './timeline';
import './brand.css';

export interface SolanimeBrandProps {
  variant?: BrandVariant;
  motion?: BrandMotion;
  theme?: 'dark' | 'light';
  /** Either the OS preference or this saved preference disables rich motion. */
  reducedMotion?: boolean;
  /** Stable boot identifier; preserve it across Suspense or route remounts. */
  sessionKey?: string;
  onExitComplete?: () => void;
  onAssetError?: () => void;
  className?: string;
  label?: string;
  decorative?: boolean;
  /** Deterministic demo/export sampling. Omit in the application. */
  elapsedMs?: number;
  artworkUrl?: string;
  style?: CSSProperties;
  /** Force editable layers for the export/demo surface. Static navigation uses optimized assets. */
  rendering?: 'auto' | 'layers';
}

export function useBrandReducedMotion(saved = false) {
  const [system, setSystem] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystem(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return saved || system;
}

function MotionBrand({
  variant = 'full', motion = 'static', theme = 'dark', reducedMotion = false,
  sessionKey, onExitComplete, onAssetError, className = '', label = 'Solanime', decorative = false,
  elapsedMs, artworkUrl = BRAND_MASTER, style,
}: SolanimeBrandProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<BrandClock | null>(null);
  const clockKeyRef = useRef<string | undefined>(undefined);
  if (!clockRef.current || clockKeyRef.current !== sessionKey) {
    clockRef.current = sessionKey ? getBrandSession(sessionKey) : new BrandClock();
    clockKeyRef.current = sessionKey;
  }
  const frameRef = useRef<BrandFrame>(sampleBrandFrame(motion, clockRef.current.elapsed));
  const exitRef = useRef<{ started: number; frame: BrandFrame } | null>(null);
  const previousMotion = useRef(motion);
  const callbackRef = useRef(onExitComplete);
  const assetErrorRef = useRef(onAssetError);
  callbackRef.current = onExitComplete;
  assetErrorRef.current = onAssetError;
  const exitSent = useRef(false);
  const reduce = useBrandReducedMotion(reducedMotion);
  const [asset, setAsset] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    setAsset('loading');
    let failed = false;
    const pending = new Set([artworkUrl, BRAND_FOREGROUND, BRAND_SUN]);
    const images = [...pending].map(source => {
      const image = new Image();
      const loaded = () => { pending.delete(source); if (active && !failed && pending.size === 0) setAsset('loaded'); };
      image.onload = loaded;
      image.onerror = () => { if (active && !failed) { failed = true; setAsset('error'); assetErrorRef.current?.(); } };
      image.src = source;
      if (image.complete && image.naturalWidth > 0) loaded();
      return image;
    });
    return () => { active = false; images.forEach(image => { image.onload = null; image.onerror = null; }); };
  }, [artworkUrl]);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const wrapper = wrapperRef.current;
    const clock = clockRef.current!;
    if (!svg || !wrapper) return;
    const paint = createBrandPainter(svg);
    let frameId = 0;
    let active = true;
    let visible = true;
    if (previousMotion.current !== motion) {
      if (motion === 'ready') exitRef.current = { started: performance.now(), frame: frameRef.current };
      else { exitRef.current = null; exitSent.current = false; }
      previousMotion.current = motion;
    }
    const finish = () => {
      if (exitSent.current) return;
      exitSent.current = true;
      clock.resolved = true;
      callbackRef.current?.();
    };
    const tick = (now: number) => {
      if (!active) return;
      let next: BrandFrame;
      if (motion === 'ready' || (sessionKey && clock.resolved && motion === 'intro')) {
        next = exitRef.current ? sampleBrandExit(exitRef.current.frame, now - exitRef.current.started, reduce) : sampleBrandFrame('ready');
        paint(next); frameRef.current = next;
        if (next.opacity <= 0 || document.hidden || !visible) { paint({ ...next, opacity: 0 }); finish(); return; }
        frameId = requestAnimationFrame(tick); return;
      }
      if (elapsedMs !== undefined) {
        next = sampleBrandFrame(motion, elapsedMs, reduce);
        paint(next); frameRef.current = next;
        svg.setAttribute('data-sampled-ms', String(elapsedMs)); return;
      }
      const advancing = !document.hidden && visible && asset === 'loaded' && !reduce && (motion === 'intro' || motion === 'loading');
      const elapsed = clock.tick(now, advancing);
      next = sampleBrandFrame(motion, elapsed, reduce);
      paint(next); frameRef.current = next;
      wrapper.dataset.animation = reduce || motion === 'static' || motion === 'error' ? 'static' : !advancing ? 'paused' : motion === 'intro' && elapsed >= INTRO_MS ? 'loading' : motion;
      if (advancing) frameId = requestAnimationFrame(tick);
    };
    const refreshVisibility = () => {
      cancelAnimationFrame(frameId);
      clock.pause();
      tick(performance.now());
    };
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      refreshVisibility();
    }, { threshold: 0.01 }) : null;
    observer?.observe(wrapper);
    document.addEventListener('visibilitychange', refreshVisibility);
    tick(performance.now());
    return () => { active = false; cancelAnimationFrame(frameId); clock.pause(); observer?.disconnect(); document.removeEventListener('visibilitychange', refreshVisibility); };
  }, [motion, reduce, elapsedMs, sessionKey, variant, theme, asset]);

  return <div ref={wrapperRef} className={`sol-brand sol-brand--${variant} ${className}`.trim()} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined} data-motion={motion} data-reduced-motion={reduce} data-asset={asset} style={style}>
    <BrandArtwork ref={svgRef} variant={variant} theme={theme} artworkUrl={artworkUrl} />
    {asset === 'error' && <span className="sol-brand-fallback" aria-hidden="true">Solanime</span>}
  </div>;
}

function BrandStill(props: SolanimeBrandProps) {
  const { variant = 'full', theme = 'dark', label = 'Solanime', decorative = false, className = '', style } = props;
  const [failed, setFailed] = useState(false);
  if (failed) return <MotionBrand {...props} artworkUrl={BRAND_MASTER} />;
  return <div className={`sol-brand sol-brand--${variant} ${className}`.trim()} style={style} data-motion="static" data-animation="static" data-asset="optimized" aria-hidden={decorative || undefined}>
    <img className="sol-brand-art" src={`/branding/solanime-${variant}-${theme}.webp`} width={variant === 'full' ? 960 : variant === 'compact' ? 660 : 256} height={variant === 'full' ? 850 : variant === 'compact' ? 132 : 256} alt={decorative ? '' : label} decoding="async" onError={() => setFailed(true)} />
  </div>;
}

export function SolanimeBrand(props: SolanimeBrandProps) {
  if ((props.motion ?? 'static') === 'static' && props.rendering !== 'layers' && props.elapsedMs === undefined && !props.artworkUrl) return <BrandStill {...props} />;
  return <MotionBrand {...props} />;
}

export { EXIT_MS };
