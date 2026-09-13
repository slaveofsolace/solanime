export type BrandMotion = 'static' | 'intro' | 'loading' | 'ready' | 'error';
export const INTRO_MS = 3000;
export const LOOP_MS = 4800;
export const EXIT_MS = 180;

export interface BrandFrame {
  front: number;
  back: number;
  core: number;
  play: number;
  sun: number;
  sunY: number;
  sunlight: number;
  letters: readonly number[];
  wordSheenX: number;
  wordSheen: number;
  flare: number;
  glint: number;
  glintTravel: number;
  opacity: number;
}

export const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const progress = (time: number, start: number, duration: number) => clamp((time - start) / duration);
const smooth = (value: number) => value * value * (3 - 2 * value);
const sweep = (value: number) => value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;

export function staticBrandFrame(): BrandFrame {
  return { front: 1, back: 1, core: 1, play: 1, sun: 1, sunY: 0, sunlight: 0.12,
    letters: Array(8).fill(1), wordSheenX: 0, wordSheen: 0, flare: 0.22,
    glint: 0, glintTravel: 0, opacity: 1 };
}

/** One deterministic timeline serves live playback, frame exports and regression tests. */
export function sampleBrandFrame(motion: BrandMotion, elapsedMs = 0, reducedMotion = false): BrandFrame {
  if (motion === 'ready') return { ...staticBrandFrame(), opacity: 0 };
  if (reducedMotion || motion === 'static' || motion === 'error') return staticBrandFrame();
  const time = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  if (motion === 'loading' || time >= INTRO_MS) {
    const loopTime = motion === 'loading' ? time : time - INTRO_MS;
    const phase = ((loopTime % LOOP_MS) + LOOP_MS) % LOOP_MS / LOOP_MS;
    const pulse = Math.sin(Math.PI * phase) ** 2;
    return { ...staticBrandFrame(), sunlight: 0.12 + pulse * 0.035, flare: 0.22 + pulse * 0.045,
      glint: pulse * 0.32, glintTravel: phase, wordSheenX: 0, wordSheen: 0 };
  }
  const front = sweep(progress(time, 80, 1430));
  const back = smooth(progress(time, 260, 1260));
  const sunrise = smooth(progress(time, 1350, 960));
  const letters = Array.from({ length: 8 }, (_, index) => smooth(progress(time, 1920 + index * 34, 390)));
  const sheen = progress(time, 2400, 560);
  const glintEnvelope = Math.sin(Math.PI * progress(time, 0, 1620)) ** 2;
  const rimPulse = Math.sin(Math.PI * progress(time, 1510, 1150)) ** 2;
  return {
    front, back, core: smooth(progress(time, 1280, 300)), play: smooth(progress(time, 1110, 340)),
    sun: smooth(progress(time, 1350, 200)), sunY: 158 * (1 - sunrise),
    sunlight: 0.12 * sunrise + rimPulse * 0.16,
    letters, wordSheenX: 140 + 1060 * sheen,
    wordSheen: Math.sin(Math.PI * sheen) ** 2 * 0.36,
    flare: smooth(progress(time, 2140, 660)) * 0.22,
    glint: glintEnvelope * 0.85, glintTravel: front, opacity: 1,
  };
}

/** Exit freezes the currently visible geometry; it never jumps to the finished mark. */
export function sampleBrandExit(frame: BrandFrame, elapsedMs: number, reducedMotion = false): BrandFrame {
  const duration = reducedMotion ? 80 : EXIT_MS;
  return { ...frame, opacity: frame.opacity * (1 - smooth(progress(elapsedMs, 0, duration))) };
}

/** Local lifecycle state. A session record can outlive a StrictMode effect or route mount. */
export class BrandClock {
  elapsed = 0;
  resolved = false;
  private last: number | null = null;
  tick(now: number, active: boolean) {
    if (active && this.last !== null) this.elapsed += Math.max(0, now - this.last);
    this.last = active ? now : null;
    return this.elapsed;
  }
  pause() { this.last = null; }
}

const sessions = new Map<string, BrandClock>();
/** Read-only integration check; an unseen boot does not create a session. */
export function isBrandSessionResolved(key: string): boolean {
  return sessions.get(key)?.resolved ?? false;
}
export function getBrandSession(key: string): BrandClock {
  const found = sessions.get(key);
  if (found) return found;
  const clock = new BrandClock();
  if (sessions.size >= 32) sessions.delete(sessions.keys().next().value!);
  sessions.set(key, clock);
  return clock;
}
