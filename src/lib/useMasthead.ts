import { useLayoutEffect, useRef } from 'react';

/** Paint only header opacity; scrolling never remounts a route or player. */
export function useMasthead(overArtwork: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const header = ref.current?.closest<HTMLElement>('.masthead');
    if (!header) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const amount = overArtwork ? Math.min(1, Math.max(0, window.scrollY) / 160) : 1;
      header.style.setProperty('--masthead-opacity', amount.toFixed(3));
      header.dataset.scrolled = amount >= 1 ? 'true' : 'false';
    };
    const request = () => { if (!frame) frame = requestAnimationFrame(paint); };
    paint();
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('pageshow', request);
    return () => {
      window.removeEventListener('scroll', request);
      window.removeEventListener('pageshow', request);
      cancelAnimationFrame(frame);
      header.style.removeProperty('--masthead-opacity');
      delete header.dataset.scrolled;
    };
  }, [overArtwork]);
  return ref;
}
