// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SolanimeBrand } from '../src/branding/SolanimeBrand';
import { BrandReadiness } from '../src/branding/BrandReadiness';

let time = 0;
let rafId = 0;
let frames = new Map<number, FrameRequestCallback>();
let systemReduce = false;
let mediaListeners: (() => void)[] = [];
let visibleListeners: IntersectionObserverCallback[] = [];
beforeEach(() => {
  time = 0; rafId = 0; frames = new Map(); systemReduce = false; mediaListeners = []; visibleListeners = [];
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++rafId; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({ get matches() { return systemReduce; }, addEventListener: (_: string, callback: () => void) => mediaListeners.push(callback), removeEventListener: (_: string, callback: () => void) => { mediaListeners = mediaListeners.filter(item => item !== callback); } }));
  vi.stubGlobal('Image', class { complete = true; naturalWidth = 1254; onload = null; onerror = null; src = ''; });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { visibleListeners.push(callback); }
    observe() {} disconnect() {} unobserve() {} takeRecords() { return []; }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const advance = (milliseconds: number) => act(() => { time += milliseconds; const current = [...frames.values()]; frames.clear(); current.forEach(callback => callback(time)); });

describe('brand lifecycle', () => {
  it('does not schedule any animation for navigation/static placement', () => {
    const view = render(<SolanimeBrand variant="compact" />);
    expect(screen.getByRole('img', { name: 'Solanime' })).toBeTruthy();
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/branding/solanime-compact-dark.webp');
    expect(frames.size).toBe(0);
  });
  it('combines saved and OS reduced-motion preferences and reacts to changes', () => {
    const view = render(<SolanimeBrand motion="intro" reducedMotion />);
    expect(view.container.firstElementChild?.getAttribute('data-reduced-motion')).toBe('true');
    expect(frames.size).toBe(0);
    view.rerender(<SolanimeBrand motion="intro" />);
    expect(frames.size).toBe(1);
    act(() => { systemReduce = true; mediaListeners.forEach(callback => callback()); });
    expect(frames.size).toBe(0);
    expect(view.container.querySelector('[data-sun-rise]')?.getAttribute('transform')).toBe('translate(0 0.000)');
  });
  it('cleans StrictMode frames and calls exit completion once from any partial intro', () => {
    const onExit = vi.fn();
    const view = render(<StrictMode><SolanimeBrand motion="intro" onExitComplete={onExit} /></StrictMode>);
    expect(frames.size).toBe(1);
    advance(800);
    const before = view.container.querySelector('[data-front-reveal]')?.getAttribute('stroke-dashoffset');
    view.rerender(<StrictMode><SolanimeBrand motion="ready" onExitComplete={onExit} /></StrictMode>);
    advance(90);
    expect(view.container.querySelector('[data-front-reveal]')?.getAttribute('stroke-dashoffset')).toBe(before);
    advance(100); advance(500);
    expect(onExit).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0);
    view.unmount(); expect(mediaListeners.length).toBe(0);
  });
  it('pauses offscreen and resumes without replay or a hidden animation loop', () => {
    const view = render(<SolanimeBrand motion="intro" />);
    advance(600);
    const before = view.container.querySelector('[data-front-reveal]')?.getAttribute('stroke-dashoffset');
    act(() => visibleListeners.at(-1)!([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(frames.size).toBe(0); advance(9000);
    expect(view.container.querySelector('[data-front-reveal]')?.getAttribute('stroke-dashoffset')).toBe(before);
    act(() => visibleListeners.at(-1)!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(view.container.querySelector('[data-front-reveal]')?.getAttribute('stroke-dashoffset')).toBe(before);
    expect(frames.size).toBe(1);
  });
  it('excludes hidden-tab time and completes ready immediately while hidden', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const onExit = vi.fn();
    const view = render(<SolanimeBrand motion="intro" onExitComplete={onExit} />);
    advance(900);
    const before = view.container.querySelector('[data-front-reveal]')?.getAttribute('stroke-dashoffset');
    act(() => { hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange')); });
    expect(frames.size).toBe(0); advance(20000);
    act(() => { hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); });
    expect(view.container.querySelector('[data-front-reveal]')?.getAttribute('stroke-dashoffset')).toBe(before);
    act(() => { hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange')); });
    view.rerender(<SolanimeBrand motion="ready" onExitComplete={onExit} />);
    expect(onExit).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0);
  });
  it('retains a logical intro across route remounts and never replays a resolved boot', () => {
    const view = render(<SolanimeBrand motion="intro" sessionKey="component-persistent-boot" />);
    advance(700);
    const before = view.container.querySelector('[data-front-reveal]')?.getAttribute('stroke-dashoffset');
    view.unmount(); advance(3000);
    const onExit = vi.fn();
    const remount = render(<SolanimeBrand motion="intro" sessionKey="component-persistent-boot" onExitComplete={onExit} />);
    expect(remount.container.querySelector('[data-front-reveal]')?.getAttribute('stroke-dashoffset')).toBe(before);
    remount.rerender(<SolanimeBrand motion="ready" sessionKey="component-persistent-boot" onExitComplete={onExit} />);
    advance(200); remount.unmount();
    const final = render(<SolanimeBrand motion="intro" sessionKey="component-persistent-boot" onExitComplete={onExit} />);
    expect(final.container.querySelector('svg')?.style.opacity).toBe('0'); expect(frames.size).toBe(0);
  });
});

describe('actual readiness', () => {
  it('does not mount a splash if application data is already ready', () => {
    const view = render(<BrandReadiness ready />);
    expect(view.container.innerHTML).toBe(''); expect(frames.size).toBe(0);
  });
  it('dismisses on ready without waiting for the three-second intro', () => {
    const onDismiss = vi.fn();
    const view = render(<BrandReadiness ready={false} onDismiss={onDismiss} sessionKey="readiness-early" />);
    advance(180);
    view.rerender(<BrandReadiness ready onDismiss={onDismiss} sessionKey="readiness-early" />);
    advance(190);
    expect(view.container.innerHTML).toBe(''); expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(time).toBeLessThan(500);
  });
  it('turns a timeout into retry/continue actions, without invented progress', () => {
    vi.useFakeTimers(); const retry = vi.fn(); const dismiss = vi.fn();
    render(<BrandReadiness ready={false} onRetry={retry} onDismiss={dismiss} timeoutMs={1200} sessionKey="readiness-timeout" />);
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByRole('alert').textContent).toContain('longer than expected');
    expect(screen.queryByRole('progressbar')).toBeNull(); expect(frames.size).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1200));
    fireEvent.click(screen.getByRole('button', { name: 'Continue without waiting' }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
  it('renders an explicit failure as a static identity with actionable controls', () => {
    render(<BrandReadiness ready={false} error="Catalogue unavailable" onRetry={() => {}} sessionKey="readiness-failed" />);
    expect(screen.getByRole('alert').textContent).toContain('Catalogue unavailable');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy(); expect(frames.size).toBe(0);
  });
  it('does not replay after Continue or a ready-first mount on the same boot key', () => {
    const first = render(<BrandReadiness ready={false} error="Slow upstream" sessionKey="continue-persisted" />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    first.unmount();
    const again = render(<BrandReadiness ready={false} sessionKey="continue-persisted" />);
    expect(again.container.innerHTML).toBe(''); again.unmount();
    const already = render(<BrandReadiness ready sessionKey="ready-first-persisted" />);
    already.unmount();
    const returnHome = render(<BrandReadiness ready={false} sessionKey="ready-first-persisted" />);
    expect(returnHome.container.innerHTML).toBe('');
  });
});
