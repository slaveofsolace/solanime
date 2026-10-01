import { type BrandFrame } from './timeline';

/** Cache the small, fixed set of layer handles once instead of reconciling React at 60 Hz. */
export function createBrandPainter(svg: SVGSVGElement) {
  const node = <T extends SVGElement>(selector: string) => svg.querySelector<T>(selector);
  const front = node<SVGPathElement>('[data-front-reveal]');
  const back = node<SVGPathElement>('[data-back-reveal]');
  const core = node('[data-core]');
  const play = node('[data-play]');
  const playAura = node('[data-play-aura]');
  const sunlight = node('[data-sunlight]');
  const sunRays = node('[data-sun-rays]');
  const sun = node('[data-sun-rise]');
  const rim = node('[data-rim-light]');
  const travel = node('[data-travel-light]');
  const glint = node('[data-leading-glint]');
  const glintPath = node<SVGPathElement>('[data-glint-path]');
  const sheen = node('[data-word-sheen]');
  const flare = node('[data-flare]');
  const letters = [...svg.querySelectorAll<SVGGElement>('[data-letter]')];
  const length = typeof front?.getTotalLength === 'function' ? front.getTotalLength() : 0;
  const opacity = (target: SVGElement | null, value: number) => target?.setAttribute('opacity', value.toFixed(4));
  return (frame: BrandFrame) => {
    svg.style.opacity = frame.opacity.toFixed(4);
    front?.setAttribute('stroke-dashoffset', ((1 - frame.front) * 100).toFixed(4));
    back?.setAttribute('stroke-dashoffset', ((1 - frame.back) * 100).toFixed(4));
    opacity(core, frame.core); opacity(play, frame.play); opacity(sun, frame.sun);
    sun?.setAttribute('transform', `translate(0 ${frame.sunY.toFixed(3)})`);
    // The diffuse backlight follows the rising disc, without independent rays
    // sliding over the mark or changing its approved contours.
    const lightPosition = `translate(0 ${(frame.sunY * .35).toFixed(3)})`;
    sunlight?.setAttribute('transform', lightPosition);
    sunRays?.setAttribute('transform', lightPosition);
    opacity(sunlight, frame.sunlight); opacity(sunRays, frame.sunRays); opacity(rim, frame.reflection);
    opacity(playAura, frame.playGlow);
    opacity(travel, frame.glint);
    glintPath?.setAttribute('stroke-dashoffset', (-100 * frame.glintTravel).toFixed(4));
    opacity(glint, frame.glint);
    if (front && length > 0 && glint && frame.glint > 0) {
      const point = front.getPointAtLength(length * frame.glintTravel);
      glint.setAttribute('transform', `translate(${point.x.toFixed(3)} ${point.y.toFixed(3)})`);
    }
    letters.forEach((letter, index) => {
      opacity(letter, frame.letters[index] ?? 1);
      letter.setAttribute('transform', `translate(0 ${((1 - (frame.letters[index] ?? 1)) * 14).toFixed(3)})`);
    });
    opacity(sheen, frame.wordSheen);
    sheen?.setAttribute('transform', `translate(${frame.wordSheenX.toFixed(3)} 0) skewX(-9)`);
    opacity(flare, frame.flare);
    svg.setAttribute('data-frame-visible', String(frame.opacity > 0));
  };
}
