import { useEffect, type RefObject } from 'react';
/** Respect the OS even if the application setting has not loaded yet. */
export function motionReduced(): boolean {
  return (
    document.documentElement.dataset.motion === 'reduced' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
/** Animate the existing DOM: never key/remount account state or a playing iframe. */
export function useRouteMotion(ref: RefObject<HTMLElement | null>, path: string) {
  useEffect(() => {
    const element = ref.current;
    if (!element || path.startsWith('/watch/') || motionReduced() || !element.animate) return;
    const transition = element.animate(
      [{ transform: 'translateY(8px)' }, { transform: 'translateY(0)' }],
      { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
    const stop = () => {
      if (motionReduced()) transition.cancel();
    };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const observer = new MutationObserver(stop);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion'],
    });
    media.addEventListener('change', stop);
    return () => {
      transition.cancel();
      observer.disconnect();
      media.removeEventListener('change', stop);
    };
  }, [path, ref]);
}
