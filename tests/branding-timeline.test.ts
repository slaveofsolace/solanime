import { describe, expect, it } from 'vitest';
import { BrandClock, EXIT_MS, getBrandSession, INTRO_MS, LOOP_MS, sampleBrandExit, sampleBrandFrame, staticBrandFrame } from '../src/branding/timeline';

describe('approved branding timeline', () => {
  it('lets the sun rise slowly through the ribbon reveal and keeps the wordmark late', () => {
    const start = sampleBrandFrame('intro', 0);
    expect(start.front).toBe(0); expect(start.sun).toBe(0);
    expect(start.letters.every(value => value === 0)).toBe(true);
    const ribbon = sampleBrandFrame('intro', 1100);
    expect(ribbon.front).toBeGreaterThan(.8); expect(ribbon.sun).toBeGreaterThan(0);
    expect(ribbon.sun).toBeLessThan(.2);
    const sunrise = sampleBrandFrame('intro', 1600);
    expect(sunrise.front).toBeGreaterThan(.99); expect(sunrise.sunY).toBeGreaterThan(0);
    expect(sunrise.sun).toBeGreaterThan(0); expect(sunrise.sun).toBeLessThan(1);
    expect(sunrise.sunRays).toBeGreaterThan(0); expect(sunrise.letters.every(value => value === 0)).toBe(true);
    const type = sampleBrandFrame('intro', 2200);
    expect(type.letters[0]).toBeGreaterThan(type.letters[7]);
    expect(sampleBrandFrame('intro', 3100).letters.every(value => value === 1)).toBe(true);
    expect(sampleBrandFrame('intro', 2500).sunY).toBeGreaterThan(0);
  });
  it('brings in the play triangle with the ribbon and builds light behind the rising sun', () => {
    const early = sampleBrandFrame('intro', 800);
    const middle = sampleBrandFrame('intro', 1100);
    expect(early.core).toBeGreaterThan(0);
    expect(early.play).toBeGreaterThan(0);
    expect(middle.core).toBeGreaterThan(early.core);
    expect(middle.play).toBeGreaterThan(early.play);
    for (let time = 600; time < 1550; time += 40) {
      const current = sampleBrandFrame('intro', time);
      const next = sampleBrandFrame('intro', time + 40);
      expect(next.core - current.core).toBeLessThan(.1);
      expect(next.play - current.play).toBeLessThan(.1);
    }
    expect(sampleBrandFrame('intro', 1600).sunRays).toBeGreaterThan(sampleBrandFrame('intro', 1200).sunRays);
  });
  it('lands on exactly the loading-loop start without geometry or light jumps', () => {
    expect(sampleBrandFrame('intro', INTRO_MS)).toEqual(sampleBrandFrame('loading', 0));
    const before = sampleBrandFrame('intro', INTRO_MS - .001);
    const after = sampleBrandFrame('intro', INTRO_MS);
    for (const key of ['front', 'back', 'core', 'play', 'sun', 'sunY', 'sunlight', 'sunRays', 'reflection', 'playGlow', 'flare', 'glint', 'opacity'] as const) expect(before[key]).toBeCloseTo(after[key], 5);
    expect(before.letters).toEqual(after.letters);
  });
  it('has a periodic loop with invisible traveling-light wrap and fixed geometry', () => {
    for (const time of [0, 11, 100, 1800, 4199]) expect(sampleBrandFrame('loading', time)).toEqual(sampleBrandFrame('loading', time + LOOP_MS));
    const a = sampleBrandFrame('loading', 0);
    const b = sampleBrandFrame('loading', LOOP_MS - .01);
    expect(a.glint).toBe(0); expect(b.glint).toBeLessThan(1e-9);
    for (let time = 0; time <= LOOP_MS; time += 20) {
      const frame = sampleBrandFrame('loading', time);
      expect([frame.front, frame.back, frame.core, frame.play, frame.sun, ...frame.letters]).toEqual(Array(13).fill(1));
      expect(frame.sunY).toBe(0); expect(frame.opacity).toBe(1);
    }
  });
  it('freezes every partially formed frame when readiness interrupts', () => {
    for (const time of [0, 80, 800, 1400, 2100, 2970]) {
      const frame = sampleBrandFrame('intro', time);
      const exiting = sampleBrandExit(frame, 70);
      expect({ ...exiting, opacity: 1 }).toEqual({ ...frame, opacity: 1 });
      expect(exiting.opacity).toBeGreaterThan(0); expect(exiting.opacity).toBeLessThan(1);
      expect(sampleBrandExit(frame, EXIT_MS).opacity).toBe(0);
    }
  });
  it('has the complete readable identity before the readiness minimum', () => {
    const frame = sampleBrandFrame('intro', 3300);
    expect([frame.front, frame.back, frame.core, frame.play, frame.sun, ...frame.letters]).toEqual(Array(13).fill(1));
    expect(frame.sunY).toBe(0);
    expect(INTRO_MS).toBeGreaterThanOrEqual(2500);
    expect(INTRO_MS).toBeLessThanOrEqual(3500);
  });
  it('keeps animated light bounded and has no lighting seam on loop wrap', () => {
    for (let time = 0; time <= INTRO_MS + LOOP_MS; time += 16) {
      const frame = sampleBrandFrame('intro', time);
      for (const light of [frame.sunlight, frame.sunRays, frame.reflection, frame.playGlow, frame.glint]) {
        expect(light).toBeGreaterThanOrEqual(0);
        expect(light).toBeLessThanOrEqual(.5);
      }
    }
    for (const key of ['sunlight', 'sunRays', 'reflection', 'playGlow', 'glint', 'flare'] as const) {
      expect(sampleBrandFrame('loading', LOOP_MS - .01)[key]).toBeCloseTo(sampleBrandFrame('loading', 0)[key], 7);
    }
  });
  it('never moves the ribbon or sun when reduced motion is requested', () => {
    for (const time of [0, 900, 2100, 12000]) {
      expect(sampleBrandFrame('intro', time, true)).toEqual(staticBrandFrame());
      expect(sampleBrandFrame('loading', time, true)).toEqual(staticBrandFrame());
    }
    expect(sampleBrandExit(staticBrandFrame(), 80, true).opacity).toBe(0);
  });
  it('handles malformed sample times with a deterministic safe frame', () => {
    expect(sampleBrandFrame('intro', NaN)).toEqual(sampleBrandFrame('intro', 0));
    expect(sampleBrandFrame('intro', Infinity)).toEqual(sampleBrandFrame('intro', 0));
    expect(sampleBrandFrame('intro', -40)).toEqual(sampleBrandFrame('intro', 0));
  });
  it('pauses hidden time, resumes elapsed motion, and keeps a bounded boot identity', () => {
    const clock = new BrandClock();
    clock.tick(0, true); expect(clock.tick(120, true)).toBe(120);
    clock.tick(200, false); expect(clock.tick(10000, true)).toBe(120);
    expect(clock.tick(10100, true)).toBe(220);
    clock.pause(); expect(clock.tick(30000, true)).toBe(220);
    const session = getBrandSession('test-repeated-mount');
    session.elapsed = 920; session.resolved = true;
    expect(getBrandSession('test-repeated-mount')).toBe(session);
    expect(getBrandSession('test-repeated-mount').elapsed).toBe(920);
    for (let index = 0; index < 34; index++) getBrandSession(`bounded-session-${index}`);
    expect(getBrandSession('test-repeated-mount')).not.toBe(session);
  });
});
